/**
 * COVERAGE_GAP — a stretch of the reconciled period with orders but no statement.
 *
 * A missing period is itself a finding. It is not money owed — it is money
 * nobody has looked at, which is a different and in some ways more useful thing
 * to tell an operator, because it converts directly into an action: chase the
 * statement.
 *
 * Two details that keep this honest:
 *
 *   A gap with no orders in it is not reported. A restaurant closed for
 *   refurbishment for two weeks has no statement and no problem, and flagging
 *   that would be noise of exactly the kind that erodes trust in the rest.
 *
 *   The amount shown is the unreconciled gross, and the computation says so
 *   explicitly. It is emphatically not a claim, and the cause code's
 *   `countsTowardsRecovery: false` keeps it out of the headline number.
 */
import { findCoverageGaps, periodContains } from '@aggregatoriq/core';
import type { Period } from '@aggregatoriq/core';
import type { VarianceDraft } from '../variance.js';
import { formatMinor, type RunRule } from './contract.js';

/** How many order rows to cite. Enough to prove the gap, not the whole period. */
const MAX_CITED_ROWS = 25;

export const coverageGap: RunRule = {
  name: 'coverage_gap',
  kind: 'run',
  causeCodes: ['COVERAGE_GAP'],
  evaluate: ({ orders, payouts, currency, period }) => {
    const covered: Period[] = payouts.map((payout) => payout.period);
    const gaps = findCoverageGaps(covered, period);
    if (gaps.length === 0) return [];

    const drafts: VarianceDraft[] = [];

    for (const gap of gaps) {
      const ordersInGap = orders
        .filter((order) => periodContains(gap, order.localDate))
        .sort((a, b) => (a.id < b.id ? -1 : 1));

      // No orders, no finding.
      if (ordersInGap.length === 0) continue;

      const unreconciledGross = ordersInGap.reduce(
        (total, order) => total + order.grossAmountMinor,
        0,
      );

      drafts.push({
        causeCode: 'COVERAGE_GAP',
        orderId: null,
        expectedMinor: unreconciledGross,
        actualMinor: 0,
        currency,
        confidence: 1,
        evidence: {
          rule: 'coverage_gap',
          sourceRowIds: ordersInGap.slice(0, MAX_CITED_ROWS).map((order) => order.sourceRowId),
          computation:
            `No statement covers ${gap.start} to ${gap.end}, but ${ordersInGap.length} order(s) ` +
            `totalling ${formatMinor(unreconciledGross, currency)} fall in that window. ` +
            `Nothing in this range has been reconciled. The amount shown is unreconciled ` +
            `gross revenue, not an amount owed — request the missing statement to resolve it.`,
          inputs: {
            gapStart: gap.start,
            gapEnd: gap.end,
            ordersInGap: ordersInGap.length,
            unreconciledGrossMinor: unreconciledGross,
            statementsHeld: payouts.length,
            citedRows: Math.min(ordersInGap.length, MAX_CITED_ROWS),
          },
        },
      });
    }

    return drafts;
  },
};
