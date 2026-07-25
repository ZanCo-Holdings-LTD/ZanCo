/**
 * DELIVERY_FEE_MISATTRIBUTED — a delivery fee charged to the operator on an
 * account where, under the terms, someone else bears it.
 *
 * Most often appears after a tariff change on the aggregator's side that was
 * never reflected in the operator's contract, or on orders routed through a
 * different fulfilment mode than the account was set up for. Small per order and
 * large per month.
 */
import { isMaterial } from '../materiality.js';
import type { VarianceDraft } from '../variance.js';
import {
  formatMinor,
  linesOfType,
  rowIds,
  sumLines,
  type OrderRule,
} from './contract.js';

export const deliveryFeeMisattributed: OrderRule = {
  name: 'delivery_fee_misattributed',
  kind: 'order',
  causeCodes: ['DELIVERY_FEE_MISATTRIBUTED'],
  evaluate: ({ order, lines, config, materiality, currency, match }) => {
    // If the operator is contracted to bear delivery, a delivery charge is
    // simply correct and there is nothing to claim.
    if (config.deliveryFeeBearer === 'operator') return [];
    if (order.status === 'cancelled' || order.status === 'rejected') return [];

    const feeLines = linesOfType(lines, 'delivery_fee');
    const actual = sumLines(feeLines);
    if (feeLines.length === 0 || actual >= 0) return [];

    const expected = 0;
    const delta = expected - actual;
    if (!isMaterial(delta, materiality)) return [];

    const draft: VarianceDraft = {
      causeCode: 'DELIVERY_FEE_MISATTRIBUTED',
      orderId: order.id,
      expectedMinor: expected,
      actualMinor: actual,
      currency,
      confidence: match?.confidence ?? 1,
      evidence: {
        rule: 'delivery_fee_misattributed',
        sourceRowIds: [order.sourceRowId, ...rowIds(feeLines)],
        computation:
          `Under the account terms the ${config.deliveryFeeBearer} bears the delivery fee, so ` +
          `no delivery charge should reach the operator on order ${order.externalOrderId}. ` +
          `The payout deducted ${formatMinor(actual, currency)}.`,
        inputs: {
          deliveryFeeBearer: config.deliveryFeeBearer,
          orderDeliveryFeeMinor: order.deliveryFeeMinor,
          externalOrderId: order.externalOrderId,
          accountConfigId: config.id,
        },
        matchMethod: match?.method,
        matchConfidence: match?.confidence,
      },
    };

    return [draft];
  },
};
