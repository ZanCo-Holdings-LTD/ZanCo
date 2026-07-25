/**
 * MISSING_PAYOUT — an order the aggregator records as delivered that appears in
 * no payout.
 *
 * Usually the single largest recoverable line in a first reconciliation, and the
 * one an operator has no chance of finding manually: it requires holding every
 * order and every payout line for a period in mind at once.
 *
 * Three deliberate design decisions:
 *
 *   **Not thresholded per order.** Fifty unpaid 1.50 AED orders is a pattern,
 *   not noise. The materiality threshold exists to suppress rounding noise, and
 *   an entirely absent payment is not rounding.
 *
 *   **Suppressed inside a coverage gap.** If no statement covers the order's
 *   date at all, the honest finding is COVERAGE_GAP — "nobody has looked at
 *   this" — not "you were not paid". Claiming non-payment on the basis of a
 *   statement you never received is the fastest way to lose credibility.
 *
 *   **Only payable statuses.** A cancelled order should not be paid, and an
 *   order whose status could not be read is not a claim worth making.
 */
import { applyRate, isPayableStatus, money, periodContains } from '@aggregatoriq/core';
import type { Period } from '@aggregatoriq/core';
import { commissionBase, formatMinor, type RunRule } from './contract.js';
import { selectAccountConfig } from '../domain.js';
import type { VarianceDraft } from '../variance.js';

export const missingPayout: RunRule = {
  name: 'missing_payout',
  kind: 'run',
  causeCodes: ['MISSING_PAYOUT'],
  evaluate: ({
    orders,
    payouts,
    unpaidOrderIds,
    configs,
    currency,
    period,
    aggregatorId,
    branchId,
  }) => {
    if (unpaidOrderIds.length === 0) return [];

    const unpaid = new Set(unpaidOrderIds);
    const coveredPeriods: Period[] = payouts.map((payout) => payout.period);
    const drafts: VarianceDraft[] = [];

    const candidates = orders
      .filter((order) => unpaid.has(order.id))
      .filter((order) => isPayableStatus(order.status))
      .filter((order) => periodContains(period, order.localDate))
      .sort((a, b) => (a.id < b.id ? -1 : 1));

    for (const order of candidates) {
      // A date no statement covers is a coverage gap, not a non-payment.
      const isCovered = coveredPeriods.some((covered) => periodContains(covered, order.localDate));
      if (!isCovered) continue;

      const config = selectAccountConfig(configs, aggregatorId, branchId, order.localDate);
      if (config === null) continue;

      const base = commissionBase(order, config);
      const expectedCommission = -applyRate(
        money(base, currency),
        config.contractedCommissionRate,
      ).amountMinor;
      const expectedNet = order.grossAmountMinor + expectedCommission;

      if (expectedNet <= 0) continue;

      const searched = payouts
        .filter((payout) => periodContains(payout.period, order.localDate))
        .map((payout) => payout.externalPayoutId)
        .sort();

      drafts.push({
        causeCode: 'MISSING_PAYOUT',
        orderId: order.id,
        expectedMinor: expectedNet,
        actualMinor: 0,
        currency,
        // The order is definitely absent from the payouts we hold; what is
        // estimated is the net value, since the aggregator never stated it.
        confidence: 0.9,
        evidence: {
          rule: 'missing_payout',
          sourceRowIds: [order.sourceRowId],
          computation:
            `Order ${order.externalOrderId} of ${formatMinor(order.grossAmountMinor, currency)} ` +
            `is recorded as ${order.status} on ${order.localDate}, but appears in no payout line. ` +
            `Statement(s) covering that date: ${searched.join(', ') || 'none'}. ` +
            `Net due after contracted commission of ${formatMinor(expectedCommission, currency)} ` +
            `is ${formatMinor(expectedNet, currency)}.`,
          inputs: {
            externalOrderId: order.externalOrderId,
            orderStatus: order.status,
            orderLocalDate: order.localDate,
            grossAmountMinor: order.grossAmountMinor,
            expectedCommissionMinor: expectedCommission,
            payoutsSearched: searched.join(', '),
            contractedRate: config.contractedCommissionRate,
          },
        },
      });
    }

    return drafts;
  },
};
