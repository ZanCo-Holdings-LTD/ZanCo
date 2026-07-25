import { beforeEach, describe, expect, it } from 'vitest';
import { CAUSE_CODES, period, requireCauseCode } from '@aggregatoriq/core';
import { defaultMateriality, materiality } from '../materiality.js';
import { reconcile } from '../run.js';
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
} from '../testing/fixtures.js';
import { ALL_RULES, emittableCauseCodes } from './index.js';

const PERIOD = period('2025-03-01', '2025-03-15');
const ASOF = '2025-03-20';

function run(input: {
  orders?: Parameters<typeof reconcile>[0]['orders'];
  payouts?: Parameters<typeof reconcile>[0]['payouts'];
  configs?: Parameters<typeof reconcile>[0]['configs'];
  materiality?: Parameters<typeof reconcile>[0]['materiality'];
}) {
  return reconcile({
    orgId: ORG_ID,
    branchId: BRANCH_ID,
    aggregatorId: AGGREGATOR_ID,
    period: PERIOD,
    currency: CURRENCY,
    orders: input.orders ?? [],
    payouts: input.payouts ?? [],
    configs: input.configs ?? [anAccountConfig()],
    materiality: input.materiality ?? defaultMateriality(CURRENCY),
    asOf: ASOF,
  });
}

beforeEach(() => {
  resetFixtureIds();
});

describe('the registry', () => {
  it('emits every cause code in the taxonomy', () => {
    // A code with no rule behind it is a promise the product does not keep.
    const emittable = new Set(emittableCauseCodes());
    for (const cause of CAUSE_CODES) {
      expect(emittable.has(cause.code), `no rule emits ${cause.code}`).toBe(true);
    }
  });

  it('only emits codes that exist in the taxonomy', () => {
    for (const rule of ALL_RULES) {
      for (const code of rule.causeCodes) {
        expect(() => requireCauseCode(code), `${rule.name} emits ${code}`).not.toThrow();
      }
    }
  });

  it('gives every rule a unique name', () => {
    const names = ALL_RULES.map((rule) => rule.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('a correct settlement', () => {
  it('produces no variances at all', () => {
    // The most important test here. An engine that invents findings on clean
    // data is worse than no engine.
    const { order, payout, config } = aCleanSettlement();
    const result = run({ orders: [order], payouts: [payout], configs: [config] });

    expect(result.variances).toEqual([]);
    expect(result.recoveryTotalMinor).toBe(0);
    expect(result.stats.matchedOrderCount).toBe(1);
    expect(result.stats.unmatchedLineCount).toBe(0);
  });

  it('suppresses sub-materiality noise', () => {
    // One fils of rounding difference is not a claim.
    const order = anOrder({ itemTotalMinor: 10_000 });
    const payout = aPayout({
      lines: [
        { lineType: 'gross_sale', amountMinor: order.grossAmountMinor, externalOrderId: order.externalOrderId },
        { lineType: 'commission', amountMinor: -2_501, externalOrderId: order.externalOrderId },
      ],
    });
    expect(run({ orders: [order], payouts: [payout] }).variances).toEqual([]);
  });

  it('raises the same difference once the threshold is lowered', () => {
    const order = anOrder({ itemTotalMinor: 10_000 });
    const payout = aPayout({
      lines: [
        { lineType: 'gross_sale', amountMinor: order.grossAmountMinor, externalOrderId: order.externalOrderId },
        { lineType: 'commission', amountMinor: -2_501, externalOrderId: order.externalOrderId },
      ],
    });
    const result = run({
      orders: [order],
      payouts: [payout],
      materiality: materiality(1, CURRENCY),
    });
    expect(result.variances).toHaveLength(1);
    expect(result.variances[0]!.deltaMinor).toBe(1);
  });
});

describe('COMMISSION_RATE_MISMATCH', () => {
  it('claims the difference between the charged and contracted rate', () => {
    // Contracted 25% of 100.00 net = 25.00. Charged 30% = 30.00.
    const order = anOrder({ itemTotalMinor: 10_000 });
    const payout = aPayout({
      lines: [
        { lineType: 'gross_sale', amountMinor: order.grossAmountMinor, externalOrderId: order.externalOrderId },
        { lineType: 'commission', amountMinor: -3_000, externalOrderId: order.externalOrderId },
      ],
    });

    const result = run({ orders: [order], payouts: [payout] });
    const variance = result.variances.find((v) => v.causeCode === 'COMMISSION_RATE_MISMATCH');

    expect(variance).toBeDefined();
    expect(variance!.expectedMinor).toBe(-2_500);
    expect(variance!.actualMinor).toBe(-3_000);
    expect(variance!.deltaMinor).toBe(500);
    expect(variance!.evidence.computation).toContain('30.00%');
    expect(result.recoveryTotalMinor).toBe(500);
  });

  it('does not claim when the aggregator undercharged', () => {
    // Real discrepancy, but not a claim — and handing them a list of ways they
    // underbilled you is not what the customer is paying for.
    const order = anOrder({ itemTotalMinor: 10_000 });
    const payout = aPayout({
      lines: [
        { lineType: 'gross_sale', amountMinor: order.grossAmountMinor, externalOrderId: order.externalOrderId },
        { lineType: 'commission', amountMinor: -2_000, externalOrderId: order.externalOrderId },
      ],
    });
    const result = run({ orders: [order], payouts: [payout] });
    const variance = result.variances.find((v) => v.causeCode === 'COMMISSION_RATE_MISMATCH');
    expect(variance!.deltaMinor).toBe(-500);
    expect(result.recoveryTotalMinor).toBe(0);
  });

  it('judges an order against the rate in force on its own date', () => {
    const configs = [
      anAccountConfig({
        id: 'cfg-old',
        contractedCommissionRate: 0.2,
        effectiveFrom: '2025-01-01',
        effectiveTo: '2025-03-10',
      }),
      anAccountConfig({
        id: 'cfg-new',
        contractedCommissionRate: 0.3,
        effectiveFrom: '2025-03-10',
        effectiveTo: null,
      }),
    ];

    // 5 March falls under the 20% rate, so a 20% charge is correct.
    const early = anOrder({ localDate: '2025-03-05', itemTotalMinor: 10_000 });
    const earlyPayout = aPayout({
      lines: [
        { lineType: 'gross_sale', amountMinor: early.grossAmountMinor, externalOrderId: early.externalOrderId },
        { lineType: 'commission', amountMinor: -2_000, externalOrderId: early.externalOrderId },
      ],
    });
    expect(run({ orders: [early], payouts: [earlyPayout], configs }).variances).toEqual([]);

    // 12 March falls under 30%, so the same 20% charge is now an undercharge and
    // a 30% charge is correct.
    const late = anOrder({ localDate: '2025-03-12', itemTotalMinor: 10_000 });
    const latePayout = aPayout({
      lines: [
        { lineType: 'gross_sale', amountMinor: late.grossAmountMinor, externalOrderId: late.externalOrderId },
        { lineType: 'commission', amountMinor: -3_000, externalOrderId: late.externalOrderId },
      ],
    });
    expect(run({ orders: [late], payouts: [latePayout], configs }).variances).toEqual([]);
  });

  it('judges nothing, and says so, when no configuration covers the date', () => {
    const order = anOrder({ localDate: '2024-06-01' });
    const payout = aPayout({
      periodStart: '2024-06-01',
      periodEnd: '2024-06-15',
      lines: [{ lineType: 'commission', amountMinor: -9_000, externalOrderId: order.externalOrderId }],
    });
    const result = run({ orders: [order], payouts: [payout] });

    expect(result.variances.filter((v) => v.causeCode === 'COMMISSION_RATE_MISMATCH')).toEqual([]);
    expect(result.stats.ordersWithoutConfig).toBe(1);
    expect(result.warnings.join(' ')).toContain('outside every configured account period');
  });
});

describe('VAT_TREATMENT_ERROR', () => {
  it('separates a wrong-base charge from a wrong-rate charge', () => {
    // 25% of the gross 110.00 (net 100.00 + VAT 5.00 + delivery 5.00) = 27.50,
    // against a contract that says 25% of the net 100.00 = 25.00.
    const order = anOrder({ itemTotalMinor: 10_000, vatAmountMinor: 500, deliveryFeeMinor: 500 });
    const payout = aPayout({
      lines: [
        { lineType: 'gross_sale', amountMinor: order.grossAmountMinor, externalOrderId: order.externalOrderId },
        { lineType: 'commission', amountMinor: -2_750, externalOrderId: order.externalOrderId },
      ],
    });

    const result = run({ orders: [order], payouts: [payout] });
    const codes = result.variances.map((v) => v.causeCode);

    expect(codes).toContain('VAT_TREATMENT_ERROR');
    // Crucially, not also reported as a rate dispute — that would send the
    // operator into an argument about the wrong thing.
    expect(codes).not.toContain('COMMISSION_RATE_MISMATCH');

    const variance = result.variances.find((v) => v.causeCode === 'VAT_TREATMENT_ERROR')!;
    expect(variance.deltaMinor).toBe(250);
    expect(variance.evidence.computation).toContain('commission on net of VAT');
  });

  it('does not fire when the contract says commission on gross', () => {
    const config = anAccountConfig({ vatTreatment: 'commission_on_gross' });
    const order = anOrder({ itemTotalMinor: 10_000, vatAmountMinor: 500, deliveryFeeMinor: 500 });
    const payout = aPayout({
      lines: [
        { lineType: 'gross_sale', amountMinor: order.grossAmountMinor, externalOrderId: order.externalOrderId },
        { lineType: 'commission', amountMinor: -2_750, externalOrderId: order.externalOrderId },
      ],
    });
    expect(run({ orders: [order], payouts: [payout], configs: [config] }).variances).toEqual([]);
  });
});

describe('CANCELLED_ORDER_CHARGED', () => {
  it('claims the whole deduction, not a rate difference', () => {
    const order = anOrder({ status: 'cancelled', itemTotalMinor: 10_000 });
    const payout = aPayout({
      lines: [
        { lineType: 'commission', amountMinor: -2_500, externalOrderId: order.externalOrderId },
        { lineType: 'penalty', amountMinor: -1_000, externalOrderId: order.externalOrderId },
      ],
    });

    const result = run({ orders: [order], payouts: [payout] });
    const variance = result.variances.find((v) => v.causeCode === 'CANCELLED_ORDER_CHARGED')!;

    expect(variance.expectedMinor).toBe(0);
    expect(variance.actualMinor).toBe(-3_500);
    expect(variance.deltaMinor).toBe(3_500);
    // And not double-counted as a rate mismatch.
    expect(result.variances.map((v) => v.causeCode)).not.toContain('COMMISSION_RATE_MISMATCH');
  });

  it('accepts a refund on a cancelled order as correct behaviour', () => {
    const order = anOrder({ status: 'cancelled', itemTotalMinor: 10_000 });
    const payout = aPayout({
      lines: [
        { lineType: 'refund', amountMinor: -order.grossAmountMinor, externalOrderId: order.externalOrderId },
      ],
    });
    expect(run({ orders: [order], payouts: [payout] }).variances).toEqual([]);
  });
});

describe('REFUND_OVERCHARGED', () => {
  it('claims only the excess over the order value', () => {
    const order = anOrder({ itemTotalMinor: 10_000, status: 'refunded' });
    const payout = aPayout({
      lines: [
        { lineType: 'refund', amountMinor: -15_000, externalOrderId: order.externalOrderId },
      ],
    });

    const variance = run({ orders: [order], payouts: [payout] }).variances.find(
      (v) => v.causeCode === 'REFUND_OVERCHARGED',
    )!;

    expect(variance.expectedMinor).toBe(-10_500);
    expect(variance.actualMinor).toBe(-15_000);
    expect(variance.deltaMinor).toBe(4_500);
  });

  it('allows a refund of exactly the order value', () => {
    const order = anOrder({ itemTotalMinor: 10_000, status: 'refunded' });
    const payout = aPayout({
      lines: [
        { lineType: 'refund', amountMinor: -order.grossAmountMinor, externalOrderId: order.externalOrderId },
      ],
    });
    expect(
      run({ orders: [order], payouts: [payout] }).variances.filter(
        (v) => v.causeCode === 'REFUND_OVERCHARGED',
      ),
    ).toEqual([]);
  });
});

describe('PROMO_COST_MISALLOCATED', () => {
  it('claims a fully-funded promotion charged to the operator', () => {
    const order = anOrder({
      itemTotalMinor: 10_000,
      discountTotalMinor: 2_000,
      promoFunding: [
        {
          promoType: 'platform_funded_15',
          amountMinor: 2_000,
          fundedBy: 'operator',
          aggregatorSharePct: null,
        },
      ],
    });
    const payout = aPayout({
      lines: [
        { lineType: 'gross_sale', amountMinor: order.grossAmountMinor, externalOrderId: order.externalOrderId },
        { lineType: 'commission', amountMinor: -2_500, externalOrderId: order.externalOrderId },
        { lineType: 'promo_recharge', amountMinor: -2_000, externalOrderId: order.externalOrderId },
      ],
    });

    const variance = run({ orders: [order], payouts: [payout] }).variances.find(
      (v) => v.causeCode === 'PROMO_COST_MISALLOCATED',
    )!;

    expect(variance.expectedMinor).toBe(0);
    expect(variance.actualMinor).toBe(-2_000);
    expect(variance.deltaMinor).toBe(2_000);
    expect(variance.evidence.computation).toContain('aggregator funds 100.00%');
  });

  it('claims only the operator’s excess share on a shared promotion', () => {
    const config = anAccountConfig({
      promoShareTerms: {
        terms: [{ promoType: 'bogof', aggregatorSharePct: 0.5 }],
        defaultAggregatorSharePct: 0,
      },
    });
    const order = anOrder({
      itemTotalMinor: 10_000,
      promoFunding: [
        { promoType: 'bogof', amountMinor: 2_000, fundedBy: 'operator', aggregatorSharePct: null },
      ],
    });
    const payout = aPayout({
      lines: [
        { lineType: 'promo_recharge', amountMinor: -2_000, externalOrderId: order.externalOrderId },
      ],
    });

    const variance = run({ orders: [order], payouts: [payout], configs: [config] }).variances.find(
      (v) => v.causeCode === 'PROMO_COST_MISALLOCATED',
    )!;
    expect(variance.expectedMinor).toBe(-1_000);
    expect(variance.deltaMinor).toBe(1_000);
  });

  it('says when the claim rests on the account default rather than a named term', () => {
    const config = anAccountConfig({
      promoShareTerms: { terms: [], defaultAggregatorSharePct: 1 },
    });
    const order = anOrder({
      promoFunding: [
        { promoType: 'mystery_campaign', amountMinor: 1_000, fundedBy: 'operator', aggregatorSharePct: null },
      ],
    });
    const payout = aPayout({
      lines: [{ lineType: 'promo_recharge', amountMinor: -1_000, externalOrderId: order.externalOrderId }],
    });

    const variance = run({ orders: [order], payouts: [payout], configs: [config] }).variances.find(
      (v) => v.causeCode === 'PROMO_COST_MISALLOCATED',
    )!;
    expect(variance.evidence.computation).toContain('account default, not a named term');
    expect(variance.evidence.inputs.usedDefaultShare).toBe('yes');
  });

  it('finds nothing when the recharge matches the agreed share', () => {
    const config = anAccountConfig({
      promoShareTerms: {
        terms: [{ promoType: 'bogof', aggregatorSharePct: 0.5 }],
        defaultAggregatorSharePct: 0,
      },
    });
    const order = anOrder({
      promoFunding: [
        { promoType: 'bogof', amountMinor: 2_000, fundedBy: 'shared', aggregatorSharePct: 0.5 },
      ],
    });
    const payout = aPayout({
      lines: [{ lineType: 'promo_recharge', amountMinor: -1_000, externalOrderId: order.externalOrderId }],
    });
    expect(
      run({ orders: [order], payouts: [payout], configs: [config] }).variances.filter(
        (v) => v.causeCode === 'PROMO_COST_MISALLOCATED',
      ),
    ).toEqual([]);
  });
});

describe('DELIVERY_FEE_MISATTRIBUTED', () => {
  it('claims a delivery fee the operator does not bear', () => {
    const order = anOrder({ deliveryFeeMinor: 1_000 });
    const payout = aPayout({
      lines: [
        { lineType: 'delivery_fee', amountMinor: -1_000, externalOrderId: order.externalOrderId },
      ],
    });
    const variance = run({ orders: [order], payouts: [payout] }).variances.find(
      (v) => v.causeCode === 'DELIVERY_FEE_MISATTRIBUTED',
    )!;
    expect(variance.deltaMinor).toBe(1_000);
  });

  it('finds nothing when the operator is contracted to bear delivery', () => {
    const config = anAccountConfig({ deliveryFeeBearer: 'operator' });
    const order = anOrder({ deliveryFeeMinor: 1_000 });
    const payout = aPayout({
      lines: [
        { lineType: 'delivery_fee', amountMinor: -1_000, externalOrderId: order.externalOrderId },
      ],
    });
    expect(
      run({ orders: [order], payouts: [payout], configs: [config] }).variances.filter(
        (v) => v.causeCode === 'DELIVERY_FEE_MISATTRIBUTED',
      ),
    ).toEqual([]);
  });
});

describe('DUPLICATE_DEDUCTION', () => {
  it('finds the same deduction across two statements', () => {
    // Invisible to anyone reviewing either statement on its own.
    const order = anOrder({ itemTotalMinor: 10_000 });
    const first = aPayout({
      periodStart: '2025-03-01',
      periodEnd: '2025-03-07',
      lines: [{ lineType: 'commission', amountMinor: -2_500, externalOrderId: order.externalOrderId }],
    });
    const second = aPayout({
      periodStart: '2025-03-08',
      periodEnd: '2025-03-15',
      lines: [{ lineType: 'commission', amountMinor: -2_500, externalOrderId: order.externalOrderId }],
    });

    const result = run({ orders: [order], payouts: [first, second] });
    const variance = result.variances.find((v) => v.causeCode === 'DUPLICATE_DEDUCTION')!;

    expect(variance.expectedMinor).toBe(-2_500);
    expect(variance.actualMinor).toBe(-5_000);
    expect(variance.deltaMinor).toBe(2_500);
    expect(variance.evidence.sourceRowIds).toHaveLength(2);
  });

  it('does not treat two unreferenced identical charges as duplicates', () => {
    // A restaurant can legitimately incur the same fee twice, and a false
    // duplicate claim can get a whole dispute pack dismissed.
    const payout = aPayout({
      lines: [
        { lineType: 'penalty', amountMinor: -5_000, description: 'Late handover' },
        { lineType: 'penalty', amountMinor: -5_000, description: 'Late handover' },
      ],
    });
    expect(
      run({ payouts: [payout] }).variances.filter((v) => v.causeCode === 'DUPLICATE_DEDUCTION'),
    ).toEqual([]);
  });

  it('counts three copies as two duplicates', () => {
    const order = anOrder();
    const payout = aPayout({
      lines: [
        { lineType: 'commission', amountMinor: -1_000, externalOrderId: order.externalOrderId },
        { lineType: 'commission', amountMinor: -1_000, externalOrderId: order.externalOrderId },
        { lineType: 'commission', amountMinor: -1_000, externalOrderId: order.externalOrderId },
      ],
    });
    const variance = run({ orders: [order], payouts: [payout] }).variances.find(
      (v) => v.causeCode === 'DUPLICATE_DEDUCTION',
    )!;
    expect(variance.deltaMinor).toBe(2_000);
  });
});

describe('MISSING_PAYOUT', () => {
  it('claims the net value of a delivered order that was never paid', () => {
    const paid = anOrder({ id: 'ord-paid', itemTotalMinor: 10_000 });
    const unpaid = anOrder({ id: 'ord-unpaid', itemTotalMinor: 20_000, localDate: '2025-03-06' });

    const payout = aPayout({
      lines: [
        { lineType: 'gross_sale', amountMinor: paid.grossAmountMinor, externalOrderId: paid.externalOrderId },
        { lineType: 'commission', amountMinor: -2_500, externalOrderId: paid.externalOrderId },
      ],
    });

    const variance = run({ orders: [paid, unpaid], payouts: [payout] }).variances.find(
      (v) => v.causeCode === 'MISSING_PAYOUT',
    )!;

    // Gross 210.00, less contracted 25% of the net 200.00 = 50.00, so 160.00.
    expect(variance.expectedMinor).toBe(16_000);
    expect(variance.actualMinor).toBe(0);
    expect(variance.orderId).toBe('ord-unpaid');
  });

  it('is not suppressed by the materiality threshold', () => {
    // Fifty unpaid 1.50 orders is a pattern, not noise.
    const unpaid = anOrder({ itemTotalMinor: 100, vatAmountMinor: 5 });
    const payout = aPayout({ lines: [{ lineType: 'gross_sale', amountMinor: 1 }] });
    const result = run({
      orders: [unpaid],
      payouts: [payout],
      materiality: materiality(100_000, CURRENCY),
    });
    expect(result.variances.some((v) => v.causeCode === 'MISSING_PAYOUT')).toBe(true);
  });

  it('does not claim non-payment for a date no statement covers', () => {
    // That is a coverage gap. Claiming non-payment from a statement you never
    // received is how you lose credibility.
    const order = anOrder({ localDate: '2025-03-20' });
    const payout = aPayout({ periodStart: '2025-03-01', periodEnd: '2025-03-15' });
    const result = reconcile({
      orgId: ORG_ID,
      branchId: BRANCH_ID,
      aggregatorId: AGGREGATOR_ID,
      period: period('2025-03-01', '2025-03-31'),
      currency: CURRENCY,
      orders: [order],
      payouts: [payout],
      configs: [anAccountConfig()],
      asOf: ASOF,
    });

    expect(result.variances.map((v) => v.causeCode)).not.toContain('MISSING_PAYOUT');
    expect(result.variances.map((v) => v.causeCode)).toContain('COVERAGE_GAP');
  });

  it('ignores cancelled and unknown-status orders', () => {
    const cancelled = anOrder({ status: 'cancelled' });
    const unknown = anOrder({ status: 'unknown' });
    const payout = aPayout({ lines: [{ lineType: 'gross_sale', amountMinor: 1 }] });
    expect(
      run({ orders: [cancelled, unknown], payouts: [payout] }).variances.filter(
        (v) => v.causeCode === 'MISSING_PAYOUT',
      ),
    ).toEqual([]);
  });
});

describe('CHARGEBACK_UNSUBSTANTIATED', () => {
  it('claims a chargeback with no reference and no description', () => {
    const payout = aPayout({ lines: [{ lineType: 'chargeback', amountMinor: -7_500 }] });
    const variance = run({ payouts: [payout] }).variances.find(
      (v) => v.causeCode === 'CHARGEBACK_UNSUBSTANTIATED',
    )!;
    expect(variance.deltaMinor).toBe(7_500);
  });

  it('leaves a substantiated chargeback alone', () => {
    const payout = aPayout({
      lines: [
        { lineType: 'chargeback', amountMinor: -7_500, externalOrderId: 'TLB9999' },
        { lineType: 'chargeback', amountMinor: -5_000, description: 'Customer dispute ref 44821' },
      ],
    });
    expect(
      run({ payouts: [payout] }).variances.filter(
        (v) => v.causeCode === 'CHARGEBACK_UNSUBSTANTIATED',
      ),
    ).toEqual([]);
  });
});

describe('ADJUSTMENT_UNEXPLAINED', () => {
  it('raises it for investigation but keeps it out of the recovery total', () => {
    const payout = aPayout({ lines: [{ lineType: 'adjustment', amountMinor: -12_000 }] });
    const result = run({ payouts: [payout] });
    const variance = result.variances.find((v) => v.causeCode === 'ADJUSTMENT_UNEXPLAINED')!;

    expect(variance.deltaMinor).toBe(12_000);
    // Not recoverable: it is often the fridge.
    expect(result.recoveryTotalMinor).toBe(0);
    expect(requireCauseCode('ADJUSTMENT_UNEXPLAINED').countsTowardsRecovery).toBe(false);
  });

  it('leaves a described adjustment alone', () => {
    const payout = aPayout({
      lines: [{ lineType: 'adjustment', amountMinor: -12_000, description: 'Agreed marketing contribution Q1' }],
    });
    expect(
      run({ payouts: [payout] }).variances.filter((v) => v.causeCode === 'ADJUSTMENT_UNEXPLAINED'),
    ).toEqual([]);
  });
});

describe('LATE_PAYOUT', () => {
  it('flags a payout outside the contracted cycle without claiming money', () => {
    const payout = aPayout({ periodEnd: '2025-03-15', paidOn: '2025-04-10' });
    const result = run({ payouts: [payout] });
    const variance = result.variances.find((v) => v.causeCode === 'LATE_PAYOUT')!;

    expect(variance.evidence.inputs.daysLate).toBe(12);
    expect(variance.deltaMinor).toBe(0);
    expect(result.recoveryTotalMinor).toBe(0);
  });

  it('says nothing about a payout inside the cycle', () => {
    const payout = aPayout({ periodEnd: '2025-03-15', paidOn: '2025-03-28' });
    expect(run({ payouts: [payout] }).variances.filter((v) => v.causeCode === 'LATE_PAYOUT')).toEqual([]);
  });
});

describe('COVERAGE_GAP', () => {
  it('reports a gap that contains orders', () => {
    const order = anOrder({ localDate: '2025-03-20', itemTotalMinor: 10_000 });
    const payout = aPayout({ periodStart: '2025-03-01', periodEnd: '2025-03-15' });

    const result = reconcile({
      orgId: ORG_ID,
      branchId: BRANCH_ID,
      aggregatorId: AGGREGATOR_ID,
      period: period('2025-03-01', '2025-03-31'),
      currency: CURRENCY,
      orders: [order],
      payouts: [payout],
      configs: [anAccountConfig()],
      asOf: ASOF,
    });

    const variance = result.variances.find((v) => v.causeCode === 'COVERAGE_GAP')!;
    expect(variance.evidence.inputs.gapStart).toBe('2025-03-16');
    expect(variance.evidence.inputs.gapEnd).toBe('2025-03-31');
    expect(variance.evidence.computation).toContain('not an amount owed');
    expect(result.recoveryTotalMinor).toBe(0);
  });

  it('says nothing about a gap with no orders in it', () => {
    // A restaurant closed for refurbishment has no statement and no problem.
    const payout = aPayout({ periodStart: '2025-03-01', periodEnd: '2025-03-15' });
    const result = reconcile({
      orgId: ORG_ID,
      branchId: BRANCH_ID,
      aggregatorId: AGGREGATOR_ID,
      period: period('2025-03-01', '2025-03-31'),
      currency: CURRENCY,
      orders: [],
      payouts: [payout],
      configs: [anAccountConfig()],
      asOf: ASOF,
    });
    expect(result.variances.filter((v) => v.causeCode === 'COVERAGE_GAP')).toEqual([]);
  });
});
