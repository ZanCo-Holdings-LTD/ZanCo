/**
 * Fixture builders.
 *
 * Exported from the package rather than kept in a test folder because the
 * parsers, the worker and the web app all need to construct canonical data in
 * tests, and three divergent copies of "what a valid order looks like" is how
 * the sign convention quietly drifts.
 *
 * These are synthetic. Real statements are a restaurant's commercial records
 * and are gitignored — see `docs/parsers.md` for how the M0 corpus is handled.
 */
import type { Currency, OrderStatus, PayoutLineType, PlainDate } from '@aggregatoriq/core';
import { period } from '@aggregatoriq/core';
import type {
  AggregatorAccountConfig,
  CanonicalOrder,
  CanonicalPayout,
  CanonicalPayoutLine,
  FeeBearer,
  PromoFundingEntry,
} from '../domain.js';

export const ORG_ID = '11111111-1111-4111-8111-111111111111';
export const BRANCH_ID = '22222222-2222-4222-8222-222222222222';
export const AGGREGATOR_ID = '33333333-3333-4333-8333-333333333333';
export const CURRENCY: Currency = 'AED';

let sequence = 0;

/** Deterministic ids: fixtures must not make a run's output depend on ordering. */
export function resetFixtureIds(): void {
  sequence = 0;
}

function nextId(prefix: string): string {
  sequence += 1;
  return `${prefix}-${String(sequence).padStart(4, '0')}`;
}

export function anAccountConfig(
  overrides: Partial<AggregatorAccountConfig> = {},
): AggregatorAccountConfig {
  return {
    id: 'cfg-0001',
    orgId: ORG_ID,
    branchId: BRANCH_ID,
    aggregatorId: AGGREGATOR_ID,
    aggregatorCode: 'talabat',
    externalStoreId: 'STORE-1',
    contractedCommissionRate: 0.25,
    promoShareTerms: {
      terms: [{ promoType: 'platform_funded_15', aggregatorSharePct: 1 }],
      defaultAggregatorSharePct: 0,
    },
    vatTreatment: 'commission_on_net',
    vatRate: 0.05,
    payoutCycleDays: 14,
    deliveryFeeBearer: 'customer',
    currency: CURRENCY,
    effectiveFrom: '2025-01-01',
    effectiveTo: null,
    ...overrides,
  };
}

export interface OrderOptions {
  readonly id?: string;
  readonly externalOrderId?: string;
  readonly localDate?: PlainDate;
  readonly orderedAt?: Date;
  /** Net value of the goods, excluding VAT and delivery. */
  readonly itemTotalMinor?: number;
  readonly vatAmountMinor?: number;
  readonly deliveryFeeMinor?: number;
  readonly discountTotalMinor?: number;
  readonly promoFunding?: readonly PromoFundingEntry[];
  readonly status?: OrderStatus;
  readonly currency?: Currency;
  readonly sourceRowId?: string;
}

export function anOrder(options: OrderOptions = {}): CanonicalOrder {
  const itemTotal = options.itemTotalMinor ?? 10_000;
  const vat = options.vatAmountMinor ?? Math.round(itemTotal * 0.05);
  const delivery = options.deliveryFeeMinor ?? 0;
  const id = options.id ?? nextId('ord');

  return {
    id,
    orgId: ORG_ID,
    branchId: BRANCH_ID,
    aggregatorId: AGGREGATOR_ID,
    externalOrderId: options.externalOrderId ?? id.replace('ord-', 'TLB'),
    orderedAt: options.orderedAt ?? new Date('2025-03-05T14:00:00Z'),
    localDate: options.localDate ?? '2025-03-05',
    grossAmountMinor: itemTotal + vat + delivery,
    itemTotalMinor: itemTotal,
    deliveryFeeMinor: delivery,
    vatAmountMinor: vat,
    discountTotalMinor: options.discountTotalMinor ?? 0,
    promoFunding: options.promoFunding ?? [],
    status: options.status ?? 'delivered',
    currency: options.currency ?? CURRENCY,
    sourceRowId: options.sourceRowId ?? `${id}-row`,
  };
}

export interface LineOptions {
  readonly id?: string;
  readonly externalOrderId?: string | null;
  readonly lineType: PayoutLineType;
  readonly amountMinor: number;
  readonly description?: string | null;
  readonly reference?: string | null;
  readonly currency?: Currency;
  readonly sourceRowId?: string;
}

export function aLine(payoutId: string, options: LineOptions): CanonicalPayoutLine {
  const id = options.id ?? nextId('line');
  return {
    id,
    payoutId,
    externalOrderId: options.externalOrderId ?? null,
    lineType: options.lineType,
    amountMinor: options.amountMinor,
    currency: options.currency ?? CURRENCY,
    description: options.description ?? null,
    reference: options.reference ?? null,
    sourceRowId: options.sourceRowId ?? `${id}-row`,
  };
}

export interface PayoutOptions {
  readonly id?: string;
  readonly externalPayoutId?: string;
  readonly periodStart?: PlainDate;
  readonly periodEnd?: PlainDate;
  readonly paidOn?: PlainDate | null;
  readonly lines?: readonly LineOptions[];
  readonly currency?: Currency;
}

export function aPayout(options: PayoutOptions = {}): CanonicalPayout {
  const id = options.id ?? nextId('pay');
  const lines = (options.lines ?? []).map((line) => aLine(id, line));

  const gross = lines
    .filter((line) => line.lineType === 'gross_sale')
    .reduce((total, line) => total + line.amountMinor, 0);
  const deductions = lines
    .filter((line) => line.amountMinor < 0)
    .reduce((total, line) => total + line.amountMinor, 0);

  return {
    id,
    orgId: ORG_ID,
    branchId: BRANCH_ID,
    aggregatorId: AGGREGATOR_ID,
    externalPayoutId: options.externalPayoutId ?? id.toUpperCase(),
    period: period(options.periodStart ?? '2025-03-01', options.periodEnd ?? '2025-03-15'),
    grossMinor: gross,
    deductionsMinor: deductions,
    netMinor: gross + deductions,
    paidOn: options.paidOn === undefined ? '2025-03-20' : options.paidOn,
    currency: options.currency ?? CURRENCY,
    sourceDocumentId: `${id}-doc`,
    sourceRowId: `${id}-header-row`,
    lines,
  };
}

/**
 * A clean order and the payout lines that correctly settle it: 25% commission on
 * the net goods value, delivery borne by the customer. A reconciliation of this
 * should find nothing, and a test that it finds nothing is the most important
 * test in the suite — an engine that invents variances on correct data is
 * useless.
 */
export function aCleanSettlement(options: OrderOptions = {}): {
  order: CanonicalOrder;
  payout: CanonicalPayout;
  config: AggregatorAccountConfig;
} {
  const order = anOrder(options);
  const config = anAccountConfig();
  const commission = -Math.round(order.itemTotalMinor * config.contractedCommissionRate);

  const payout = aPayout({
    lines: [
      {
        lineType: 'gross_sale',
        amountMinor: order.grossAmountMinor,
        externalOrderId: order.externalOrderId,
      },
      { lineType: 'commission', amountMinor: commission, externalOrderId: order.externalOrderId },
    ],
  });

  return { order, payout, config };
}

export function withDeliveryBearer(bearer: FeeBearer): AggregatorAccountConfig {
  return anAccountConfig({ deliveryFeeBearer: bearer });
}
