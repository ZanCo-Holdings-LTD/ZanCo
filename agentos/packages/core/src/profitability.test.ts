import { describe, expect, it } from 'vitest';
import {
  computeEntityProfitability,
  onTimeRenewalRate,
  reconciliationExceptions,
  timeToFiftyEntities,
  unrechargedFees,
  type FeeLedgerEntry,
} from './profitability.js';
import {
  PLANS,
  annualMonthsEquivalent,
  planForEntityCount,
  planPosition,
  subscriptionAllowsOutbound,
  subscriptionAllowsReads,
  subscriptionAllowsWrites,
} from './billing/plans.js';

function fee(overrides: Partial<FeeLedgerEntry> = {}): FeeLedgerEntry {
  return {
    id: 'fee-1',
    entityId: 'ent-1',
    amountMinor: 100_000,
    currency: 'AED',
    recharged: false,
    invoiceId: null,
    paidOn: '2026-01-05',
    ...overrides,
  };
}

describe('computeEntityProfitability', () => {
  it('nets revenue against disbursements and time', () => {
    const { profitability } = computeEntityProfitability({
      entityId: 'ent-1',
      currency: 'AED',
      invoiceLines: [{ entityId: 'ent-1', amountMinor: 500_000, currency: 'AED', issuedOn: '2026-01-31' }],
      fees: [fee({ amountMinor: 200_000, recharged: true, invoiceId: 'inv-1' })],
      timeLogs: [{ entityId: 'ent-1', minutes: 120, hourlyCostMinor: 15_000, currency: 'AED' }],
    });

    expect(profitability.revenue.amountMinor).toBe(500_000);
    expect(profitability.disbursements.amountMinor).toBe(200_000);
    expect(profitability.timeCost.amountMinor).toBe(30_000);
    expect(profitability.netMinor).toBe(270_000);
    expect(profitability.marginPct).toBeCloseTo(0.54);
    expect(profitability.loggedMinutes).toBe(120);
  });

  it('surfaces money that went out and never came back', () => {
    const { profitability } = computeEntityProfitability({
      entityId: 'ent-1',
      currency: 'AED',
      invoiceLines: [],
      fees: [
        fee({ id: 'a', amountMinor: 300_000, recharged: false }),
        fee({ id: 'b', amountMinor: 100_000, recharged: true, invoiceId: 'inv-1' }),
      ],
      timeLogs: [],
    });
    expect(profitability.disbursements.amountMinor).toBe(400_000);
    expect(profitability.recharged.amountMinor).toBe(100_000);
    expect(profitability.unrecharged.amountMinor).toBe(300_000);
  });

  it('skips entries in another currency rather than converting at a guess', () => {
    const { profitability, skippedEntries } = computeEntityProfitability({
      entityId: 'ent-1',
      currency: 'AED',
      invoiceLines: [{ entityId: 'ent-1', amountMinor: 999, currency: 'SAR', issuedOn: '2026-01-31' }],
      fees: [fee({ currency: 'SAR' })],
      timeLogs: [],
    });
    expect(skippedEntries).toBe(2);
    expect(profitability.revenue.amountMinor).toBe(0);
    expect(profitability.disbursements.amountMinor).toBe(0);
  });

  it('reports no margin rather than dividing by zero', () => {
    const { profitability } = computeEntityProfitability({
      entityId: 'ent-1',
      currency: 'AED',
      invoiceLines: [],
      fees: [],
      timeLogs: [],
    });
    expect(profitability.marginPct).toBeNull();
  });
});

describe('fee reconciliation', () => {
  it('lists unrecharged paid fees, biggest first', () => {
    const list = unrechargedFees([
      fee({ id: 'small', amountMinor: 5_000 }),
      fee({ id: 'big', amountMinor: 900_000 }),
      fee({ id: 'done', recharged: true, invoiceId: 'inv-1' }),
      fee({ id: 'unpaid', paidOn: null }),
    ]);
    expect(list.map((f) => f.id)).toEqual(['big', 'small']);
  });

  it('catches fees marked recharged with no invoice behind them', () => {
    const exceptions = reconciliationExceptions([
      fee({ id: 'gap', recharged: true, invoiceId: null }),
      fee({ id: 'ok', recharged: true, invoiceId: 'inv-1' }),
    ]);
    expect(exceptions.map((f) => f.id)).toEqual(['gap']);
  });
});

describe('onTimeRenewalRate', () => {
  it('counts a renewal closed on the due date as on time', () => {
    const result = onTimeRenewalRate(
      [{ dueOn: '2026-01-10', completedOn: '2026-01-10', status: 'completed' }],
      '2026-02-01',
    );
    expect(result.rate).toBe(1);
  });

  it('counts an open, overdue renewal against the rate', () => {
    // Excluding it would make the number look best exactly when things are worst.
    const result = onTimeRenewalRate(
      [{ dueOn: '2026-01-10', completedOn: null, status: 'open' }],
      '2026-02-01',
    );
    expect(result.rate).toBe(0);
    expect(result.late).toBe(1);
  });

  it('ignores renewals that are not yet due and cancelled ones', () => {
    const result = onTimeRenewalRate(
      [
        { dueOn: '2026-06-01', completedOn: null, status: 'open' },
        { dueOn: '2026-01-01', completedOn: null, status: 'cancelled' },
      ],
      '2026-02-01',
    );
    expect(result.total).toBe(0);
    expect(result.rate).toBeNull();
  });

  it('mixes on-time and late correctly', () => {
    const result = onTimeRenewalRate(
      [
        { dueOn: '2026-01-10', completedOn: '2026-01-05', status: 'completed' },
        { dueOn: '2026-01-10', completedOn: '2026-01-15', status: 'completed' },
        { dueOn: '2026-01-10', completedOn: '2026-01-09', status: 'completed' },
        { dueOn: '2026-01-10', completedOn: '2026-01-10', status: 'completed' },
      ],
      '2026-02-01',
    );
    expect(result.onTime).toBe(3);
    expect(result.late).toBe(1);
    expect(result.rate).toBe(0.75);
  });
});

describe('timeToFiftyEntities', () => {
  it('is null until the fiftieth entity lands', () => {
    expect(timeToFiftyEntities('2026-01-01', ['2026-01-02'])).toBeNull();
  });

  it('measures to the fiftieth, not the last', () => {
    const dates = Array.from({ length: 60 }, (_, i) => (i < 50 ? '2026-01-04' : '2026-03-01'));
    expect(timeToFiftyEntities('2026-01-01', dates)).toBe(3);
  });
});

describe('pricing', () => {
  it('tiers on managed entity count', () => {
    expect(planForEntityCount(1).code).toBe('starter');
    expect(planForEntityCount(100).code).toBe('starter');
    expect(planForEntityCount(101).code).toBe('growth');
    expect(planForEntityCount(300).code).toBe('growth');
    expect(planForEntityCount(301).code).toBe('scale');
    expect(planForEntityCount(5_000).code).toBe('scale');
  });

  it('prices annual at ten months', () => {
    for (const plan of PLANS) {
      expect(annualMonthsEquivalent(plan.code)).toBe(10);
    }
  });

  it('holds the published monthly prices', () => {
    expect(PLANS.map((p) => p.monthlyMinor)).toEqual([24_900, 39_900, 59_900]);
    expect(PLANS.every((p) => p.currency === 'GBP')).toBe(true);
  });

  it('reports headroom and tells a firm when they have outgrown their tier', () => {
    const inTier = planPosition('starter', 80);
    expect(inTier.overTier).toBe(false);
    expect(inTier.headroom).toBe(20);

    const outgrown = planPosition('starter', 140);
    expect(outgrown.overTier).toBe(true);
    expect(outgrown.requiredPlan.code).toBe('growth');
    expect(planPosition('scale', 5_000).headroom).toBeNull();
  });
});

describe('subscription gating', () => {
  it('never revokes read access', () => {
    // A firm whose card failed still has to see which licences expire this week.
    expect(subscriptionAllowsReads()).toBe(true);
  });

  it('stops writes and outbound only once the subscription is really gone', () => {
    expect(subscriptionAllowsWrites('past_due')).toBe(true);
    expect(subscriptionAllowsWrites('canceled')).toBe(false);
    expect(subscriptionAllowsOutbound('paused')).toBe(false);
    expect(subscriptionAllowsOutbound('active')).toBe(true);
  });
});
