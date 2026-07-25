/**
 * Confidence policy.
 *
 * "A wrong expiry date is catastrophic." So the rule this module encodes is
 * blunt: a model's output is a *draft*, and the only question is how much of it
 * a human must look at before it becomes a record.
 */

import type { ExtractedField, ExtractionResult, ExtractionSchema, FieldSpec } from "./types";

export const CONFIDENCE_THRESHOLDS = {
  /** Below this, a field is presented pre-flagged and empty-by-default. */
  reject: 0.55,
  /** Below this, the field is highlighted for review but pre-filled. */
  review: 0.85,
  /** At or above this a non-critical field may pass without a second look. */
  accept: 0.85,
} as const;

export type FieldVerdict = "confirmed" | "review" | "rejected";

export interface ReviewField extends ExtractedField {
  spec: FieldSpec;
  verdict: FieldVerdict;
  /** True when the value failed a deterministic check, not a confidence check. */
  invalid: boolean;
  reason: string | null;
}

export interface ReviewPlan {
  documentTypeCode: string | null;
  classificationVerdict: FieldVerdict;
  fields: ReviewField[];
  /**
   * The pipeline never auto-commits when this is true, which — given every
   * document type marks its expiry date critical — is essentially always.
   * Deliberate: human confirmation is the product's safety guarantee.
   */
  requiresHumanConfirmation: boolean;
  blockingReasons: string[];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Deterministic validation. Runs after the model, and outranks it. */
export function validateField(field: ExtractedField, spec: FieldSpec): { invalid: boolean; reason: string | null } {
  if (field.value === null || field.value.trim() === "") {
    return spec.required
      ? { invalid: true, reason: "Required field not found in the document" }
      : { invalid: false, reason: null };
  }

  const value = field.value.trim();

  if (spec.kind === "date") {
    if (!ISO_DATE.test(value)) return { invalid: true, reason: "Not a YYYY-MM-DD date" };

    const [year, month, day] = value.split("-").map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    // `Date.UTC` silently rolls 30 February over to 2 March, so compare the
    // components back: an impossible date on a scan is a misread digit.
    if (
      Number.isNaN(parsed.getTime()) ||
      parsed.getUTCFullYear() !== year ||
      parsed.getUTCMonth() !== month - 1 ||
      parsed.getUTCDate() !== day
    ) {
      return { invalid: true, reason: "Not a real calendar date" };
    }
    // A visa expiring in 1907 or 2431 is an OCR digit slip, not a document.
    if (year < 1950 || year > 2100) return { invalid: true, reason: `Implausible year ${year}` };
  }

  if (spec.kind === "number" && !/^[\d\s\-/]+$/.test(value)) {
    return { invalid: true, reason: "Contains characters that are not digits or separators" };
  }

  if (spec.pattern) {
    try {
      if (!new RegExp(spec.pattern).test(value)) {
        return { invalid: true, reason: "Does not match the expected format" };
      }
    } catch {
      // A malformed pattern in the taxonomy must not block an upload.
    }
  }

  return { invalid: false, reason: null };
}

export function verdictFor(confidence: number, spec: FieldSpec, invalid: boolean): FieldVerdict {
  if (invalid) return "rejected";
  if (confidence < CONFIDENCE_THRESHOLDS.reject) return "rejected";
  if (spec.critical) return "review"; // never auto-confirmed, whatever the score
  if (confidence < CONFIDENCE_THRESHOLDS.review) return "review";
  return "confirmed";
}

export function buildReviewPlan(result: ExtractionResult, schema: ExtractionSchema): ReviewPlan {
  const byKey = new Map(result.fields.map((field) => [field.key, field]));
  const fields: ReviewField[] = schema.fields.map((spec) => {
    const extracted = byKey.get(spec.key) ?? { key: spec.key, value: null, confidence: 0 };
    const { invalid, reason } = validateField(extracted, spec);
    return {
      ...extracted,
      spec,
      invalid,
      reason,
      verdict: verdictFor(extracted.confidence, spec, invalid),
    };
  });

  const blockingReasons: string[] = [];
  if (result.classification.confidence < CONFIDENCE_THRESHOLDS.review) {
    blockingReasons.push("Document type is uncertain — confirm it before saving.");
  }
  for (const field of fields) {
    if (field.verdict === "rejected") {
      blockingReasons.push(`${field.spec.label}: ${field.reason ?? "low confidence"}`);
    } else if (field.verdict === "review" && field.spec.critical) {
      blockingReasons.push(`${field.spec.label} must be checked against the source document.`);
    }
  }
  for (const warning of result.warnings) blockingReasons.push(warning);

  return {
    documentTypeCode: result.classification.documentTypeCode,
    classificationVerdict: verdictFor(
      result.classification.confidence,
      { key: "documentType", label: "Document type", kind: "text", critical: true },
      result.classification.documentTypeCode === null,
    ),
    fields,
    requiresHumanConfirmation: true,
    blockingReasons,
  };
}

/**
 * Field-level accuracy against a labelled set — the number the week-13 kill
 * criterion is measured on (under 90% and the product stops).
 */
export function fieldAccuracy(
  predictions: Array<{ key: string; value: string | null }>,
  truth: Array<{ key: string; value: string | null }>,
): { accuracy: number; correct: number; total: number; misses: string[] } {
  const predicted = new Map(predictions.map((field) => [field.key, normalise(field.value)]));
  const misses: string[] = [];
  let correct = 0;
  for (const expected of truth) {
    const actual = predicted.get(expected.key) ?? null;
    if (actual === normalise(expected.value)) correct += 1;
    else misses.push(expected.key);
  }
  return {
    accuracy: truth.length === 0 ? 0 : correct / truth.length,
    correct,
    total: truth.length,
    misses,
  };
}

function normalise(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim().toLowerCase().replace(/\s+/g, " ");
  return trimmed === "" ? null : trimmed;
}
