/**
 * VAT_TREATMENT_ERROR — commission charged on the wrong base.
 *
 * The common shape: the contract says commission applies to the net value of
 * the goods, and the aggregator charges it on the VAT-inclusive gross including
 * the delivery fee. The rate looks right on the statement, which is why nobody
 * spots it, and it silently costs the operator the commission rate times the
 * VAT and the delivery fee on every order.
 *
 * Detected by testing the deduction against the rate applied to the base the
 * contract does *not* specify. Matching that closely is strong evidence of a
 * wrong-base charge rather than a wrong rate, and it lets the dispute be framed
 * as "you applied our rate to the wrong figure" — a much easier argument to win
 * than a rate dispute.
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

export const vatTreatmentError: OrderRule = {
  name: 'vat_treatment_error',
  kind: 'order',
  causeCodes: ['VAT_TREATMENT_ERROR'],
  evaluate: ({ order, lines, config, materiality, currency, match }) => {
    if (order.status === 'cancelled' || order.status === 'rejected') return [];
    if (config.vatTreatment !== 'commission_on_net') return [];

    const commissionLines = linesOfType(lines, 'commission');
    if (commissionLines.length === 0) return [];

    const contractedBase = commissionBase(order, config);
    const wrongBase = alternateCommissionBase(order, config);
    if (contractedBase <= 0 || wrongBase <= contractedBase) return [];

    const expected = -applyRate(money(contractedBase, currency), config.contractedCommissionRate)
      .amountMinor;
    const onWrongBase = -applyRate(money(wrongBase, currency), config.contractedCommissionRate)
      .amountMinor;
    const actual = sumLines(commissionLines);

    // Only fire when the deduction really does look like the right rate on the
    // wrong base. Otherwise this is a rate dispute and belongs elsewhere.
    if (isMaterial(onWrongBase - actual, materiality)) return [];

    const delta = expected - actual;
    if (!isMaterial(delta, materiality)) return [];

    const draft: VarianceDraft = {
      causeCode: 'VAT_TREATMENT_ERROR',
      orderId: order.id,
      expectedMinor: expected,
      actualMinor: actual,
      currency,
      confidence: match?.confidence ?? 1,
      evidence: {
        rule: 'vat_treatment_error',
        sourceRowIds: [order.sourceRowId, ...rowIds(commissionLines)],
        computation:
          `The account is set to commission on net of VAT. ` +
          `${formatRate(config.contractedCommissionRate)} of the net goods value ` +
          `${formatMinor(contractedBase, currency)} is ${formatMinor(expected, currency)}, but ` +
          `${formatMinor(actual, currency)} was deducted — which is ` +
          `${formatRate(config.contractedCommissionRate)} of the gross ` +
          `${formatMinor(wrongBase, currency)} (VAT ${formatMinor(order.vatAmountMinor, currency)} ` +
          `and delivery fee ${formatMinor(order.deliveryFeeMinor, currency)} included). ` +
          `Overcharge: ${formatMinor(delta, currency)}.`,
        inputs: {
          contractedRate: config.contractedCommissionRate,
          netBaseMinor: contractedBase,
          grossBaseMinor: wrongBase,
          vatAmountMinor: order.vatAmountMinor,
          deliveryFeeMinor: order.deliveryFeeMinor,
          vatTreatment: config.vatTreatment,
          externalOrderId: order.externalOrderId,
        },
        matchMethod: match?.method,
        matchConfidence: match?.confidence,
      },
    };

    return [draft];
  },
};
