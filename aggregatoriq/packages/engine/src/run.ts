/**
 * The reconciliation run.
 *
 * Pure. No clock, no database, no network, no model. It takes canonical orders
 * and payouts plus the account configuration and returns matches, unmatched
 * items and variances. Persistence is the caller's job, which is what lets the
 * whole engine be tested against fixtures and what makes the idempotency
 * guarantee checkable rather than aspirational.
 *
 * Idempotency, concretely: `reconcile` called twice with the same inputs returns
 * deeply equal results, including variance ids. `asOf` is deliberately excluded
 * from the run key, so re-running March in June produces the same findings with
 * the same identities rather than a fresh set that looks like new problems.
 */
import type { Currency, MatchMethod, Period, PlainDate } from '@aggregatoriq/core';
import {
  assertCanonicalOrders,
  assertCanonicalPayout,
  selectAccountConfig,
  type AggregatorAccountConfig,
  type CanonicalOrder,
  type CanonicalPayout,
  type CanonicalPayoutLine,
  type MatchRecord,
  type UnmatchedPayoutLine,
  type Variance,
} from './domain.js';
import { defaultMateriality, type MaterialityPolicy } from './materiality.js';
import { DEFAULT_MATCH_OPTIONS, linesByOrderId, matchPayoutLines, type MatchOptions } from './matching.js';
import { ORDER_RULES, RUN_RULES } from './rules/index.js';
import {
  createVariance,
  recoveryTotalMinor,
  sortVariances,
  summariseByCause,
  type CauseSummaryRow,
  type VarianceContext,
} from './variance.js';
import { ENGINE_VERSION, RULE_SET_VERSION } from './version.js';

export interface ReconcileInput {
  readonly orgId: string;
  readonly branchId: string;
  readonly aggregatorId: string;
  readonly period: Period;
  readonly currency: Currency;
  readonly orders: readonly CanonicalOrder[];
  readonly payouts: readonly CanonicalPayout[];
  readonly configs: readonly AggregatorAccountConfig[];
  readonly materiality?: MaterialityPolicy;
  readonly matchOptions?: MatchOptions;
  /** The day the run happens. Excluded from the run key on purpose. */
  readonly asOf: PlainDate;
}

export interface ReconcileStats {
  readonly orderCount: number;
  readonly payoutCount: number;
  readonly payoutLineCount: number;
  readonly matchedOrderCount: number;
  readonly unmatchedLineCount: number;
  readonly unpaidOrderCount: number;
  readonly ordersWithoutConfig: number;
  readonly matchMethodCounts: Readonly<Record<MatchMethod, number>>;
}

export interface ReconcileResult {
  readonly runKey: string;
  readonly engineVersion: string;
  readonly ruleSetVersion: string;
  readonly matches: readonly MatchRecord[];
  readonly unmatched: readonly UnmatchedPayoutLine[];
  readonly variances: readonly Variance[];
  readonly summary: readonly CauseSummaryRow[];
  readonly recoveryTotalMinor: number;
  readonly stats: ReconcileStats;
  /**
   * Things the run could not do, surfaced rather than swallowed. An order with
   * no account configuration cannot be judged, and the operator needs to know
   * that rather than assume it was checked and found clean.
   */
  readonly warnings: readonly string[];
}

export function reconRunKey(input: {
  orgId: string;
  branchId: string;
  aggregatorId: string;
  period: Period;
}): string {
  return [
    input.orgId,
    input.branchId,
    input.aggregatorId,
    input.period.start,
    input.period.end,
    ENGINE_VERSION,
    RULE_SET_VERSION,
  ].join(':');
}

export function reconcile(input: ReconcileInput): ReconcileResult {
  // Fail loudly at the canonical boundary. A parser regression that flipped a
  // sign must not reach a rule and become a plausible-looking wrong number.
  assertCanonicalOrders(input.orders);
  for (const payout of input.payouts) assertCanonicalPayout(payout);

  const materialityPolicy = input.materiality ?? defaultMateriality(input.currency);
  const matchOptions = input.matchOptions ?? DEFAULT_MATCH_OPTIONS;
  const warnings: string[] = [];

  const orders = [...input.orders].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const payouts = [...input.payouts].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const lines: CanonicalPayoutLine[] = payouts
    .flatMap((payout) => payout.lines)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const currencyMismatches = [
    ...orders.filter((order) => order.currency !== input.currency).map((order) => order.id),
    ...lines.filter((line) => line.currency !== input.currency).map((line) => line.id),
  ];
  if (currencyMismatches.length > 0) {
    warnings.push(
      `${currencyMismatches.length} record(s) are not in ${input.currency} and were excluded — ` +
        `a reconciliation runs in one currency and converting at a rate nobody agreed would ` +
        `manufacture variances.`,
    );
  }

  const inScopeOrders = orders.filter((order) => order.currency === input.currency);
  const inScopeLines = lines.filter((line) => line.currency === input.currency);

  const match = matchPayoutLines(inScopeOrders, inScopeLines, matchOptions);
  const grouped = linesByOrderId(match.matches, inScopeLines);
  const matchByOrder = new Map(match.matches.map((record) => [record.orderId, record]));

  const context: VarianceContext = {
    orgId: input.orgId,
    branchId: input.branchId,
    aggregatorId: input.aggregatorId,
    reconRunKey: reconRunKey(input),
  };

  const variances: Variance[] = [];
  let ordersWithoutConfig = 0;

  for (const order of inScopeOrders) {
    const config = selectAccountConfig(
      input.configs,
      input.aggregatorId,
      input.branchId,
      order.localDate,
    );

    if (config === null) {
      ordersWithoutConfig += 1;
      continue;
    }

    const orderContext = {
      order,
      lines: grouped.get(order.id) ?? [],
      match: matchByOrder.get(order.id) ?? null,
      config,
      materiality: materialityPolicy,
      currency: input.currency,
    };

    for (const rule of ORDER_RULES) {
      for (const draft of rule.evaluate(orderContext)) {
        variances.push(createVariance(context, draft));
      }
    }
  }

  if (ordersWithoutConfig > 0) {
    warnings.push(
      `${ordersWithoutConfig} order(s) fall outside every configured account period for this ` +
        `aggregator and were not judged. Add the contracted rate covering those dates in ` +
        `Settings to reconcile them — inventing a rate would manufacture commission variances.`,
    );
  }

  const runContext = {
    orders: inScopeOrders,
    payouts,
    lines: inScopeLines,
    matches: match.matches,
    unmatched: match.unmatched,
    unpaidOrderIds: match.unpaidOrderIds,
    configs: input.configs,
    materiality: materialityPolicy,
    currency: input.currency,
    period: input.period,
    asOf: input.asOf,
    branchId: input.branchId,
    aggregatorId: input.aggregatorId,
  };

  for (const rule of RUN_RULES) {
    for (const draft of rule.evaluate(runContext)) {
      variances.push(createVariance(context, draft));
    }
  }

  // Two rules can legitimately arrive at the same conclusion from the same rows;
  // the deterministic id makes that a duplicate we can collapse rather than
  // double-count.
  const deduped = [...new Map(variances.map((variance) => [variance.id, variance])).values()];
  const sorted = sortVariances(deduped);

  if (match.unmatched.length > 0) {
    warnings.push(
      `${match.unmatched.length} payout line(s) could not be attributed to an order and are ` +
        `awaiting review. They are not included in any variance.`,
    );
  }

  const matchMethodCounts: Record<MatchMethod, number> = {
    exact_order_id: 0,
    order_id_and_amount: 0,
    fuzzy_time_and_amount: 0,
    manual: 0,
  };
  for (const record of match.matches) matchMethodCounts[record.method] += 1;

  return {
    runKey: context.reconRunKey,
    engineVersion: ENGINE_VERSION,
    ruleSetVersion: RULE_SET_VERSION,
    matches: match.matches,
    unmatched: match.unmatched,
    variances: sorted,
    summary: summariseByCause(sorted),
    recoveryTotalMinor: recoveryTotalMinor(sorted),
    stats: {
      orderCount: inScopeOrders.length,
      payoutCount: payouts.length,
      payoutLineCount: inScopeLines.length,
      matchedOrderCount: match.matches.length,
      unmatchedLineCount: match.unmatched.length,
      unpaidOrderCount: match.unpaidOrderIds.length,
      ordersWithoutConfig,
      matchMethodCounts,
    },
    warnings,
  };
}

/**
 * Effective margin by channel.
 *
 * What the operator actually kept, after everything the aggregator took — which
 * is a different and much less flattering number than the commission rate in the
 * contract, and is the number the margin screen exists to show.
 */
export interface MarginSummary {
  readonly grossMinor: number;
  readonly deductionsMinor: number;
  readonly netMinor: number;
  readonly effectiveCommissionRate: number | null;
  readonly contractedCommissionRate: number | null;
  readonly promoCostMinor: number;
  readonly currency: Currency;
}

export function effectiveMargin(
  payouts: readonly CanonicalPayout[],
  currency: Currency,
  contractedCommissionRate: number | null,
): MarginSummary {
  const lines = payouts.flatMap((payout) => payout.lines).filter((line) => line.currency === currency);

  const gross = lines
    .filter((line) => line.lineType === 'gross_sale')
    .reduce((total, line) => total + line.amountMinor, 0);

  const deductions = lines
    .filter((line) => line.amountMinor < 0)
    .reduce((total, line) => total + line.amountMinor, 0);

  const promoCost = lines
    .filter((line) => line.lineType === 'promo_recharge')
    .reduce((total, line) => total + line.amountMinor, 0);

  return {
    grossMinor: gross,
    deductionsMinor: deductions,
    netMinor: gross + deductions,
    effectiveCommissionRate: gross === 0 ? null : Math.abs(deductions) / gross,
    contractedCommissionRate,
    promoCostMinor: Math.abs(promoCost),
    currency,
  };
}
