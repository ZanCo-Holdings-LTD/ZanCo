/**
 * PROMO_COST_MISALLOCATED — the operator charged for a discount the aggregator
 * agreed to fund.
 *
 * This is the finding operators are angriest about when they see it, and the one
 * they are least able to detect themselves: the promotion was agreed in a
 * conversation or an account-manager email, the statement shows a promo
 * deduction, and nobody reconciles the two. A campaign the aggregator was
 * funding entirely turns up as a full charge to the operator, on every order in
 * the campaign.
 *
 * Two sources of "what actually happened", preferred in this order:
 *
 *   1. `promo_recharge` payout lines — what was actually deducted. Definitive.
 *   2. The `fundedBy` claim in the aggregator's own order export, when no
 *      recharge line exists.
 *
 * Compared against `promoShareTerms` on the account, which is what the contract
 * says. A promo type not named in the contract falls back to the account's
 * default share, and that fallback is stated in the evidence so a reviewer knows
 * the claim rests on a default rather than a named term.
 */
import { applyRate, money } from '@aggregatoriq/core';
import { aggregatorShareFor } from '../domain.js';
import { isMaterial } from '../materiality.js';
import type { VarianceDraft } from '../variance.js';
import {
  formatMinor,
  formatRate,
  linesOfType,
  rowIds,
  sumLines,
  type OrderRule,
} from './contract.js';

export const promoCostMisallocated: OrderRule = {
  name: 'promo_cost_misallocated',
  kind: 'order',
  causeCodes: ['PROMO_COST_MISALLOCATED'],
  evaluate: ({ order, lines, config, materiality, currency, match }) => {
    if (order.status === 'cancelled' || order.status === 'rejected') return [];
    if (order.promoFunding.length === 0) return [];

    const rechargeLines = linesOfType(lines, 'promo_recharge');
    const drafts: VarianceDraft[] = [];

    // Total agreed operator share across every promotion on the order.
    let expectedOperatorCost = 0;
    const workings: string[] = [];
    let usedDefaultShare = false;

    for (const promo of order.promoFunding) {
      if (promo.amountMinor <= 0) continue;

      const named = config.promoShareTerms.terms.some(
        (term) => term.promoType.trim().toLowerCase() === promo.promoType.trim().toLowerCase(),
      );
      if (!named) usedDefaultShare = true;

      const agreedShare = aggregatorShareFor(config.promoShareTerms, promo.promoType);
      const operatorShare = 1 - agreedShare;
      const operatorCost = applyRate(money(promo.amountMinor, currency), operatorShare).amountMinor;
      expectedOperatorCost += operatorCost;

      workings.push(
        `"${promo.promoType}" discount ${formatMinor(promo.amountMinor, currency)}: aggregator ` +
          `funds ${formatRate(agreedShare)}${named ? '' : ' (account default, not a named term)'}, ` +
          `so the operator's share is ${formatMinor(operatorCost, currency)}`,
      );
    }

    if (workings.length === 0) return [];

    const expected = -expectedOperatorCost;

    // Prefer what was actually deducted over what the export claims.
    const actual =
      rechargeLines.length > 0
        ? sumLines(rechargeLines)
        : -claimedOperatorCost(order, currency);

    const delta = expected - actual;
    if (delta <= 0 || !isMaterial(delta, materiality)) return [];

    const evidenceRows =
      rechargeLines.length > 0
        ? [order.sourceRowId, ...rowIds(rechargeLines)]
        : [order.sourceRowId];

    drafts.push({
      causeCode: 'PROMO_COST_MISALLOCATED',
      orderId: order.id,
      expectedMinor: expected,
      actualMinor: actual,
      currency,
      confidence: match?.confidence ?? 1,
      evidence: {
        rule: 'promo_cost_misallocated',
        sourceRowIds: evidenceRows,
        computation:
          `${workings.join('. ')}. Total agreed operator share: ` +
          `${formatMinor(expected, currency)}. ` +
          `${
            rechargeLines.length > 0
              ? `The payout recharged ${formatMinor(actual, currency)} across ${rechargeLines.length} line(s)`
              : `The order export attributes ${formatMinor(actual, currency)} to the operator (no recharge line found)`
          }. Overcharge: ${formatMinor(delta, currency)}.`,
        inputs: {
          promoCount: order.promoFunding.length,
          discountTotalMinor: order.discountTotalMinor,
          expectedOperatorCostMinor: expectedOperatorCost,
          defaultAggregatorSharePct: config.promoShareTerms.defaultAggregatorSharePct,
          usedDefaultShare: usedDefaultShare ? 'yes' : 'no',
          rechargeLineCount: rechargeLines.length,
          externalOrderId: order.externalOrderId,
        },
        matchMethod: match?.method,
        matchConfidence: match?.confidence,
      },
    });

    return drafts;
  },
};

/**
 * What the aggregator's own export says the operator funded. Used only when
 * there is no recharge line to read the truth from.
 */
function claimedOperatorCost(
  order: Parameters<OrderRule['evaluate']>[0]['order'],
  currency: Parameters<OrderRule['evaluate']>[0]['currency'],
): number {
  let total = 0;
  for (const promo of order.promoFunding) {
    if (promo.amountMinor <= 0) continue;

    if (promo.aggregatorSharePct !== null) {
      total += applyRate(money(promo.amountMinor, currency), 1 - promo.aggregatorSharePct)
        .amountMinor;
      continue;
    }

    switch (promo.fundedBy) {
      case 'operator':
        total += promo.amountMinor;
        break;
      case 'shared':
        total += applyRate(money(promo.amountMinor, currency), 0.5).amountMinor;
        break;
      case 'aggregator':
      case 'customer':
        break;
    }
  }
  return total;
}
