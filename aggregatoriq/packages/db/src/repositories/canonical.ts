/**
 * The canonical layer: orders, payouts and payout lines.
 *
 * Every write here carries a `sourceRowId`. That is not a convention, it is a
 * `not null` foreign key with `on delete restrict` — a canonical row cannot
 * exist without the raw row it was derived from, and the raw row cannot be
 * deleted while something derived from it survives.
 *
 * Writes are upserts keyed on the aggregator's own identifiers, so replaying a
 * document after a parser fix updates the canonical rows rather than creating a
 * second copy of every order.
 */
import { and, asc, eq, gte, lte, sql } from 'drizzle-orm';
import type {
  CanonicalOrder,
  CanonicalPayout,
  CanonicalPayoutLine,
} from '@aggregatoriq/engine';
import type { Currency, OrderStatus, Period, PayoutLineType, PlainDate } from '@aggregatoriq/core';
import type { Transaction } from '../client.js';
import { orders, payoutLines, payouts } from '../schema.js';

export interface OrderUpsert {
  orgId: string;
  branchId: string;
  aggregatorId: string;
  externalOrderId: string;
  orderedAt: Date;
  localDate: PlainDate;
  grossAmountMinor: number;
  itemTotalMinor: number;
  deliveryFeeMinor: number;
  vatAmountMinor: number;
  discountTotalMinor: number;
  promoFunding: unknown;
  status: OrderStatus;
  currency: Currency;
  sourceRowId: string;
}

export async function upsertOrders(
  tx: Transaction,
  rows: readonly OrderUpsert[],
): Promise<number> {
  if (rows.length === 0) return 0;

  const inserted = await tx
    .insert(orders)
    .values(rows.map((row) => ({ ...row })))
    .onConflictDoUpdate({
      target: [orders.orgId, orders.branchId, orders.aggregatorId, orders.externalOrderId],
      set: {
        orderedAt: sql`excluded.ordered_at`,
        localDate: sql`excluded.local_date`,
        grossAmountMinor: sql`excluded.gross_amount_minor`,
        itemTotalMinor: sql`excluded.item_total_minor`,
        deliveryFeeMinor: sql`excluded.delivery_fee_minor`,
        vatAmountMinor: sql`excluded.vat_amount_minor`,
        discountTotalMinor: sql`excluded.discount_total_minor`,
        promoFunding: sql`excluded.promo_funding`,
        status: sql`excluded.status`,
        currency: sql`excluded.currency`,
        sourceRowId: sql`excluded.source_row_id`,
      },
    })
    .returning({ id: orders.id });

  return inserted.length;
}

export interface PayoutUpsert {
  orgId: string;
  branchId: string;
  aggregatorId: string;
  externalPayoutId: string;
  periodStart: PlainDate;
  periodEnd: PlainDate;
  grossMinor: number;
  deductionsMinor: number;
  netMinor: number;
  currency: Currency;
  paidOn: PlainDate | null;
  sourceDocumentId: string;
  sourceRowId: string;
  lines: readonly {
    externalOrderId: string | null;
    lineType: PayoutLineType;
    amountMinor: number;
    currency: Currency;
    description: string | null;
    reference: string | null;
    sourceRowId: string;
  }[];
}

/**
 * Upsert a payout and replace its lines.
 *
 * The lines are deleted and rewritten rather than merged, because a re-parse
 * that reads the statement differently must not leave orphans from the previous
 * interpretation sitting alongside the new ones — two readings of one statement
 * would double every deduction.
 */
export async function upsertPayoutWithLines(
  tx: Transaction,
  payout: PayoutUpsert,
): Promise<string> {
  const [row] = await tx
    .insert(payouts)
    .values({
      orgId: payout.orgId,
      branchId: payout.branchId,
      aggregatorId: payout.aggregatorId,
      externalPayoutId: payout.externalPayoutId,
      periodStart: payout.periodStart,
      periodEnd: payout.periodEnd,
      grossMinor: payout.grossMinor,
      deductionsMinor: payout.deductionsMinor,
      netMinor: payout.netMinor,
      currency: payout.currency,
      paidOn: payout.paidOn,
      sourceDocumentId: payout.sourceDocumentId,
      sourceRowId: payout.sourceRowId,
    })
    .onConflictDoUpdate({
      target: [payouts.orgId, payouts.branchId, payouts.aggregatorId, payouts.externalPayoutId],
      set: {
        periodStart: sql`excluded.period_start`,
        periodEnd: sql`excluded.period_end`,
        grossMinor: sql`excluded.gross_minor`,
        deductionsMinor: sql`excluded.deductions_minor`,
        netMinor: sql`excluded.net_minor`,
        currency: sql`excluded.currency`,
        paidOn: sql`excluded.paid_on`,
        sourceDocumentId: sql`excluded.source_document_id`,
        sourceRowId: sql`excluded.source_row_id`,
      },
    })
    .returning({ id: payouts.id });

  if (!row) throw new Error('Payout upsert returned no row');

  await tx.delete(payoutLines).where(eq(payoutLines.payoutId, row.id));

  if (payout.lines.length > 0) {
    await tx.insert(payoutLines).values(
      payout.lines.map((line) => ({
        orgId: payout.orgId,
        payoutId: row.id,
        externalOrderId: line.externalOrderId,
        lineType: line.lineType,
        amountMinor: line.amountMinor,
        currency: line.currency,
        description: line.description,
        reference: line.reference,
        sourceRowId: line.sourceRowId,
      })),
    );
  }

  return row.id;
}

/** Load the canonical orders for a reconciliation, in engine shape. */
export async function loadOrdersForPeriod(
  tx: Transaction,
  input: { orgId: string; branchId: string; aggregatorId: string; period: Period },
): Promise<CanonicalOrder[]> {
  const rows = await tx
    .select()
    .from(orders)
    .where(
      and(
        eq(orders.orgId, input.orgId),
        eq(orders.branchId, input.branchId),
        eq(orders.aggregatorId, input.aggregatorId),
        gte(orders.localDate, input.period.start),
        lte(orders.localDate, input.period.end),
      ),
    )
    .orderBy(asc(orders.id));

  return rows.map((row) => ({
    id: row.id,
    orgId: row.orgId,
    branchId: row.branchId,
    aggregatorId: row.aggregatorId,
    externalOrderId: row.externalOrderId,
    orderedAt: row.orderedAt,
    localDate: row.localDate,
    grossAmountMinor: Number(row.grossAmountMinor),
    itemTotalMinor: Number(row.itemTotalMinor),
    deliveryFeeMinor: Number(row.deliveryFeeMinor),
    vatAmountMinor: Number(row.vatAmountMinor),
    discountTotalMinor: Number(row.discountTotalMinor),
    promoFunding: (row.promoFunding as CanonicalOrder['promoFunding']) ?? [],
    status: row.status,
    currency: row.currency as Currency,
    sourceRowId: row.sourceRowId,
  }));
}

/**
 * Load payouts overlapping the period, with their lines.
 *
 * Overlapping rather than contained: a statement running 25 March to 8 April is
 * relevant to a March reconciliation, and excluding it would make every order in
 * the last week of March look unpaid.
 */
export async function loadPayoutsForPeriod(
  tx: Transaction,
  input: { orgId: string; branchId: string; aggregatorId: string; period: Period },
): Promise<CanonicalPayout[]> {
  const payoutRows = await tx
    .select()
    .from(payouts)
    .where(
      and(
        eq(payouts.orgId, input.orgId),
        eq(payouts.branchId, input.branchId),
        eq(payouts.aggregatorId, input.aggregatorId),
        lte(payouts.periodStart, input.period.end),
        gte(payouts.periodEnd, input.period.start),
      ),
    )
    .orderBy(asc(payouts.id));

  if (payoutRows.length === 0) return [];

  const ids = payoutRows.map((row) => row.id);
  const lineRows = await tx
    .select()
    .from(payoutLines)
    .where(sql`${payoutLines.payoutId} = any(${sql.param(ids)}::uuid[])`)
    .orderBy(asc(payoutLines.id));

  const linesByPayout = new Map<string, CanonicalPayoutLine[]>();
  for (const line of lineRows) {
    const mapped: CanonicalPayoutLine = {
      id: line.id,
      payoutId: line.payoutId,
      externalOrderId: line.externalOrderId,
      lineType: line.lineType,
      amountMinor: Number(line.amountMinor),
      currency: line.currency as Currency,
      description: line.description,
      reference: line.reference,
      sourceRowId: line.sourceRowId,
    };
    const bucket = linesByPayout.get(line.payoutId);
    if (bucket) bucket.push(mapped);
    else linesByPayout.set(line.payoutId, [mapped]);
  }

  return payoutRows.map((row) => ({
    id: row.id,
    orgId: row.orgId,
    branchId: row.branchId,
    aggregatorId: row.aggregatorId,
    externalPayoutId: row.externalPayoutId,
    period: { start: row.periodStart, end: row.periodEnd },
    grossMinor: Number(row.grossMinor),
    deductionsMinor: Number(row.deductionsMinor),
    netMinor: Number(row.netMinor),
    paidOn: row.paidOn,
    currency: row.currency as Currency,
    sourceDocumentId: row.sourceDocumentId,
    sourceRowId: row.sourceRowId,
    lines: linesByPayout.get(row.id) ?? [],
  }));
}

/** Periods a branch has statements for, used to render coverage on the UI. */
export async function listCoveredPeriods(
  tx: Transaction,
  input: { orgId: string; branchId: string; aggregatorId: string },
): Promise<Period[]> {
  const rows = await tx
    .select({ start: payouts.periodStart, end: payouts.periodEnd })
    .from(payouts)
    .where(
      and(
        eq(payouts.orgId, input.orgId),
        eq(payouts.branchId, input.branchId),
        eq(payouts.aggregatorId, input.aggregatorId),
      ),
    )
    .orderBy(asc(payouts.periodStart));

  return rows.map((row) => ({ start: row.start, end: row.end }));
}
