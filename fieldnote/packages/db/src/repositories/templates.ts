import { and, asc, eq, isNull, or } from 'drizzle-orm';
import type { TemplateSectionDef, Vertical } from '@fieldnote/shared';
import type { Database } from '../client.js';
import { templateFields, templateSections, templates } from '../schema/templates.js';

/** System templates plus this org's own customisations. */
export async function listAvailable(db: Database, orgId: string, vertical?: Vertical) {
  const scope = or(isNull(templates.orgId), eq(templates.orgId, orgId));
  const where = vertical ? and(scope, eq(templates.vertical, vertical)) : scope;

  return db
    .select()
    .from(templates)
    .where(and(where, isNull(templates.archivedAt)))
    .orderBy(asc(templates.isSystem), asc(templates.name), asc(templates.version));
}

export async function findById(db: Database, templateId: string) {
  const [row] = await db.select().from(templates).where(eq(templates.id, templateId)).limit(1);
  return row ?? null;
}

/**
 * Load a template's full shape: sections in order, each with its fields in
 * order. This is what the review workspace renders and what the structuring
 * prompt is built from, so both surfaces see an identical structure.
 */
export async function loadStructure(
  db: Database,
  templateId: string,
): Promise<TemplateSectionDef[]> {
  const rows = await db
    .select({
      sectionId: templateSections.id,
      sectionKey: templateSections.key,
      sectionTitle: templateSections.title,
      sectionOrder: templateSections.orderIndex,
      guidance: templateSections.guidance,
      fieldId: templateFields.id,
      fieldKey: templateFields.key,
      fieldLabel: templateFields.label,
      fieldType: templateFields.type,
      fieldRequired: templateFields.required,
      fieldEnumValues: templateFields.enumValues,
      fieldHint: templateFields.extractionHint,
      fieldOrder: templateFields.orderIndex,
    })
    .from(templateSections)
    .leftJoin(templateFields, eq(templateFields.sectionId, templateSections.id))
    .where(eq(templateSections.templateId, templateId))
    .orderBy(asc(templateSections.orderIndex), asc(templateFields.orderIndex));

  const sections = new Map<string, TemplateSectionDef>();
  for (const row of rows) {
    let section = sections.get(row.sectionId);
    if (!section) {
      section = {
        id: row.sectionId,
        key: row.sectionKey,
        title: row.sectionTitle,
        guidance: row.guidance,
        orderIndex: row.sectionOrder,
        fields: [],
      };
      sections.set(row.sectionId, section);
    }
    // The left join yields a null field row for a section with no fields yet.
    if (row.fieldId) {
      section.fields.push({
        id: row.fieldId,
        key: row.fieldKey!,
        label: row.fieldLabel!,
        type: row.fieldType!,
        required: row.fieldRequired!,
        enumValues: row.fieldEnumValues ?? null,
        extractionHint: row.fieldHint ?? null,
        orderIndex: row.fieldOrder!,
      });
    }
  }
  return [...sections.values()];
}

/** Keyword boost list handed to the ASR pass for this template's vertical. */
export async function asrKeywords(db: Database, templateId: string): Promise<string[]> {
  const [row] = await db
    .select({ keywords: templates.asrKeywords })
    .from(templates)
    .where(eq(templates.id, templateId))
    .limit(1);
  return row?.keywords ?? [];
}

/**
 * Copy a system template into an org so it can be customised.
 *
 * A team never edits a system template in place; they fork it. That keeps
 * upstream corrections to a compliance format shippable without silently
 * overwriting a customer's changes.
 */
export async function forkForOrg(
  db: Database,
  sourceTemplateId: string,
  orgId: string,
  name?: string,
): Promise<string> {
  return db.transaction(async (tx) => {
    const source = await findById(tx as Database, sourceTemplateId);
    if (!source) throw new Error(`Template ${sourceTemplateId} not found`);

    const [created] = await tx
      .insert(templates)
      .values({
        orgId,
        vertical: source.vertical,
        name: name ?? source.name,
        version: 1,
        isSystem: false,
        asrKeywords: source.asrKeywords,
        pdfTemplate: source.pdfTemplate,
      })
      .returning({ id: templates.id });
    if (!created) throw new Error('Failed to create forked template');

    const structure = await loadStructure(tx as Database, sourceTemplateId);
    for (const section of structure) {
      const [newSection] = await tx
        .insert(templateSections)
        .values({
          templateId: created.id,
          key: section.key,
          title: section.title,
          orderIndex: section.orderIndex,
          guidance: section.guidance,
        })
        .returning({ id: templateSections.id });
      if (!newSection) continue;

      if (section.fields.length > 0) {
        await tx.insert(templateFields).values(
          section.fields.map((field) => ({
            sectionId: newSection.id,
            key: field.key,
            label: field.label,
            type: field.type,
            required: field.required,
            enumValues: field.enumValues,
            extractionHint: field.extractionHint,
            orderIndex: field.orderIndex,
          })),
        );
      }
    }

    return created.id;
  });
}
