/**
 * The rule contract.
 *
 * Every rule is a named, pure function in this directory. Add a rule, add a
 * fixture — enforced by a test that walks the registry and fails on any rule
 * with no fixture covering it.
 *
 * Two shapes, because variances come in two shapes:
 *
 *   `OrderRule` judges one order against the terms that applied to it. This is
 *   most of the taxonomy: commission, promo, VAT, refunds, delivery fees.
 *
 *   `RunRule` needs the whole period at once. Duplicate deductions, missing
 *   payouts, coverage gaps and late payouts cannot be seen from a single order.
 *
 * Rules are deterministic: no clock, no randomness, no I/O. `asOf` is passed in.
 * This is what makes a re-run byte-identical, and byte-identical re-runs are
 * what let a customer trust the number enough to put their name to it.
 */
import type { Currency, PayoutLineType, Period, PlainDate } from '@aggregatoriq/core';
import type {
  AggregatorAccountConfig,
  CanonicalOrder,
  CanonicalPayout,
  CanonicalPayoutLine,
  MatchRecord,
  UnmatchedPayoutLine,
} from '../domain.js';
import type { MaterialityPolicy } from '../materiality.js';
import type { VarianceDraft } from '../variance.js';

export interface OrderRuleContext {
  readonly order: CanonicalOrder;
  /** Payout lines attributed to this order by the matching ladder. */
  readonly lines: readonly CanonicalPayoutLine[];
  readonly match: MatchRecord | null;
  /** The terms in force on the order's own date, never today's terms. */
  readonly config: AggregatorAccountConfig;
  readonly materiality: MaterialityPolicy;
  readonly currency: Currency;
}

export interface RunRuleContext {
  readonly orders: readonly CanonicalOrder[];
  readonly payouts: readonly CanonicalPayout[];
  readonly lines: readonly CanonicalPayoutLine[];
  readonly matches: readonly MatchRecord[];
  readonly unmatched: readonly UnmatchedPayoutLine[];
  readonly unpaidOrderIds: readonly string[];
  readonly configs: readonly AggregatorAccountConfig[];
  readonly materiality: MaterialityPolicy;
  readonly currency: Currency;
  readonly period: Period;
  /** The day the run is happening, passed in so rules stay pure. */
  readonly asOf: PlainDate;
  readonly branchId: string;
  readonly aggregatorId: string;
}

export interface OrderRule {
  readonly name: string;
  readonly causeCodes: readonly string[];
  readonly kind: 'order';
  readonly evaluate: (context: OrderRuleContext) => VarianceDraft[];
}

export interface RunRule {
  readonly name: string;
  readonly causeCodes: readonly string[];
  readonly kind: 'run';
  readonly evaluate: (context: RunRuleContext) => VarianceDraft[];
}

export type Rule = OrderRule | RunRule;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

export function linesOfType(
  lines: readonly CanonicalPayoutLine[],
  ...types: readonly PayoutLineType[]
): CanonicalPayoutLine[] {
  return lines.filter((line) => types.includes(line.lineType));
}

export function sumLines(lines: readonly CanonicalPayoutLine[]): number {
  return lines.reduce((total, line) => total + line.amountMinor, 0);
}

export function rowIds(...groups: readonly (readonly CanonicalPayoutLine[])[]): string[] {
  return [...new Set(groups.flat().map((line) => line.sourceRowId))].sort();
}

/**
 * The amount commission should be calculated on.
 *
 * `commission_on_net` means commission applies to the value of the goods,
 * excluding VAT and excluding the delivery fee. `commission_on_gross` means the
 * aggregator applies it to the whole order value. Which one a contract says is
 * the single most common source of a systematic overcharge, which is why
 * VAT_TREATMENT_ERROR is its own cause code rather than being folded into a
 * rate mismatch.
 */
export function commissionBase(
  order: CanonicalOrder,
  config: AggregatorAccountConfig,
): number {
  switch (config.vatTreatment) {
    case 'commission_on_net':
      return order.itemTotalMinor;
    case 'commission_on_gross':
      return order.grossAmountMinor;
    case 'zero_rated':
    case 'exempt':
      return order.itemTotalMinor;
    default:
      return order.itemTotalMinor;
  }
}

/** The base the contract does *not* specify — used to detect a wrong-base charge. */
export function alternateCommissionBase(
  order: CanonicalOrder,
  config: AggregatorAccountConfig,
): number {
  return config.vatTreatment === 'commission_on_gross'
    ? order.itemTotalMinor
    : order.grossAmountMinor;
}

export function formatMinor(amountMinor: number, currency: Currency): string {
  const exponent = currency === 'KWD' || currency === 'BHD' || currency === 'OMR' ? 3 : 2;
  const negative = amountMinor < 0;
  const digits = Math.abs(amountMinor).toString().padStart(exponent + 1, '0');
  const whole = digits.slice(0, digits.length - exponent);
  const fraction = digits.slice(digits.length - exponent);
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

export function formatRate(rate: number): string {
  return `${(rate * 100).toFixed(2)}%`;
}
