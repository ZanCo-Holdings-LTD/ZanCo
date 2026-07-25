/**
 * The canonical shapes the engine reasons over.
 *
 * These are the *canonical layer*, not the raw layer. A parser's job is to turn
 * whatever an aggregator emits into these, carrying `sourceRowId` on every
 * value so that any number the engine later produces can be traced back to the
 * exact row of the exact document it came from. See
 * `docs/adr/0001-raw-canonical-derived-layers.md`.
 *
 * ## Sign convention
 *
 * This is load-bearing and every rule depends on it:
 *
 *   - `gross_sale` and `promo_funding` (money coming *to* the operator) are
 *     positive.
 *   - commission, refunds, cancellations, chargebacks, penalties and promo
 *     recharges (money the aggregator keeps or claws back) are **negative**.
 *
 * A parser that emits a positive commission is a bug, and `validatePayoutLine`
 * rejects it rather than quietly negating — quietly negating would turn a
 * parser regression into a plausible-looking wrong number, which in a financial
 * product is the terminal failure mode.
 */
import type {
  AggregatorCode,
  Currency,
  MatchMethod,
  OrderStatus,
  PayoutLineType,
  Period,
  PlainDate,
  VatTreatment,
} from '@aggregatoriq/core';
import { isDeductionLineType } from '@aggregatoriq/core';

// ---------------------------------------------------------------------------
// Account configuration
// ---------------------------------------------------------------------------

export type FeeBearer = 'aggregator' | 'operator' | 'customer';

export interface PromoShareTerm {
  /** Promotion type as it appears in the aggregator's export. */
  readonly promoType: string;
  /**
   * The fraction of the discount the aggregator agreed to fund, 0..1. `1` means
   * the aggregator funds it entirely and any charge to the operator is a claim.
   */
  readonly aggregatorSharePct: number;
}

export interface PromoShareTerms {
  readonly terms: readonly PromoShareTerm[];
  /** Applied to a promo type not named in the contract. */
  readonly defaultAggregatorSharePct: number;
}

/**
 * A branch's terms with one aggregator, for one period of time.
 *
 * Rates change and history matters: a March order must be judged against the
 * rate that applied in March, not the rate in the contract today. That is what
 * `effectiveFrom`/`effectiveTo` are for, and `selectAccountConfig` is the only
 * sanctioned way to pick one.
 */
export interface AggregatorAccountConfig {
  readonly id: string;
  readonly orgId: string;
  readonly branchId: string;
  readonly aggregatorId: string;
  readonly aggregatorCode: AggregatorCode;
  readonly externalStoreId: string;
  /** Contracted commission as a fraction, e.g. `0.25` for 25%. */
  readonly contractedCommissionRate: number;
  readonly promoShareTerms: PromoShareTerms;
  readonly vatTreatment: VatTreatment;
  /** e.g. `0.05` for 5% VAT. */
  readonly vatRate: number;
  readonly payoutCycleDays: number;
  readonly deliveryFeeBearer: FeeBearer;
  readonly currency: Currency;
  readonly effectiveFrom: PlainDate;
  /** Exclusive. `null` means the current terms. */
  readonly effectiveTo: PlainDate | null;
}

// ---------------------------------------------------------------------------
// Canonical orders
// ---------------------------------------------------------------------------

export interface PromoFundingEntry {
  readonly promoType: string;
  /** The discount amount, positive. */
  readonly amountMinor: number;
  /**
   * What the aggregator's export claims about who funded it. Compared against
   * the contract terms — the gap is PROMO_COST_MISALLOCATED.
   */
  readonly fundedBy: FeeBearer | 'shared';
  /** The aggregator's claimed share, when the export states one. */
  readonly aggregatorSharePct: number | null;
}

export interface CanonicalOrder {
  readonly id: string;
  readonly orgId: string;
  readonly branchId: string;
  readonly aggregatorId: string;
  readonly externalOrderId: string;
  readonly orderedAt: Date;
  /** The calendar date the order falls on *in the branch's timezone*. */
  readonly localDate: PlainDate;
  readonly grossAmountMinor: number;
  readonly itemTotalMinor: number;
  readonly deliveryFeeMinor: number;
  readonly vatAmountMinor: number;
  readonly discountTotalMinor: number;
  readonly promoFunding: readonly PromoFundingEntry[];
  readonly status: OrderStatus;
  readonly currency: Currency;
  /** The raw row this order was mapped from. Never null — lineage is mandatory. */
  readonly sourceRowId: string;
}

// ---------------------------------------------------------------------------
// Canonical payouts
// ---------------------------------------------------------------------------

export interface CanonicalPayoutLine {
  readonly id: string;
  readonly payoutId: string;
  /** `null` when the aggregator gave no order reference — itself a finding. */
  readonly externalOrderId: string | null;
  readonly lineType: PayoutLineType;
  readonly amountMinor: number;
  readonly currency: Currency;
  readonly description: string | null;
  /** Free-text reference from the statement, used to spot duplicates. */
  readonly reference: string | null;
  readonly sourceRowId: string;
}

export interface CanonicalPayout {
  readonly id: string;
  readonly orgId: string;
  readonly branchId: string;
  readonly aggregatorId: string;
  readonly externalPayoutId: string;
  readonly period: Period;
  readonly grossMinor: number;
  readonly deductionsMinor: number;
  readonly netMinor: number;
  readonly paidOn: PlainDate | null;
  readonly currency: Currency;
  readonly sourceDocumentId: string;
  /**
   * The raw row the payout header was mapped from. Present so that a
   * payout-level finding (a late payout, say) can cite a real row like every
   * other variance, rather than being the one exception to the lineage rule.
   */
  readonly sourceRowId: string;
  readonly lines: readonly CanonicalPayoutLine[];
}

export class CanonicalDataError extends Error {
  readonly issues: readonly string[];
  constructor(issues: readonly string[]) {
    super(`Canonical data rejected: ${issues.join('; ')}`);
    this.name = 'CanonicalDataError';
    this.issues = issues;
  }
}

/**
 * Reject a payout line that violates the sign convention or lacks lineage.
 *
 * Called at the canonical boundary, before any rule sees the data. A parser
 * regression should fail loudly here, not propagate into a variance.
 */
export function validatePayoutLine(line: CanonicalPayoutLine): readonly string[] {
  const issues: string[] = [];

  if (line.sourceRowId.trim() === '') {
    issues.push(`line ${line.id} has no sourceRowId — every canonical value needs lineage`);
  }
  if (!Number.isInteger(line.amountMinor)) {
    issues.push(`line ${line.id} amount ${line.amountMinor} is not an integer minor amount`);
  }
  if (isDeductionLineType(line.lineType) && line.amountMinor > 0) {
    issues.push(
      `line ${line.id} is a ${line.lineType} of +${line.amountMinor}; deductions must be ` +
        `negative. A parser emitting a positive deduction is a bug, and negating it here ` +
        `would hide the bug behind a plausible number.`,
    );
  }
  if (line.lineType === 'gross_sale' && line.amountMinor < 0) {
    issues.push(`line ${line.id} is a gross_sale of ${line.amountMinor}; sales must be positive`);
  }

  return issues;
}

export function validateOrder(order: CanonicalOrder): readonly string[] {
  const issues: string[] = [];

  if (order.sourceRowId.trim() === '') {
    issues.push(`order ${order.id} has no sourceRowId — every canonical value needs lineage`);
  }
  if (order.externalOrderId.trim() === '') {
    issues.push(`order ${order.id} has no external order id and cannot be matched`);
  }
  for (const [field, value] of [
    ['grossAmountMinor', order.grossAmountMinor],
    ['itemTotalMinor', order.itemTotalMinor],
    ['deliveryFeeMinor', order.deliveryFeeMinor],
    ['vatAmountMinor', order.vatAmountMinor],
    ['discountTotalMinor', order.discountTotalMinor],
  ] as const) {
    if (!Number.isInteger(value)) {
      issues.push(`order ${order.id} ${field} is ${value}, not an integer minor amount`);
    }
  }
  if (Number.isNaN(order.orderedAt.getTime())) {
    issues.push(`order ${order.id} has an invalid orderedAt`);
  }

  return issues;
}

export function assertCanonicalPayout(payout: CanonicalPayout): void {
  const issues = payout.lines.flatMap((line) => validatePayoutLine(line));
  if (issues.length > 0) throw new CanonicalDataError(issues);
}

export function assertCanonicalOrders(orders: readonly CanonicalOrder[]): void {
  const issues = orders.flatMap((order) => validateOrder(order));
  if (issues.length > 0) throw new CanonicalDataError(issues);
}

/**
 * The account terms in force on a given date.
 *
 * Returns `null` when no configuration covers the date. Rules must treat that
 * as "cannot judge this order" and emit nothing — inventing a rate would
 * manufacture a commission variance out of a gap in the customer's own setup.
 */
export function selectAccountConfig(
  configs: readonly AggregatorAccountConfig[],
  aggregatorId: string,
  branchId: string,
  on: PlainDate,
): AggregatorAccountConfig | null {
  const candidates = configs.filter(
    (config) =>
      config.aggregatorId === aggregatorId &&
      config.branchId === branchId &&
      config.effectiveFrom <= on &&
      (config.effectiveTo === null || on < config.effectiveTo),
  );

  if (candidates.length === 0) return null;

  // Later start wins, then a stable tie-break on id so a re-run is identical.
  return candidates.sort((a, b) =>
    a.effectiveFrom === b.effectiveFrom
      ? a.id < b.id
        ? 1
        : -1
      : a.effectiveFrom < b.effectiveFrom
        ? 1
        : -1,
  )[0]!;
}

export function aggregatorShareFor(terms: PromoShareTerms, promoType: string): number {
  const named = terms.terms.find(
    (term) => term.promoType.trim().toLowerCase() === promoType.trim().toLowerCase(),
  );
  return named?.aggregatorSharePct ?? terms.defaultAggregatorSharePct;
}

// ---------------------------------------------------------------------------
// Matches and variances (the derived layer)
// ---------------------------------------------------------------------------

export interface MatchRecord {
  readonly orderId: string;
  readonly payoutLineIds: readonly string[];
  readonly method: MatchMethod;
  readonly confidence: number;
}

export interface UnmatchedPayoutLine {
  readonly payoutLineId: string;
  readonly externalOrderId: string | null;
  readonly amountMinor: number;
  readonly lineType: PayoutLineType;
  readonly reason: 'no_order_reference' | 'no_candidate' | 'below_confidence_floor' | 'ambiguous';
  readonly sourceRowId: string;
}

/**
 * Why a variance exists, in a form a human can check.
 *
 * `sourceRowIds` is not optional and not decorative. No variance may exist
 * without source rows that resolve to real raw rows: it is enforced in
 * `createVariance`, asserted in the engine tests, and checked again by a
 * database constraint. It is the difference between a product an operator can
 * take to an aggregator and a product that just asserts things.
 */
export interface Evidence {
  readonly sourceRowIds: readonly string[];
  /** The named rule that produced this. */
  readonly rule: string;
  /** The arithmetic, written out, e.g. "expected 25% of 100.00 = 25.00". */
  readonly computation: string;
  /** The inputs the rule used, for the drill-through panel. */
  readonly inputs: Readonly<Record<string, string | number | null>>;
  readonly matchMethod?: MatchMethod;
  readonly matchConfidence?: number;
}

export interface Variance {
  /** Deterministic — the same inputs produce the same id on every re-run. */
  readonly id: string;
  readonly causeCode: string;
  readonly orgId: string;
  readonly branchId: string;
  readonly aggregatorId: string;
  readonly orderId: string | null;
  /** What should have happened, in the aggregator's sign convention. */
  readonly expectedMinor: number;
  /** What did happen. */
  readonly actualMinor: number;
  /**
   * `expectedMinor - actualMinor`. Positive means the operator is owed money.
   * The headline recovery number is the sum of positive deltas on recoverable
   * cause codes and nothing else.
   */
  readonly deltaMinor: number;
  readonly currency: Currency;
  readonly confidence: number;
  readonly evidence: Evidence;
}
