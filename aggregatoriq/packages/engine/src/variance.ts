/**
 * Variance construction, and the two invariants that make the product credible.
 *
 * 1. **No variance without lineage.** `createVariance` throws if
 *    `evidence.sourceRowIds` is empty. A variance that cannot point at the rows
 *    it came from cannot be checked, cannot be disputed, and should not exist.
 *    This is enforced here, asserted in the engine tests, and checked again by a
 *    database constraint — three times, because it is the invariant a
 *    financial product dies without.
 *
 * 2. **Deterministic identity.** A variance's id is derived from its own
 *    content, so re-running an unchanged period produces byte-identical rows
 *    rather than a fresh set of ids that look like new findings.
 */
import { createHash } from 'node:crypto';
import type { Currency } from '@aggregatoriq/core';
import { requireCauseCode } from '@aggregatoriq/core';
import type { Evidence, Variance } from './domain.js';

export class MissingLineageError extends Error {
  constructor(causeCode: string, rule: string) {
    super(
      `Rule "${rule}" produced a ${causeCode} variance with no source rows. ` +
        `No variance may exist without evidence.sourceRowIds that resolve to real ` +
        `raw rows — an unsupportable finding is worse than a missed one.`,
    );
    this.name = 'MissingLineageError';
  }
}

export interface VarianceDraft {
  readonly causeCode: string;
  readonly orderId: string | null;
  readonly expectedMinor: number;
  readonly actualMinor: number;
  readonly currency: Currency;
  readonly confidence: number;
  readonly evidence: Evidence;
}

export interface VarianceContext {
  readonly orgId: string;
  readonly branchId: string;
  readonly aggregatorId: string;
  readonly reconRunKey: string;
}

/**
 * A stable id for a variance.
 *
 * Derived from what the variance *is* — the run it belongs to, the cause, the
 * order, the amounts and the exact rows cited — rather than from a random
 * generator or a clock. Two runs over unchanged inputs therefore produce the
 * same ids, which is what makes the idempotency test meaningful and lets a
 * re-run upsert rather than duplicate.
 *
 * Formatted as a UUID so it fits a `uuid` column. Version nibble is 8
 * (custom/deterministic), which is honest about it not being random.
 */
export function deterministicVarianceId(
  context: VarianceContext,
  draft: VarianceDraft,
): string {
  const material = JSON.stringify([
    context.reconRunKey,
    context.orgId,
    context.branchId,
    context.aggregatorId,
    draft.causeCode,
    draft.orderId,
    draft.expectedMinor,
    draft.actualMinor,
    draft.currency,
    draft.evidence.rule,
    [...draft.evidence.sourceRowIds].sort(),
  ]);

  const hex = createHash('sha256').update(material, 'utf8').digest('hex');

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `8${hex.slice(13, 16)}`,
    // RFC 4122 variant bits.
    `${((parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-');
}

export function createVariance(context: VarianceContext, draft: VarianceDraft): Variance {
  // Throws on an unknown code. An ad-hoc cause code has no dispute template and
  // no recoverability, so it can neither be argued nor counted.
  requireCauseCode(draft.causeCode);

  const sourceRowIds = draft.evidence.sourceRowIds.filter((id) => id.trim() !== '');
  if (sourceRowIds.length === 0) {
    throw new MissingLineageError(draft.causeCode, draft.evidence.rule);
  }

  if (!Number.isInteger(draft.expectedMinor) || !Number.isInteger(draft.actualMinor)) {
    throw new TypeError(
      `Variance amounts must be integer minor units, got expected=${draft.expectedMinor} ` +
        `actual=${draft.actualMinor}`,
    );
  }

  if (draft.confidence < 0 || draft.confidence > 1) {
    throw new RangeError(`Variance confidence must be 0..1, got ${draft.confidence}`);
  }

  // Sorted and de-duplicated so that two runs citing the same rows in a
  // different order produce the same id.
  const normalisedRowIds = [...new Set(sourceRowIds)].sort();

  const expectedMinor = normaliseZero(draft.expectedMinor);
  const actualMinor = normaliseZero(draft.actualMinor);

  const normalisedDraft: VarianceDraft = {
    ...draft,
    expectedMinor,
    actualMinor,
    evidence: { ...draft.evidence, sourceRowIds: normalisedRowIds },
  };

  return {
    id: deterministicVarianceId(context, normalisedDraft),
    causeCode: draft.causeCode,
    orgId: context.orgId,
    branchId: context.branchId,
    aggregatorId: context.aggregatorId,
    orderId: draft.orderId,
    expectedMinor,
    actualMinor,
    deltaMinor: normaliseZero(expectedMinor - actualMinor),
    currency: draft.currency,
    confidence: draft.confidence,
    evidence: normalisedDraft.evidence,
  };
}

/**
 * Collapse `-0` to `0`.
 *
 * Negating a zero amount — which happens whenever an expected cost works out to
 * nothing — yields `-0`, and `-0` is a genuine nuisance here: it survives into
 * the deterministic id material, it compares unequal to `0` under `Object.is`,
 * and it reaches a customer's screen as "-0.00". Normalised once, at the only
 * place a variance can be created.
 */
function normaliseZero(value: number): number {
  return value === 0 ? 0 : value;
}

/**
 * The headline number.
 *
 * Only positive deltas on cause codes marked recoverable. Two deliberate
 * exclusions:
 *
 *   Flags (LATE_PAYOUT, COVERAGE_GAP) are real and shown, but they are not money
 *   anyone is going to pay back, and a recovery figure inflated with them is a
 *   figure that collapses the first time an operator checks it.
 *
 *   Negative deltas — cases where the aggregator undercharged — are not netted
 *   off. They are not claims, and handing an aggregator a list of ways they
 *   underbilled you is not a service the customer is paying for. They remain
 *   visible on the variance list, just not in the total.
 */
export function recoveryTotalMinor(variances: readonly Variance[]): number {
  return variances
    .filter((variance) => {
      const cause = requireCauseCode(variance.causeCode);
      return cause.countsTowardsRecovery && variance.deltaMinor > 0;
    })
    .reduce((total, variance) => total + variance.deltaMinor, 0);
}

export interface CauseSummaryRow {
  readonly causeCode: string;
  readonly count: number;
  readonly totalDeltaMinor: number;
  readonly countsTowardsRecovery: boolean;
}

/** Grouped by cause, ordered by the money at stake. Drives the run summary. */
export function summariseByCause(variances: readonly Variance[]): CauseSummaryRow[] {
  const groups = new Map<string, { count: number; total: number }>();

  for (const variance of variances) {
    const existing = groups.get(variance.causeCode) ?? { count: 0, total: 0 };
    groups.set(variance.causeCode, {
      count: existing.count + 1,
      total: existing.total + variance.deltaMinor,
    });
  }

  return [...groups.entries()]
    .map(([code, group]) => ({
      causeCode: code,
      count: group.count,
      totalDeltaMinor: group.total,
      countsTowardsRecovery: requireCauseCode(code).countsTowardsRecovery,
    }))
    .sort((a, b) =>
      b.totalDeltaMinor === a.totalDeltaMinor
        ? a.causeCode < b.causeCode
          ? -1
          : 1
        : b.totalDeltaMinor - a.totalDeltaMinor,
    );
}

/**
 * Stable ordering for storage and comparison. Re-running a period must produce
 * byte-identical output, which means the *order* has to be deterministic too.
 */
export function sortVariances(variances: readonly Variance[]): Variance[] {
  return [...variances].sort((a, b) => {
    if (a.causeCode !== b.causeCode) return a.causeCode < b.causeCode ? -1 : 1;
    if (a.deltaMinor !== b.deltaMinor) return b.deltaMinor - a.deltaMinor;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
