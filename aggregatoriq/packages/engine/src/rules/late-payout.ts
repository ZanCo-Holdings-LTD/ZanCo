/**
 * LATE_PAYOUT — a payout that landed outside the contracted cycle.
 *
 * Not recoverable and never counted in the recovery total: nobody is going to
 * refund you for paying late. It is here because it is a working-capital cost
 * the operator is bearing invisibly, and because it is the single most useful
 * fact to have in hand when renegotiating terms — "you were an average of
 * eleven days late across the last quarter" is a concrete argument.
 *
 * `deltaMinor` is zero by construction. The finding is the lateness, and the
 * amount involved is recorded in the inputs rather than pretended to be a claim.
 */
import { addDays, daysBetween } from '@aggregatoriq/core';
import type { VarianceDraft } from '../variance.js';
import { selectAccountConfig } from '../domain.js';
import { formatMinor, type RunRule } from './contract.js';

export const latePayout: RunRule = {
  name: 'late_payout',
  kind: 'run',
  causeCodes: ['LATE_PAYOUT'],
  evaluate: ({ payouts, configs, currency, aggregatorId, branchId }) => {
    const drafts: VarianceDraft[] = [];

    for (const payout of [...payouts].sort((a, b) => (a.id < b.id ? -1 : 1))) {
      if (payout.paidOn === null) continue;

      const config = selectAccountConfig(configs, aggregatorId, branchId, payout.period.end);
      if (config === null) continue;

      const dueBy = addDays(payout.period.end, config.payoutCycleDays);
      const daysLate = daysBetween(dueBy, payout.paidOn);
      if (daysLate <= 0) continue;

      drafts.push({
        causeCode: 'LATE_PAYOUT',
        orderId: null,
        expectedMinor: 0,
        actualMinor: 0,
        currency,
        confidence: 1,
        evidence: {
          rule: 'late_payout',
          sourceRowIds: [payout.sourceRowId],
          computation:
            `Payout ${payout.externalPayoutId} covers ${payout.period.start} to ` +
            `${payout.period.end}. The contracted cycle of ${config.payoutCycleDays} days makes it ` +
            `due by ${dueBy}; it was paid on ${payout.paidOn}, ${daysLate} day(s) late. ` +
            `Net amount affected: ${formatMinor(payout.netMinor, currency)}. This is a flag, ` +
            `not a recoverable amount.`,
          inputs: {
            externalPayoutId: payout.externalPayoutId,
            periodStart: payout.period.start,
            periodEnd: payout.period.end,
            payoutCycleDays: config.payoutCycleDays,
            dueBy,
            paidOn: payout.paidOn,
            daysLate,
            netMinor: payout.netMinor,
          },
        },
      });
    }

    return drafts;
  },
};
