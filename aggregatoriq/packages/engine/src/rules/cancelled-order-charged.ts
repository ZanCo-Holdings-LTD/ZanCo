/**
 * CANCELLED_ORDER_CHARGED — a deduction against an order the aggregator's own
 * export records as cancelled or rejected.
 *
 * The strongest cause code in the taxonomy to dispute, because the evidence is
 * the aggregator's own data on both sides: their order export says cancelled,
 * their payout statement says commission. There is no interpretation to argue
 * about, which is why this is usually the first claim a design partner submits.
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

export const cancelledOrderCharged: OrderRule = {
  name: 'cancelled_order_charged',
  kind: 'order',
  causeCodes: ['CANCELLED_ORDER_CHARGED'],
  evaluate: ({ order, lines, materiality, currency, match }) => {
    if (order.status !== 'cancelled' && order.status !== 'rejected') return [];

    // A refund line on a cancelled order is correct behaviour — the money is
    // being returned. What is not correct is the aggregator keeping its
    // commission, charging the delivery, or levying a penalty.
    const chargedLines = linesOfType(lines, 'commission', 'delivery_fee', 'penalty', 'promo_recharge');
    const actual = sumLines(chargedLines);
    if (chargedLines.length === 0 || actual >= 0) return [];

    const expected = 0;
    const delta = expected - actual;
    if (!isMaterial(delta, materiality)) return [];

    const breakdown = chargedLines
      .map((line) => `${line.lineType} ${formatMinor(line.amountMinor, currency)}`)
      .join(', ');

    const draft: VarianceDraft = {
      causeCode: 'CANCELLED_ORDER_CHARGED',
      orderId: order.id,
      expectedMinor: expected,
      actualMinor: actual,
      currency,
      confidence: match?.confidence ?? 1,
      evidence: {
        rule: 'cancelled_order_charged',
        sourceRowIds: [order.sourceRowId, ...rowIds(chargedLines)],
        computation:
          `Order ${order.externalOrderId} is recorded as ${order.status} in the order export, ` +
          `so no commission or fee is due on it. The payout nonetheless deducted ${breakdown}, ` +
          `totalling ${formatMinor(actual, currency)}. The full amount is recoverable.`,
        inputs: {
          orderStatus: order.status,
          externalOrderId: order.externalOrderId,
          grossAmountMinor: order.grossAmountMinor,
          deductedLineCount: chargedLines.length,
        },
        matchMethod: match?.method,
        matchConfidence: match?.confidence,
      },
    };

    return [draft];
  },
};
