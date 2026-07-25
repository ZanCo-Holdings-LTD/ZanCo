/**
 * REFUND_OVERCHARGED — the refund deducted exceeds the value of the order it
 * refers to.
 *
 * Arises from a refund applied twice under different line types, from a refund
 * that includes the delivery fee the aggregator collected, and from
 * currency-unit slips in manual adjustments. Bounded by the order's own gross
 * value, which is the aggregator's figure, so the ceiling is not arguable.
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

export const refundOvercharged: OrderRule = {
  name: 'refund_overcharged',
  kind: 'order',
  causeCodes: ['REFUND_OVERCHARGED'],
  evaluate: ({ order, lines, materiality, currency, match }) => {
    const refundLines = linesOfType(lines, 'refund');
    if (refundLines.length === 0) return [];

    const actual = sumLines(refundLines);
    if (actual >= 0) return [];

    // A refund can legitimately reach the full gross value of the order and no
    // further. Anything beyond that is money the operator never received.
    const ceiling = -order.grossAmountMinor;
    if (actual >= ceiling) return [];

    const delta = ceiling - actual;
    if (!isMaterial(delta, materiality)) return [];

    const draft: VarianceDraft = {
      causeCode: 'REFUND_OVERCHARGED',
      orderId: order.id,
      expectedMinor: ceiling,
      actualMinor: actual,
      currency,
      confidence: match?.confidence ?? 1,
      evidence: {
        rule: 'refund_overcharged',
        sourceRowIds: [order.sourceRowId, ...rowIds(refundLines)],
        computation:
          `Order ${order.externalOrderId} has a gross value of ` +
          `${formatMinor(order.grossAmountMinor, currency)}, so a full refund cannot exceed ` +
          `${formatMinor(ceiling, currency)}. The payout deducted ` +
          `${formatMinor(actual, currency)} across ${refundLines.length} refund line(s). ` +
          `The excess of ${formatMinor(delta, currency)} is recoverable.`,
        inputs: {
          externalOrderId: order.externalOrderId,
          grossAmountMinor: order.grossAmountMinor,
          refundLineCount: refundLines.length,
          orderStatus: order.status,
        },
        matchMethod: match?.method,
        matchConfidence: match?.confidence,
      },
    };

    return [draft];
  },
};
