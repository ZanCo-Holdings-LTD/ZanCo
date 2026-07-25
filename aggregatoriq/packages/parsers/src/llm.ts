/**
 * Schema-guided extraction: the second rung of the ladder, and the only place a
 * model appears anywhere in this product.
 *
 * The boundary is absolute. A model may propose *which cell means what* for a
 * layout nothing recognises. It may never compute, judge, or adjust a number.
 * Matching, rule evaluation and arithmetic are deterministic code, always. In a
 * financial product a hallucinated number reaching a customer is terminal, and
 * the mitigation cannot be "the prompt says not to".
 *
 * So this module defines two things and no inference logic:
 *
 *   The strict schema an extraction must satisfy.
 *
 *   `assertGrounded`, which checks every extracted value appears *verbatim* in
 *   the source row it claims to come from. A value the model produced rather
 *   than read fails this check and the row goes to manual review. This is
 *   mechanical and total: it does not depend on the model behaving.
 *
 * The model call itself lives in the worker, behind this contract.
 */
import { z } from 'zod';
import { PAYOUT_LINE_TYPES } from '@aggregatoriq/core';

export const EXTRACTION_PROMPT_VERSION = 'extract-statement-v1';

/**
 * One extracted field, with the text it was read from.
 *
 * `sourceText` is not documentation. It is the input to the grounding check, and
 * an extraction that omits it is rejected.
 */
export const extractedValueSchema = z.object({
  value: z.string(),
  /** The exact substring of the source row this was read from. */
  sourceText: z.string(),
  confidence: z.number().min(0).max(1),
});
export type ExtractedValue = z.infer<typeof extractedValueSchema>;

export const extractedLineSchema = z.object({
  /** Index into the raw rows, so the value keeps its lineage. */
  sourceRowIndex: z.number().int().min(0),
  externalOrderId: extractedValueSchema.nullable(),
  lineType: z.enum(PAYOUT_LINE_TYPES),
  lineTypeSourceText: z.string(),
  amount: extractedValueSchema,
  description: extractedValueSchema.nullable(),
});
export type ExtractedLine = z.infer<typeof extractedLineSchema>;

export const extractionSchema = z.object({
  documentKind: z.enum(['payout_statement', 'order_export', 'invoice', 'adjustment_report', 'unknown']),
  externalPayoutId: extractedValueSchema.nullable(),
  periodStart: extractedValueSchema.nullable(),
  periodEnd: extractedValueSchema.nullable(),
  paidOn: extractedValueSchema.nullable(),
  lines: z.array(extractedLineSchema),
  /** Anything the model could not read. Surfaced, never silently dropped. */
  unreadable: z.array(z.string()),
});
export type Extraction = z.infer<typeof extractionSchema>;

export const extractionEnvelopeSchema = z.object({
  extraction: extractionSchema,
  modelVersion: z.string().min(1),
  promptVersion: z.string().min(1),
});
export type ExtractionEnvelope = z.infer<typeof extractionEnvelopeSchema>;

export class HallucinationError extends Error {
  readonly ungrounded: readonly string[];
  constructor(ungrounded: readonly string[]) {
    super(
      `Extraction rejected: ${ungrounded.length} value(s) do not appear in the source rows they ` +
        `claim to come from. ${ungrounded.slice(0, 5).join('; ')}`,
    );
    this.name = 'HallucinationError';
    this.ungrounded = ungrounded;
  }
}

/** Normalise for comparison: whitespace, case and thousands separators only. */
function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s,]/g, '')
    .replace(/[٠-٩]/g, (char) => String(char.charCodeAt(0) - 0x0660))
    .trim();
}

export interface GroundingIssue {
  readonly path: string;
  readonly value: string;
  readonly sourceRowIndex: number;
  readonly reason: 'source_text_not_in_row' | 'value_not_in_source_text' | 'row_out_of_range';
}

/**
 * Check every extracted value against the raw rows.
 *
 * Two checks per value, and both matter:
 *
 *   The claimed `sourceText` must actually appear in the row it points at.
 *   Otherwise the model invented its own citation.
 *
 *   The `value` must appear within that `sourceText`. Otherwise the model read a
 *   real cell and then changed what it said — which is the failure that produces
 *   a plausible, wrong, well-cited number.
 */
export function checkGrounding(
  extraction: Extraction,
  rawRows: readonly Record<string, string>[],
): GroundingIssue[] {
  const issues: GroundingIssue[] = [];

  const rowText = rawRows.map((row) => normalise(Object.values(row).join(' ')));

  const check = (
    path: string,
    value: { value: string; sourceText: string } | null,
    rowIndex: number,
  ): void => {
    if (value === null) return;

    if (rowIndex < 0 || rowIndex >= rowText.length) {
      issues.push({ path, value: value.value, sourceRowIndex: rowIndex, reason: 'row_out_of_range' });
      return;
    }

    const haystack = rowText[rowIndex]!;
    const citation = normalise(value.sourceText);

    if (citation === '' || !haystack.includes(citation)) {
      issues.push({
        path,
        value: value.value,
        sourceRowIndex: rowIndex,
        reason: 'source_text_not_in_row',
      });
      return;
    }

    if (!citation.includes(normalise(value.value))) {
      issues.push({
        path,
        value: value.value,
        sourceRowIndex: rowIndex,
        reason: 'value_not_in_source_text',
      });
    }
  };

  // Document-level fields may be read from anywhere in the file, so they are
  // grounded against the whole document rather than one row.
  const wholeDocument = normalise(rawRows.map((row) => Object.values(row).join(' ')).join(' '));
  for (const [name, field] of [
    ['externalPayoutId', extraction.externalPayoutId],
    ['periodStart', extraction.periodStart],
    ['periodEnd', extraction.periodEnd],
    ['paidOn', extraction.paidOn],
  ] as const) {
    if (field === null) continue;
    const citation = normalise(field.sourceText);
    if (citation === '' || !wholeDocument.includes(citation)) {
      issues.push({ path: name, value: field.value, sourceRowIndex: -1, reason: 'source_text_not_in_row' });
    } else if (!citation.includes(normalise(field.value))) {
      issues.push({ path: name, value: field.value, sourceRowIndex: -1, reason: 'value_not_in_source_text' });
    }
  }

  extraction.lines.forEach((line, index) => {
    check(`lines[${index}].amount`, line.amount, line.sourceRowIndex);
    check(`lines[${index}].externalOrderId`, line.externalOrderId, line.sourceRowIndex);
    check(`lines[${index}].description`, line.description, line.sourceRowIndex);

    // The line type is a classification rather than a quotation, so it is
    // grounded more loosely: the word the model classified from must be present.
    if (line.sourceRowIndex >= 0 && line.sourceRowIndex < rowText.length) {
      const haystack = rowText[line.sourceRowIndex]!;
      const citation = normalise(line.lineTypeSourceText);
      if (citation === '' || !haystack.includes(citation)) {
        issues.push({
          path: `lines[${index}].lineType`,
          value: line.lineType,
          sourceRowIndex: line.sourceRowIndex,
          reason: 'source_text_not_in_row',
        });
      }
    }
  });

  return issues;
}

export function assertGrounded(
  extraction: Extraction,
  rawRows: readonly Record<string, string>[],
): void {
  const issues = checkGrounding(extraction, rawRows);
  if (issues.length > 0) {
    throw new HallucinationError(
      issues.map((issue) => `${issue.path}="${issue.value}" (${issue.reason})`),
    );
  }
}

/**
 * The instruction given to the model.
 *
 * Kept here, versioned, and recorded on every document it produces, so that a
 * result from six months ago can be explained. Note what it does *not* ask for:
 * no totals, no sums, no judgement about whether a charge is correct. Those are
 * the engine's job and the model is never asked to have an opinion about them.
 */
export const EXTRACTION_SYSTEM_PROMPT = `
You are reading a delivery aggregator's settlement statement for a restaurant.

Your only task is to identify which parts of the document correspond to which
fields. You are a locator, not a calculator.

Rules, all of them absolute:

1. Copy values exactly as they appear. Do not reformat numbers, do not convert
   currencies, do not strip or add separators, do not correct anything that looks
   wrong. If a cell says "1,234.50" the value is "1,234.50".
2. For every value, return the exact substring of the row you read it from in
   "sourceText". A value that does not appear verbatim in its sourceText will be
   rejected automatically and the whole document will go to a human.
3. Never compute anything. Do not total a column, do not derive a missing figure
   from other figures, do not infer an amount you cannot see.
4. If you cannot read something, leave it null and add a note to "unreadable".
   An omission is safe; a guess is not.
5. Classify each line's type from the words actually in the row, and return those
   words in "lineTypeSourceText".

Return only JSON matching the provided schema.
`.trim();
