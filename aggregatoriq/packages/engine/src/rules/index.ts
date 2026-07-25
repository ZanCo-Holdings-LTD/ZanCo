/**
 * The rule registry.
 *
 * Order matters for readability, not for behaviour — rules are independent and
 * the run sorts its output. Where two rules could both fire on the same
 * situation, the deferral is written into the rules themselves (see
 * `commission-rate-mismatch` deferring to `vat-treatment-error`) rather than
 * being an emergent property of registration order, because an emergent property
 * is one nobody can review.
 *
 * Adding a rule means adding it here, and a test asserts that every rule in this
 * registry has at least one fixture exercising it and that every cause code in
 * the taxonomy is emitted by some rule.
 */
import { adjustmentUnexplained } from './adjustment-unexplained.js';
import { cancelledOrderCharged } from './cancelled-order-charged.js';
import { chargebackUnsubstantiated } from './chargeback-unsubstantiated.js';
import { commissionRateMismatch } from './commission-rate-mismatch.js';
import { coverageGap } from './coverage-gap.js';
import { deliveryFeeMisattributed } from './delivery-fee-misattributed.js';
import { duplicateDeduction } from './duplicate-deduction.js';
import { latePayout } from './late-payout.js';
import { missingPayout } from './missing-payout.js';
import { promoCostMisallocated } from './promo-cost-misallocated.js';
import { refundOvercharged } from './refund-overcharged.js';
import { vatTreatmentError } from './vat-treatment-error.js';
import type { OrderRule, Rule, RunRule } from './contract.js';

export const ORDER_RULES: readonly OrderRule[] = [
  commissionRateMismatch,
  vatTreatmentError,
  cancelledOrderCharged,
  refundOvercharged,
  promoCostMisallocated,
  deliveryFeeMisattributed,
];

export const RUN_RULES: readonly RunRule[] = [
  duplicateDeduction,
  missingPayout,
  chargebackUnsubstantiated,
  adjustmentUnexplained,
  latePayout,
  coverageGap,
];

export const ALL_RULES: readonly Rule[] = [...ORDER_RULES, ...RUN_RULES];

export function ruleByName(name: string): Rule | null {
  return ALL_RULES.find((rule) => rule.name === name) ?? null;
}

/** Every cause code the registered rules can emit. */
export function emittableCauseCodes(): string[] {
  return [...new Set(ALL_RULES.flatMap((rule) => rule.causeCodes))].sort();
}

export * from './contract.js';
export {
  adjustmentUnexplained,
  cancelledOrderCharged,
  chargebackUnsubstantiated,
  commissionRateMismatch,
  coverageGap,
  deliveryFeeMisattributed,
  duplicateDeduction,
  latePayout,
  missingPayout,
  promoCostMisallocated,
  refundOvercharged,
  vatTreatmentError,
};
