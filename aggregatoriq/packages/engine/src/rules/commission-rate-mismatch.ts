/**
 * COMMISSION_RATE_MISMATCH — the commission deducted implies a rate other than
 * the contracted one.
 *
 * This is the highest-volume recoverable finding in practice, because a rate
 * that is wrong is wrong on every single order, and a quarter of a percentage
 * point across three months of volume is a large number.
 *
 * The rule defers in two situations, and both matter:
 *
 *   If the deduction matches the contracted rate applied to the *other* base
 *   (gross instead of net, typically), this is a VAT-treatment error, not a rate
 *   error. Reporting it as a rate mismatch would send the operator into an
 *   argument about the wrong thing, and it is `vat-treatment-error`'s job.
 *
 *   If the order is cancelled or rejected, any commission on it is
 *   CANCELLED_ORDER_CHARGED — the full deduction is the claim, not the
 *   difference between two rates.
 */
import { applyRate, money } from '@aggregatoriq/core';
import { isMaterial } from '../materiality.js';
import type { VarianceDraft } from '../variance.js';
import {
  alternateCommissionBase,
  commissionBase,
  formatMinor,
  formatRate,
  linesOfType,
  rowIds,
  sumLines,
  type OrderRule,
} from './contract.js';

export const commissionRateMismatch: OrderRule = {
  name: 'commission_rate_mismatch',
  kind: 'order',
  causeCodes: ['COMMISSION_RATE_MISMATCH'],
  evaluate: ({ order, lines, config, materiality, currency, match }) => {
    if (order.status === 'cancelled' || order.status === 'rejected') return [];
    if (order.status === 'unknown') return [];

    const commissionLines = linesOfType(lines, 'commission');
    if (commissionLines.length === 0) return [];

    const base = commissionBase(order, config);
    if (base <= 0) return [];

    const expected = -applyRate(money(base, currency), config.contractedCommissionRate).amountMinor;
    const actual = sumLines(commissionLines);
    const delta = expected - actual;

    if (!isMaterial(delta, materiality)) return [];

    // Defer to the VAT rule when the charge is the right rate on the wrong base.
    const altBase = alternateCommissionBase(order, config);
    const onAltBase = -applyRate(money(altBase, currency), config.contractedCommissionRate)
      .amountMinor;
    if (!isMaterial(onAltBase - actual, materiality)) return [];

    const impliedRate = base === 0 ? 0 : Math.abs(actual) / base;

    const draft: VarianceDraft = {
      causeCode: 'COMMISSION_RATE_MISMATCH',
      orderId: order.id,
      expectedMinor: expected,
      actualMinor: actual,
      currency,
      // The arithmetic is exact; the confidence in the *attribution* is the
      // match's confidence, which is what a reviewer needs to know.
      confidence: match?.confidence ?? 1,
      evidence: {
        rule: 'commission_rate_mismatch',
        sourceRowIds: [order.sourceRowId, ...rowIds(commissionLines)],
        computation:
          `Contracted rate ${formatRate(config.contractedCommissionRate)} on a ` +
          `${config.vatTreatment === 'commission_on_gross' ? 'gross' : 'net of VAT'} base of ` +
          `${formatMinor(base, currency)} gives commission of ${formatMinor(expected, currency)}. ` +
          `The statement deducted ${formatMinor(actual, currency)}, which implies a rate of ` +
          `${formatRate(impliedRate)}. Difference: ${formatMinor(delta, currency)}.`,
        inputs: {
          contractedRate: config.contractedCommissionRate,
          impliedRate: Number(impliedRate.toFixed(6)),
          commissionBaseMinor: base,
          vatTreatment: config.vatTreatment,
          externalOrderId: order.externalOrderId,
          accountConfigId: config.id,
          accountEffectiveFrom: config.effectiveFrom,
        },
        matchMethod: match?.method,
        matchConfidence: match?.confidence,
      },
    };

    return [draft];
  },
};
