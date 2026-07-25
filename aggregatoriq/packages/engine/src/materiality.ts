/**
 * Materiality.
 *
 * Variance noise destroys trust faster than missed variances. An operator who
 * opens the product and sees four hundred findings worth 3 fils each concludes
 * the engine is broken, and they are not wrong to — a one-fils rounding
 * difference between the aggregator's arithmetic and ours is not a claim.
 *
 * So every rule filters through here before emitting. The threshold is
 * per-organisation and configurable, defaulting to one unit of currency: 1.00
 * AED, 1.00 SAR, 1.000 KWD.
 *
 * Two exceptions are deliberate, and both are marked at their call sites:
 *
 *   MISSING_PAYOUT is not thresholded on the individual order. Fifty unpaid
 *   1.50 AED orders is a pattern, not noise, and suppressing each one
 *   individually would hide it.
 *
 *   COVERAGE_GAP and LATE_PAYOUT are not amounts at all, so materiality does
 *   not apply.
 */
import type { Currency } from '@aggregatoriq/core';
import { oneUnit } from '@aggregatoriq/core';

export interface MaterialityPolicy {
  readonly thresholdMinor: number;
  readonly currency: Currency;
}

export function defaultMateriality(currency: Currency): MaterialityPolicy {
  return { thresholdMinor: oneUnit(currency), currency };
}

export function materiality(thresholdMinor: number, currency: Currency): MaterialityPolicy {
  if (!Number.isInteger(thresholdMinor) || thresholdMinor < 0) {
    throw new TypeError(
      `Materiality threshold must be a non-negative integer minor amount, got ${thresholdMinor}`,
    );
  }
  return { thresholdMinor, currency };
}

/**
 * Whether a delta is worth raising. Compared on absolute value so that an
 * under-deduction is filtered by the same threshold as an over-deduction, and
 * `>=` so that a threshold of exactly 1.00 includes a 1.00 variance.
 */
export function isMaterial(deltaMinor: number, policy: MaterialityPolicy): boolean {
  return Math.abs(deltaMinor) >= policy.thresholdMinor;
}
