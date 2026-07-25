/**
 * Document extraction: the contract, the confidence policy, and nothing else.
 *
 * The model call itself lives in the worker. What lives here is the shape of a
 * result and the rules about what may be done with one, because those rules are
 * the safety property of the whole feature:
 *
 *   1. An extraction never writes a date. It produces a *suggestion* that a
 *      human confirms. There is no code path from a model response to a live
 *      expiry date that does not pass through a person.
 *   2. Below the confidence threshold, the suggestion is not even pre-filled —
 *      the field routes to manual entry. A plausible-looking wrong date that a
 *      reviewer waves through is worse than an empty box.
 *   3. Dates that fail a sanity check are rejected regardless of how confident
 *      the model was. A licence that expired in 1998 or expires in 2079 is a
 *      misread, not a document.
 *
 * A wrong expiry date in this product means a client gets fined, which is
 * precisely the failure the product exists to prevent.
 */
import { z } from 'zod';
import { daysBetween, isPlainDate, type PlainDate } from '../dates.js';
import { RENEWABLE_DOC_TYPES } from '../types.js';

/**
 * Below this, a field is not offered as a pre-filled suggestion at all.
 * Tuned against the eval set in `evals/` — see `docs/extraction-evals.md`.
 */
export const CONFIDENCE_THRESHOLD = 0.85;

/** Between this and the threshold, the field is pre-filled but flagged for a second look. */
export const CONFIDENCE_REVIEW_BAND = 0.95;

/** Reused by the confirmation endpoint, which validates the human's answer too. */
export const plainDateSchema = z
  .string()
  .refine(isPlainDate, { message: 'must be a YYYY-MM-DD calendar date' });

export const extractedFieldSchema = z.object({
  value: z.string().nullable(),
  /** Model self-reported confidence, 0..1. Calibrated against the eval set. */
  confidence: z.number().min(0).max(1),
  /** Where on the page it came from, so a reviewer can check it fast. */
  sourceText: z.string().nullable().optional(),
});
export type ExtractedField = z.infer<typeof extractedFieldSchema>;

export const extractionResultSchema = z.object({
  docType: z.enum(RENEWABLE_DOC_TYPES).nullable(),
  docTypeConfidence: z.number().min(0).max(1),
  /** Which language the document was read in. Both are supported. */
  detectedLanguage: z.enum(['en', 'ar', 'mixed', 'unknown']),
  fields: z.object({
    documentNumber: extractedFieldSchema.nullable(),
    issuingAuthority: extractedFieldSchema.nullable(),
    issuedOn: extractedFieldSchema.nullable(),
    expiresOn: extractedFieldSchema.nullable(),
    holderName: extractedFieldSchema.nullable(),
    legalName: extractedFieldSchema.nullable(),
    nationality: extractedFieldSchema.nullable(),
  }),
  /** Free-text note from the model about anything it could not read. */
  notes: z.string().nullable(),
});
export type ExtractionResult = z.infer<typeof extractionResultSchema>;

export const extractionEnvelopeSchema = z.object({
  result: extractionResultSchema,
  modelVersion: z.string().min(1),
  promptVersion: z.string().min(1),
  /** Overall confidence, the minimum across the fields that matter. */
  overallConfidence: z.number().min(0).max(1),
});
export type ExtractionEnvelope = z.infer<typeof extractionEnvelopeSchema>;

export const EXTRACTABLE_FIELDS = [
  'documentNumber',
  'issuingAuthority',
  'issuedOn',
  'expiresOn',
  'holderName',
  'legalName',
  'nationality',
] as const;
export type ExtractableField = (typeof EXTRACTABLE_FIELDS)[number];

/** The fields whose accuracy actually matters for a renewal. */
export const CRITICAL_FIELDS = ['expiresOn', 'documentNumber'] as const;

export type FieldDisposition = 'suggest' | 'suggest_flagged' | 'manual_entry_required';

export interface FieldReview {
  readonly field: ExtractableField;
  readonly value: string | null;
  readonly confidence: number;
  readonly disposition: FieldDisposition;
  readonly reasons: readonly string[];
}

/**
 * Sanity bounds for a date read off a document. Generous enough not to reject
 * a genuine ten-year passport, tight enough to catch an OCR slip that turns
 * 2026 into 2062.
 */
const MAX_YEARS_AHEAD = 15;
const MAX_YEARS_BEHIND = 30;

export function isPlausibleDocumentDate(value: string, today: PlainDate): boolean {
  if (!isPlainDate(value)) return false;
  const delta = daysBetween(today, value);
  return delta <= MAX_YEARS_AHEAD * 366 && delta >= -MAX_YEARS_BEHIND * 366;
}

/**
 * Decide what may be done with one extracted field.
 *
 * Note that this never returns "accept" — the best outcome is `suggest`, which
 * still means a human has to confirm it before it becomes a date the renewal
 * engine acts on.
 */
export function reviewField(
  field: ExtractableField,
  extracted: ExtractedField | null,
  today: PlainDate,
): FieldReview {
  const reasons: string[] = [];

  if (extracted === null || extracted.value === null || extracted.value.trim() === '') {
    return {
      field,
      value: null,
      confidence: 0,
      disposition: 'manual_entry_required',
      reasons: ['nothing extracted for this field'],
    };
  }

  const value = extracted.value.trim();
  const isDateField = field === 'issuedOn' || field === 'expiresOn';

  if (isDateField && !isPlainDate(value)) {
    reasons.push('not a valid calendar date');
  } else if (isDateField && !isPlausibleDocumentDate(value, today)) {
    reasons.push(
      `date ${value} is outside the plausible range (${MAX_YEARS_BEHIND} years back, ` +
        `${MAX_YEARS_AHEAD} years ahead) and is more likely a misread than a document`,
    );
  }

  if (extracted.confidence < CONFIDENCE_THRESHOLD) {
    reasons.push(
      `confidence ${extracted.confidence.toFixed(2)} is below the ` +
        `${CONFIDENCE_THRESHOLD} threshold`,
    );
  }

  if (reasons.length > 0) {
    return {
      field,
      value,
      confidence: extracted.confidence,
      disposition: 'manual_entry_required',
      reasons,
    };
  }

  if (extracted.confidence < CONFIDENCE_REVIEW_BAND) {
    return {
      field,
      value,
      confidence: extracted.confidence,
      disposition: 'suggest_flagged',
      reasons: ['confidence is above the threshold but below the clear band — check this one'],
    };
  }

  return {
    field,
    value,
    confidence: extracted.confidence,
    disposition: 'suggest',
    reasons: [],
  };
}

export interface ExtractionReview {
  readonly fields: readonly FieldReview[];
  /**
   * Always true. Present as a field rather than an implicit rule so that any
   * caller reading this object sees the constraint, and so a test can assert
   * that no code path ever produces `false`.
   */
  readonly requiresConfirmation: true;
  /** True when a critical field could not be offered as a suggestion. */
  readonly requiresManualEntry: boolean;
  readonly overallConfidence: number;
}

export function reviewExtraction(
  envelope: ExtractionEnvelope,
  today: PlainDate,
): ExtractionReview {
  const fields = EXTRACTABLE_FIELDS.map((field) =>
    reviewField(field, envelope.result.fields[field] ?? null, today),
  );

  const requiresManualEntry = fields.some(
    (review) =>
      (CRITICAL_FIELDS as readonly string[]).includes(review.field) &&
      review.disposition === 'manual_entry_required',
  );

  return {
    fields,
    requiresConfirmation: true,
    requiresManualEntry,
    overallConfidence: envelope.overallConfidence,
  };
}

/** Lowest confidence across the fields that matter — the number worth surfacing. */
export function overallConfidence(result: ExtractionResult): number {
  const critical = CRITICAL_FIELDS.map((field) => result.fields[field]).filter(
    (field): field is ExtractedField => field !== null && field !== undefined,
  );
  if (critical.length === 0) return 0;
  return Math.min(...critical.map((field) => field.confidence));
}

/**
 * The one function that decides whether a confirmed extraction may become a
 * stored value. It takes the reviewer's identity precisely because there is no
 * way to call it without one.
 */
export interface ConfirmationDecision {
  readonly accepted: boolean;
  readonly reason: string | null;
}

export function confirmField(
  review: FieldReview,
  confirmedValue: string | null,
  confirmedByUserId: string | null,
): ConfirmationDecision {
  if (confirmedByUserId === null || confirmedByUserId.trim() === '') {
    return { accepted: false, reason: 'an extracted value requires a named human confirmer' };
  }
  if (confirmedValue === null || confirmedValue.trim() === '') {
    return { accepted: false, reason: 'no value was confirmed' };
  }
  if ((review.field === 'issuedOn' || review.field === 'expiresOn') && !isPlainDate(confirmedValue)) {
    return { accepted: false, reason: 'confirmed date is not a valid calendar date' };
  }
  return { accepted: true, reason: null };
}
