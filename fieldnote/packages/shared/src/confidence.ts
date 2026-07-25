/**
 * Amber gating.
 *
 * A generated field is amber when the model was not confident enough for a
 * reviewer to skim past it. Export is blocked until every amber field has been
 * touched — which means either edited, or explicitly confirmed. This is the
 * single mechanism standing between a model guess and a signed client report,
 * so the thresholds live in one place and both surfaces import them.
 */

/** Below this, the field is amber and must be touched before export unlocks. */
export const AMBER_THRESHOLD = 0.75;

/** Below this, the value is not shown as a suggestion at all — the field reads empty. */
export const SUPPRESS_THRESHOLD = 0.35;

export type FieldFlag = 'green' | 'amber' | 'empty';

export interface ReviewableField {
  value: unknown;
  confidence: number | null;
  required: boolean;
  editedByHuman: boolean;
  reviewedAt: Date | string | null;
}

export function flagFor(field: Pick<ReviewableField, 'value' | 'confidence'>): FieldFlag {
  if (field.value === null || field.value === undefined || field.value === '') return 'empty';
  const confidence = field.confidence ?? 0;
  if (confidence < SUPPRESS_THRESHOLD) return 'empty';
  return confidence < AMBER_THRESHOLD ? 'amber' : 'green';
}

/**
 * A field counts as touched once a human has either edited it or marked it
 * reviewed. Opening the report is not touching it.
 */
export function isTouched(field: Pick<ReviewableField, 'editedByHuman' | 'reviewedAt'>): boolean {
  return field.editedByHuman || field.reviewedAt !== null;
}

export interface ExportGate {
  canExport: boolean;
  untouchedAmberCount: number;
  missingRequiredCount: number;
  reasons: string[];
}

/**
 * Decide whether export is allowed. Called on every review-workspace render and
 * again server-side immediately before a PDF is rendered — the client-side
 * check is a courtesy, the server-side check is the control.
 */
export function evaluateExportGate(fields: ReviewableField[]): ExportGate {
  let untouchedAmberCount = 0;
  let missingRequiredCount = 0;

  for (const field of fields) {
    const flag = flagFor(field);
    if (flag === 'amber' && !isTouched(field)) untouchedAmberCount += 1;
    if (
      field.required &&
      (field.value === null || field.value === undefined || field.value === '')
    ) {
      missingRequiredCount += 1;
    }
  }

  const reasons: string[] = [];
  if (untouchedAmberCount > 0) {
    reasons.push(
      `${untouchedAmberCount} low-confidence field${untouchedAmberCount === 1 ? '' : 's'} not yet reviewed`,
    );
  }
  if (missingRequiredCount > 0) {
    reasons.push(
      `${missingRequiredCount} required field${missingRequiredCount === 1 ? '' : 's'} still empty`,
    );
  }

  return {
    canExport: reasons.length === 0,
    untouchedAmberCount,
    missingRequiredCount,
    reasons,
  };
}

/**
 * Levenshtein distance, normalised to [0, 1] by the longer string.
 *
 * This is the primary product-health metric: mean human edit distance per
 * field, trending down as the phrase corpus grows. Kept here so the worker,
 * the analytics job and the eval harness all compute it identically.
 */
export function normalisedEditDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0 || b.length === 0) return 1;

  const rows = a.length + 1;
  const cols = b.length + 1;
  let previous = new Array<number>(cols);
  let current = new Array<number>(cols);

  for (let j = 0; j < cols; j += 1) previous[j] = j;

  for (let i = 1; i < rows; i += 1) {
    current[0] = i;
    for (let j = 1; j < cols; j += 1) {
      const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        (current[j - 1] ?? 0) + 1,
        (previous[j] ?? 0) + 1,
        (previous[j - 1] ?? 0) + substitutionCost,
      );
    }
    const swap = previous;
    previous = current;
    current = swap;
  }

  const distance = previous[cols - 1] ?? 0;
  return distance / Math.max(a.length, b.length);
}
