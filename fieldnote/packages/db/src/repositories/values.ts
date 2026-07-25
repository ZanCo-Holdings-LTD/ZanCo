import { and, asc, eq } from 'drizzle-orm';
import type { SourceSpan } from '@fieldnote/shared';
import type { Database } from '../client.js';
import { reportValues } from '../schema/values.js';
import { templateFields, templateSections } from '../schema/templates.js';

export interface ReviewValueRow {
  id: string;
  fieldId: string;
  fieldKey: string;
  label: string;
  type: string;
  required: boolean;
  enumValues: string[] | null;
  sectionKey: string;
  sectionTitle: string;
  sectionOrder: number;
  fieldOrder: number;
  value: unknown;
  generatedValue: unknown;
  confidence: number | null;
  sourceSpan: SourceSpan | null;
  editedByHuman: boolean;
  reviewedAt: Date | null;
}

/**
 * Every field of a report in render order, joined to its template definition.
 *
 * Left join from template fields, not from values, so a field the model never
 * produced still appears in the workspace as an empty row. An inspector needs
 * to see the shape of the whole report, including the gaps.
 */
export async function loadForReview(
  db: Database,
  reportId: string,
  templateId: string,
): Promise<ReviewValueRow[]> {
  const rows = await db
    .select({
      valueId: reportValues.id,
      fieldId: templateFields.id,
      fieldKey: templateFields.key,
      label: templateFields.label,
      type: templateFields.type,
      required: templateFields.required,
      enumValues: templateFields.enumValues,
      fieldOrder: templateFields.orderIndex,
      sectionKey: templateSections.key,
      sectionTitle: templateSections.title,
      sectionOrder: templateSections.orderIndex,
      value: reportValues.value,
      generatedValue: reportValues.generatedValue,
      confidence: reportValues.confidence,
      sourceSpan: reportValues.sourceSpan,
      editedByHuman: reportValues.editedByHuman,
      reviewedAt: reportValues.reviewedAt,
    })
    .from(templateSections)
    .innerJoin(templateFields, eq(templateFields.sectionId, templateSections.id))
    .leftJoin(
      reportValues,
      and(eq(reportValues.fieldId, templateFields.id), eq(reportValues.reportId, reportId)),
    )
    .where(eq(templateSections.templateId, templateId))
    .orderBy(asc(templateSections.orderIndex), asc(templateFields.orderIndex));

  return rows.map((row) => ({
    id: row.valueId ?? '',
    fieldId: row.fieldId,
    fieldKey: row.fieldKey,
    label: row.label,
    type: row.type,
    required: row.required,
    enumValues: row.enumValues ?? null,
    sectionKey: row.sectionKey,
    sectionTitle: row.sectionTitle,
    sectionOrder: row.sectionOrder,
    fieldOrder: row.fieldOrder,
    value: row.value ?? null,
    generatedValue: row.generatedValue ?? null,
    confidence: row.confidence === null ? null : Number(row.confidence),
    sourceSpan: row.sourceSpan ?? null,
    editedByHuman: row.editedByHuman ?? false,
    reviewedAt: row.reviewedAt ?? null,
  }));
}

export interface GeneratedValueInput {
  fieldId: string;
  value: unknown;
  confidence: number;
  sourceSpan: SourceSpan | null;
  modelVersion: string;
  promptVersion: string;
}

/**
 * Write what the model produced.
 *
 * `generatedValue` is set once and never again — the database enforces this
 * with a trigger. On re-run, only the confidence, span and provenance metadata
 * are refreshed, and any human edit already made to `value` survives.
 */
export async function writeGenerated(
  db: Database,
  orgId: string,
  reportId: string,
  inputs: GeneratedValueInput[],
): Promise<void> {
  if (inputs.length === 0) return;

  await db.transaction(async (tx) => {
    for (const input of inputs) {
      await tx
        .insert(reportValues)
        .values({
          orgId,
          reportId,
          fieldId: input.fieldId,
          value: input.value,
          generatedValue: input.value,
          confidence: String(input.confidence),
          sourceSpan: input.sourceSpan,
          modelVersion: input.modelVersion,
          promptVersion: input.promptVersion,
        })
        .onConflictDoUpdate({
          target: [reportValues.reportId, reportValues.fieldId],
          set: {
            confidence: String(input.confidence),
            sourceSpan: input.sourceSpan,
            modelVersion: input.modelVersion,
            promptVersion: input.promptVersion,
          },
        });
    }
  });
}

/**
 * Apply a human edit.
 *
 * The `edited_by_human` flag is set by a database trigger whenever `value`
 * changes, so it cannot be forgotten here or anywhere else.
 */
export async function edit(
  db: Database,
  orgId: string,
  reportId: string,
  fieldId: string,
  value: unknown,
  userId: string,
): Promise<{ generatedValue: unknown; previousValue: unknown } | null> {
  const [existing] = await db
    .select({ generatedValue: reportValues.generatedValue, value: reportValues.value })
    .from(reportValues)
    .where(and(eq(reportValues.reportId, reportId), eq(reportValues.fieldId, fieldId)))
    .limit(1);

  if (!existing) {
    // The model produced nothing for this field; the human is filling the gap.
    await db.insert(reportValues).values({
      orgId,
      reportId,
      fieldId,
      value,
      generatedValue: null,
      editedByHuman: true,
      reviewedAt: new Date(),
      reviewedBy: userId,
    });
    return { generatedValue: null, previousValue: null };
  }

  await db
    .update(reportValues)
    .set({ value, reviewedAt: new Date(), reviewedBy: userId })
    .where(and(eq(reportValues.reportId, reportId), eq(reportValues.fieldId, fieldId)));

  return { generatedValue: existing.generatedValue, previousValue: existing.value };
}

/**
 * Mark an amber field reviewed without changing its value.
 *
 * This is the "I read it and it is right" path. It clears the export gate for
 * that field while leaving `edited_by_human` false, so the metrics can still
 * tell acceptance apart from correction.
 */
export async function confirm(
  db: Database,
  reportId: string,
  fieldId: string,
  userId: string,
): Promise<void> {
  await db
    .update(reportValues)
    .set({ reviewedAt: new Date(), reviewedBy: userId })
    .where(and(eq(reportValues.reportId, reportId), eq(reportValues.fieldId, fieldId)));
}

export async function confirmAllInSection(
  db: Database,
  reportId: string,
  fieldIds: string[],
  userId: string,
): Promise<void> {
  if (fieldIds.length === 0) return;
  await db.transaction(async (tx) => {
    for (const fieldId of fieldIds) {
      await confirm(tx as Database, reportId, fieldId, userId);
    }
  });
}
