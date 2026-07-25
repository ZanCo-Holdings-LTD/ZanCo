/**
 * The cause code taxonomy.
 *
 * This is the product's intellectual property. It grows every time a real
 * dispute reveals a variance shape nobody had a code for, and it is the thing a
 * competitor cannot copy from a screenshot — the codes are visible, but the
 * detection rule, the evidence it cites and the dispute wording behind each one
 * are not.
 *
 * The seed set below is the starting position from the brief. It is *not* the
 * M0 findings: those go in `docs/m0-findings.md` and become the real taxonomy.
 * Adding a code here without a rule that emits it, and a fixture that proves the
 * rule, is caught by a test.
 *
 * `isRecoverable` drives the headline number. A code marked `flag` is real and
 * worth showing but must never be added to "you are owed this much", because
 * the fastest way to lose an operator's trust is a recovery figure that
 * includes money nobody is going to pay back.
 */

export const RECOVERABILITY = ['recoverable', 'investigate', 'flag'] as const;
export type Recoverability = (typeof RECOVERABILITY)[number];

export interface CauseCodeDefinition {
  readonly code: string;
  readonly label: string;
  readonly labelAr: string;
  readonly description: string;
  /** Which dispute-pack template argues this code. */
  readonly disputeTemplateKey: string | null;
  readonly recoverability: Recoverability;
  /**
   * Whether the amount counts towards the headline recovery number. Derived
   * from `recoverability`, stored explicitly because it is the single most
   * consequential flag in the product and should be greppable.
   */
  readonly countsTowardsRecovery: boolean;
}

function definition(
  code: string,
  label: string,
  labelAr: string,
  recoverability: Recoverability,
  disputeTemplateKey: string | null,
  description: string,
): CauseCodeDefinition {
  return {
    code,
    label,
    labelAr,
    description,
    disputeTemplateKey,
    recoverability,
    countsTowardsRecovery: recoverability === 'recoverable',
  };
}

export const CAUSE_CODES: readonly CauseCodeDefinition[] = [
  definition(
    'COMMISSION_RATE_MISMATCH',
    'Commission rate mismatch',
    'اختلاف نسبة العمولة',
    'recoverable',
    'commission_rate',
    'The commission actually deducted implies a rate different from the one in ' +
      'the contract for the period the order falls in. The difference between ' +
      'the two, on the order value, is the claim.',
  ),
  definition(
    'PROMO_COST_MISALLOCATED',
    'Promotion cost misallocated',
    'تحميل تكلفة العرض بشكل خاطئ',
    'recoverable',
    'promo_funding',
    'The operator was charged for a discount the aggregator agreed to fund, ' +
      'in whole or in part, under the promotion terms on the account.',
  ),
  definition(
    'CANCELLED_ORDER_CHARGED',
    'Commission on a cancelled order',
    'عمولة على طلب ملغى',
    'recoverable',
    'cancelled_order',
    'Commission or a fee was deducted against an order the aggregator’s own ' +
      'export records as cancelled or rejected.',
  ),
  definition(
    'REFUND_OVERCHARGED',
    'Refund exceeds order value',
    'قيمة الاسترداد تتجاوز قيمة الطلب',
    'recoverable',
    'refund_overcharge',
    'The refund deducted is larger than the gross value of the order it refers ' +
      'to. The excess is the claim.',
  ),
  definition(
    'DUPLICATE_DEDUCTION',
    'Duplicate deduction',
    'خصم مكرر',
    'recoverable',
    'duplicate_deduction',
    'The same deduction, for the same order and line type, appears more than ' +
      'once — either twice in one payout or across two payouts.',
  ),
  definition(
    'CHARGEBACK_UNSUBSTANTIATED',
    'Unsubstantiated chargeback',
    'خصم استرداد غير مُبرر',
    'recoverable',
    'chargeback',
    'A customer chargeback was passed through with no order reference and no ' +
      'supporting detail, so there is nothing for the operator to verify.',
  ),
  definition(
    'MISSING_PAYOUT',
    'Delivered order never paid',
    'طلب مُسلّم لم يُدفع',
    'recoverable',
    'missing_payout',
    'An order the aggregator records as delivered does not appear in any ' +
      'payout covering its period. The full net value is the claim.',
  ),
  definition(
    'DELIVERY_FEE_MISATTRIBUTED',
    'Delivery fee misattributed',
    'رسوم توصيل محمّلة بشكل خاطئ',
    'recoverable',
    'delivery_fee',
    'A delivery fee was charged against the operator on an order where, under ' +
      'the account terms, the aggregator or the customer bears it.',
  ),
  definition(
    'VAT_TREATMENT_ERROR',
    'VAT applied to the wrong base',
    'تطبيق ضريبة القيمة المضافة على أساس خاطئ',
    'recoverable',
    'vat_treatment',
    'VAT was computed on a base inconsistent with the account’s VAT treatment ' +
      '— most often commission charged on a VAT-inclusive gross rather than the ' +
      'net of goods.',
  ),
  definition(
    'ADJUSTMENT_UNEXPLAINED',
    'Unexplained adjustment',
    'تسوية غير مُفسّرة',
    'investigate',
    'unexplained_adjustment',
    'A deduction with no order reference and no description. Often legitimate ' +
      'once explained, which is why it is raised for investigation rather than ' +
      'counted as recoverable.',
  ),
  definition(
    'LATE_PAYOUT',
    'Payout outside the contracted cycle',
    'دفعة خارج الدورة المتفق عليها',
    'flag',
    null,
    'The payout landed later than the contracted payout cycle allows. Not ' +
      'money owed, but a working-capital cost worth raising with the account ' +
      'manager and worth knowing before renegotiating terms.',
  ),
  definition(
    'COVERAGE_GAP',
    'Period with orders but no statement',
    'فترة بها طلبات بدون كشف حساب',
    'flag',
    null,
    'Orders exist for a period with no statement covering it. Nothing can be ' +
      'reconciled here, so this is not a recoverable amount — it is a hole in ' +
      'the evidence, and the amount shown is what is unreconciled, not what is ' +
      'owed.',
  ),
];

export const CAUSE_CODE_KEYS = CAUSE_CODES.map((cause) => cause.code);
export type CauseCode = (typeof CAUSE_CODE_KEYS)[number];

const BY_CODE = new Map(CAUSE_CODES.map((cause) => [cause.code, cause]));

export function causeCode(code: string): CauseCodeDefinition | null {
  return BY_CODE.get(code) ?? null;
}

export function isCauseCode(value: string): boolean {
  return BY_CODE.has(value);
}

export function requireCauseCode(code: string): CauseCodeDefinition {
  const found = BY_CODE.get(code);
  if (!found) {
    throw new Error(
      `Unknown cause code "${code}". Every variance must carry a code from the ` +
        `taxonomy — an ad-hoc code has no dispute template and no recoverability, ` +
        `so it cannot be argued or counted.`,
    );
  }
  return found;
}

/** Codes whose amounts are added up into the headline recovery figure. */
export function recoverableCodes(): CauseCodeDefinition[] {
  return CAUSE_CODES.filter((cause) => cause.countsTowardsRecovery);
}

export const VARIANCE_STATUSES = [
  'open',
  'dismissed',
  'disputed',
  'recovered',
  'rejected',
] as const;
export type VarianceStatus = (typeof VARIANCE_STATUSES)[number];

export const DISPUTE_OUTCOMES = [
  'pending',
  'accepted',
  'partially_accepted',
  'rejected',
  'withdrawn',
] as const;
export type DisputeOutcome = (typeof DISPUTE_OUTCOMES)[number];
