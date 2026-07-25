import { beforeEach, describe, expect, it } from 'vitest';
import { period, requireCauseCode } from '@aggregatoriq/core';
import { CanonicalDataError } from './domain.js';
import { effectiveMargin, reconcile } from './run.js';
import { MissingLineageError, createVariance } from './variance.js';
import { ENGINE_VERSION } from './version.js';
import {
  AGGREGATOR_ID,
  BRANCH_ID,
  CURRENCY,
  ORG_ID,
  aCleanSettlement,
  aPayout,
  anAccountConfig,
  anOrder,
  resetFixtureIds,
} from './testing/fixtures.js';

const PERIOD = period('2025-03-01', '2025-03-15');

/** A period containing every kind of finding, used by the whole-run tests. */
function messyPeriod() {
  resetFixtureIds();

  const clean = anOrder({ id: 'ord-clean', itemTotalMinor: 10_000 });
  const overcharged = anOrder({ id: 'ord-over', itemTotalMinor: 10_000 });
  const cancelled = anOrder({ id: 'ord-cancelled', itemTotalMinor: 8_000, status: 'cancelled' });
  const unpaid = anOrder({ id: 'ord-unpaid', itemTotalMinor: 5_000, localDate: '2025-03-09' });

  const payout = aPayout({
    id: 'pay-1',
    periodStart: '2025-03-01',
    periodEnd: '2025-03-15',
    paidOn: '2025-04-15',
    lines: [
      { lineType: 'gross_sale', amountMinor: clean.grossAmountMinor, externalOrderId: clean.externalOrderId },
      { lineType: 'commission', amountMinor: -2_500, externalOrderId: clean.externalOrderId },
      { lineType: 'gross_sale', amountMinor: overcharged.grossAmountMinor, externalOrderId: overcharged.externalOrderId },
      { lineType: 'commission', amountMinor: -3_200, externalOrderId: overcharged.externalOrderId },
      { lineType: 'commission', amountMinor: -2_000, externalOrderId: cancelled.externalOrderId },
      { lineType: 'chargeback', amountMinor: -4_000 },
      { lineType: 'adjustment', amountMinor: -1_500 },
    ],
  });

  return {
    orders: [clean, overcharged, cancelled, unpaid],
    payouts: [payout],
    configs: [anAccountConfig()],
  };
}

function runMessy() {
  const input = messyPeriod();
  return reconcile({
    orgId: ORG_ID,
    branchId: BRANCH_ID,
    aggregatorId: AGGREGATOR_ID,
    period: PERIOD,
    currency: CURRENCY,
    asOf: '2025-04-20',
    ...input,
  });
}

beforeEach(() => {
  resetFixtureIds();
});

describe('idempotency', () => {
  it('produces byte-identical results on a re-run of unchanged inputs', () => {
    // The guarantee the whole product rests on: a number an operator took to
    // their aggregator last week must still be the same number today.
    const first = runMessy();
    const second = runMessy();

    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('gives the same variance the same id across runs', () => {
    const first = runMessy();
    const second = runMessy();
    expect(second.variances.map((v) => v.id)).toEqual(first.variances.map((v) => v.id));
  });

  it('does not depend on the order the inputs arrive in', () => {
    const input = messyPeriod();
    const forward = reconcile({
      orgId: ORG_ID, branchId: BRANCH_ID, aggregatorId: AGGREGATOR_ID,
      period: PERIOD, currency: CURRENCY, asOf: '2025-04-20', ...input,
    });

    const reversedInput = messyPeriod();
    const reversed = reconcile({
      orgId: ORG_ID, branchId: BRANCH_ID, aggregatorId: AGGREGATOR_ID,
      period: PERIOD, currency: CURRENCY, asOf: '2025-04-20',
      orders: [...reversedInput.orders].reverse(),
      payouts: reversedInput.payouts,
      configs: reversedInput.configs,
    });

    expect(reversed.variances.map((v) => v.id)).toEqual(forward.variances.map((v) => v.id));
  });

  it('is unaffected by the day the run happens', () => {
    const input = messyPeriod();
    const base = {
      orgId: ORG_ID, branchId: BRANCH_ID, aggregatorId: AGGREGATOR_ID,
      period: PERIOD, currency: CURRENCY, ...input,
    };
    const march = reconcile({ ...base, asOf: '2025-03-20' });
    const june = reconcile({ ...base, asOf: '2025-06-20' });

    expect(june.variances.map((v) => v.id)).toEqual(march.variances.map((v) => v.id));
  });

  it('records the engine version so historical results stay explainable', () => {
    const result = runMessy();
    expect(result.engineVersion).toBe(ENGINE_VERSION);
    expect(result.runKey).toContain(ENGINE_VERSION);
  });
});

describe('lineage', () => {
  it('gives every variance at least one source row', () => {
    // Enforced in createVariance, asserted here, and constrained in the
    // database. Three times, because it is the invariant the product dies
    // without.
    const result = runMessy();
    expect(result.variances.length).toBeGreaterThan(3);

    for (const variance of result.variances) {
      expect(variance.evidence.sourceRowIds.length, variance.causeCode).toBeGreaterThan(0);
      expect(variance.evidence.rule, variance.causeCode).not.toBe('');
      expect(variance.evidence.computation.length, variance.causeCode).toBeGreaterThan(20);
    }
  });

  it('cites only rows that exist in the inputs', () => {
    const input = messyPeriod();
    const result = reconcile({
      orgId: ORG_ID, branchId: BRANCH_ID, aggregatorId: AGGREGATOR_ID,
      period: PERIOD, currency: CURRENCY, asOf: '2025-04-20', ...input,
    });

    const realRowIds = new Set([
      ...input.orders.map((order) => order.sourceRowId),
      ...input.payouts.flatMap((payout) => [
        payout.sourceRowId,
        ...payout.lines.map((line) => line.sourceRowId),
      ]),
    ]);

    for (const variance of result.variances) {
      for (const rowId of variance.evidence.sourceRowIds) {
        expect(realRowIds.has(rowId), `${variance.causeCode} cites unknown row ${rowId}`).toBe(true);
      }
    }
  });

  it('refuses to construct a variance with no source rows', () => {
    expect(() =>
      createVariance(
        { orgId: ORG_ID, branchId: BRANCH_ID, aggregatorId: AGGREGATOR_ID, reconRunKey: 'k' },
        {
          causeCode: 'COMMISSION_RATE_MISMATCH',
          orderId: null,
          expectedMinor: -100,
          actualMinor: -200,
          currency: CURRENCY,
          confidence: 1,
          evidence: { sourceRowIds: [], rule: 'fabricated', computation: 'trust me', inputs: {} },
        },
      ),
    ).toThrow(MissingLineageError);
  });

  it('refuses an unknown cause code', () => {
    expect(() =>
      createVariance(
        { orgId: ORG_ID, branchId: BRANCH_ID, aggregatorId: AGGREGATOR_ID, reconRunKey: 'k' },
        {
          causeCode: 'MADE_UP_CODE',
          orderId: null,
          expectedMinor: 0,
          actualMinor: -1,
          currency: CURRENCY,
          confidence: 1,
          evidence: { sourceRowIds: ['row-1'], rule: 'r', computation: 'c', inputs: {} },
        },
      ),
    ).toThrow(/Unknown cause code/);
  });
});

describe('the headline number', () => {
  it('counts only positive deltas on recoverable codes', () => {
    const result = runMessy();

    const expected = result.variances
      .filter((v) => requireCauseCode(v.causeCode).countsTowardsRecovery && v.deltaMinor > 0)
      .reduce((total, v) => total + v.deltaMinor, 0);

    expect(result.recoveryTotalMinor).toBe(expected);

    // The flags are present in the list but excluded from the total.
    const flagged = result.variances.filter(
      (v) => !requireCauseCode(v.causeCode).countsTowardsRecovery,
    );
    expect(flagged.length).toBeGreaterThan(0);
    for (const variance of flagged) {
      expect(result.recoveryTotalMinor).not.toBe(
        result.recoveryTotalMinor + variance.deltaMinor - variance.deltaMinor + 1,
      );
    }
  });

  it('summarises by cause, biggest first', () => {
    const summary = runMessy().summary;
    expect(summary.length).toBeGreaterThan(2);
    for (let i = 1; i < summary.length; i += 1) {
      expect(summary[i - 1]!.totalDeltaMinor).toBeGreaterThanOrEqual(summary[i]!.totalDeltaMinor);
    }
  });
});

describe('the canonical boundary', () => {
  it('rejects a positive commission rather than negating it', () => {
    // A parser regression that flipped a sign must fail loudly, not become a
    // plausible-looking wrong number.
    const order = anOrder();
    const payout = aPayout({
      lines: [{ lineType: 'commission', amountMinor: 2_500, externalOrderId: order.externalOrderId }],
    });

    expect(() =>
      reconcile({
        orgId: ORG_ID, branchId: BRANCH_ID, aggregatorId: AGGREGATOR_ID,
        period: PERIOD, currency: CURRENCY, asOf: '2025-03-20',
        orders: [order], payouts: [payout], configs: [anAccountConfig()],
      }),
    ).toThrow(CanonicalDataError);
  });

  it('rejects an order with no lineage', () => {
    const order = { ...anOrder(), sourceRowId: '' };
    expect(() =>
      reconcile({
        orgId: ORG_ID, branchId: BRANCH_ID, aggregatorId: AGGREGATOR_ID,
        period: PERIOD, currency: CURRENCY, asOf: '2025-03-20',
        orders: [order], payouts: [], configs: [anAccountConfig()],
      }),
    ).toThrow(CanonicalDataError);
  });

  it('excludes another currency and warns rather than converting', () => {
    const local = anOrder({ itemTotalMinor: 10_000 });
    const foreign = anOrder({ id: 'ord-sar', currency: 'SAR' });
    const payout = aPayout({
      lines: [
        { lineType: 'gross_sale', amountMinor: local.grossAmountMinor, externalOrderId: local.externalOrderId },
        { lineType: 'commission', amountMinor: -2_500, externalOrderId: local.externalOrderId },
      ],
    });

    const result = reconcile({
      orgId: ORG_ID, branchId: BRANCH_ID, aggregatorId: AGGREGATOR_ID,
      period: PERIOD, currency: CURRENCY, asOf: '2025-03-20',
      orders: [local, foreign], payouts: [payout], configs: [anAccountConfig()],
    });

    expect(result.stats.orderCount).toBe(1);
    expect(result.warnings.join(' ')).toContain('not in AED');
  });
});

describe('unmatched lines', () => {
  it('are surfaced rather than turned into variances', () => {
    const payout = aPayout({
      lines: [
        { lineType: 'commission', amountMinor: -2_500, externalOrderId: 'TLB-NOT-IN-EXPORT' },
      ],
    });

    const result = reconcile({
      orgId: ORG_ID, branchId: BRANCH_ID, aggregatorId: AGGREGATOR_ID,
      period: PERIOD, currency: CURRENCY, asOf: '2025-03-20',
      orders: [], payouts: [payout], configs: [anAccountConfig()],
    });

    expect(result.unmatched).toHaveLength(1);
    expect(result.unmatched[0]!.reason).toBe('no_candidate');
    expect(result.warnings.join(' ')).toContain('awaiting review');
  });
});

describe('effectiveMargin', () => {
  it('shows what the operator actually kept, not the contracted rate', () => {
    const { payout } = aCleanSettlement({ itemTotalMinor: 10_000 });
    const margin = effectiveMargin([payout], CURRENCY, 0.25);

    expect(margin.grossMinor).toBe(10_500);
    expect(margin.deductionsMinor).toBe(-2_500);
    expect(margin.netMinor).toBe(8_000);
    // 25.00 taken from a 105.00 gross is an effective 23.81%, not 25%.
    expect(margin.effectiveCommissionRate).toBeCloseTo(0.2381, 4);
    expect(margin.contractedCommissionRate).toBe(0.25);
  });

  it('separates the promotional cost out', () => {
    const payout = aPayout({
      lines: [
        { lineType: 'gross_sale', amountMinor: 10_000 },
        { lineType: 'commission', amountMinor: -2_500 },
        { lineType: 'promo_recharge', amountMinor: -1_500 },
      ],
    });
    const margin = effectiveMargin([payout], CURRENCY, 0.25);
    expect(margin.promoCostMinor).toBe(1_500);
    expect(margin.effectiveCommissionRate).toBeCloseTo(0.4, 4);
  });

  it('reports no rate rather than dividing by zero', () => {
    expect(effectiveMargin([], CURRENCY, 0.25).effectiveCommissionRate).toBeNull();
  });
});
