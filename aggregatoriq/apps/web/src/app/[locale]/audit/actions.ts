'use server';

import { randomUUID } from 'node:crypto';
import type { AggregatorCode, Currency } from '@aggregatoriq/core';
import { period, requireCauseCode, today } from '@aggregatoriq/core';
import {
  reconcile,
  type AggregatorAccountConfig,
  type CanonicalOrder,
  type CanonicalPayout,
} from '@aggregatoriq/engine';
import { parseDocument, type ParserContext } from '@aggregatoriq/parsers';

/**
 * The free audit.
 *
 * A stranger drops in one statement and gets a number, without an account and
 * without talking to anyone. It is the funnel, not a marketing page.
 *
 * Nothing here is persisted. The file is parsed in memory, reconciled, and
 * discarded when the request ends — an anonymous visitor has not agreed to
 * anything, and holding a restaurant's settlement data on that basis would be
 * both wrong and a needless liability. The trade-off is that the result cannot
 * be revisited, which the copy says plainly.
 *
 * The honest limitation, stated on screen rather than buried: with no contract
 * on file this uses each aggregator's standard published terms. The real number
 * is usually higher, because the discrepancies that hurt most are the ones
 * against negotiated rates.
 */

const ASSUMED_TERMS: Record<AggregatorCode, { commission: number; currency: Currency }> = {
  talabat: { commission: 0.25, currency: 'SAR' },
  hungerstation: { commission: 0.25, currency: 'SAR' },
  jahez: { commission: 0.25, currency: 'SAR' },
  deliveroo: { commission: 0.3, currency: 'AED' },
  careem: { commission: 0.3, currency: 'AED' },
  noon: { commission: 0.25, currency: 'AED' },
};

export interface AuditBreakdownRow {
  readonly causeCode: string;
  readonly label: string;
  readonly labelAr: string;
  readonly count: number;
  readonly amountMinor: number;
  readonly countsTowardsRecovery: boolean;
}

export interface AuditResult {
  readonly ok: boolean;
  readonly message: string | null;
  readonly recoveryTotalMinor: number;
  readonly currency: string;
  readonly ordersRead: number;
  readonly linesRead: number;
  readonly unmatchedLines: number;
  readonly breakdown: readonly AuditBreakdownRow[];
  readonly assumedCommissionRate: number;
  readonly parseNotes: readonly string[];
}

const EMPTY: AuditResult = {
  ok: false,
  message: null,
  recoveryTotalMinor: 0,
  currency: 'SAR',
  ordersRead: 0,
  linesRead: 0,
  unmatchedLines: 0,
  breakdown: [],
  assumedCommissionRate: 0,
  parseNotes: [],
};

const MAX_BYTES = 8 * 1024 * 1024;

export async function runFreeAudit(
  _previous: AuditResult,
  formData: FormData,
): Promise<AuditResult> {
  const file = formData.get('statement');
  const aggregatorCode = String(formData.get('aggregator') ?? '') as AggregatorCode;

  if (!(file instanceof File) || file.size === 0) {
    return { ...EMPTY, message: 'Choose a statement file to analyse.' };
  }
  if (file.size > MAX_BYTES) {
    return { ...EMPTY, message: 'That file is larger than 8 MB. Upload a single period.' };
  }
  if (!(aggregatorCode in ASSUMED_TERMS)) {
    return { ...EMPTY, message: 'Choose which aggregator the statement is from.' };
  }

  const terms = ASSUMED_TERMS[aggregatorCode];
  const content = Buffer.from(await file.arrayBuffer()).toString('utf8');

  const context: ParserContext = {
    aggregatorCode,
    currency: terms.currency,
    timezone: 'Asia/Riyadh',
  };

  const attempt = parseDocument(content, aggregatorCode, context);

  if (attempt.output === null) {
    return {
      ...EMPTY,
      currency: terms.currency,
      message:
        attempt.error ??
        (attempt.route.rung === 'manual_review'
          ? attempt.route.reason
          : `${attempt.route.drift.message} Send it to us and we will add support for this layout.`),
    };
  }

  const output = attempt.output;

  // Synthetic ids: nothing is written, and the engine only needs them to be
  // internally consistent.
  const orgId = randomUUID();
  const branchId = randomUUID();
  const aggregatorId = randomUUID();

  const orders: CanonicalOrder[] = output.orders.map((order, index) => ({
    id: `order-${index}`,
    orgId,
    branchId,
    aggregatorId,
    externalOrderId: order.externalOrderId,
    orderedAt: order.orderedAt,
    localDate: order.localDate,
    grossAmountMinor: order.grossAmountMinor,
    itemTotalMinor: order.itemTotalMinor,
    deliveryFeeMinor: order.deliveryFeeMinor,
    vatAmountMinor: order.vatAmountMinor,
    discountTotalMinor: order.discountTotalMinor,
    promoFunding: order.promoFunding,
    status: order.status,
    currency: order.currency,
    sourceRowId: `row-${order.sourceRowIndex}`,
  }));

  const payouts: CanonicalPayout[] = output.payouts.map((payout, index) => {
    const lines = payout.lines.map((line, lineIndex) => ({
      id: `line-${index}-${lineIndex}`,
      payoutId: `payout-${index}`,
      externalOrderId: line.externalOrderId,
      lineType: line.lineType,
      amountMinor: line.amountMinor,
      currency: line.currency,
      description: line.description,
      reference: line.reference,
      sourceRowId: `row-${line.sourceRowIndex}`,
    }));

    const gross = lines
      .filter((line) => line.lineType === 'gross_sale')
      .reduce((total, line) => total + line.amountMinor, 0);
    const deductions = lines
      .filter((line) => line.amountMinor < 0)
      .reduce((total, line) => total + line.amountMinor, 0);

    return {
      id: `payout-${index}`,
      orgId,
      branchId,
      aggregatorId,
      externalPayoutId: payout.externalPayoutId,
      period: period(payout.periodStart, payout.periodEnd),
      grossMinor: gross,
      deductionsMinor: deductions,
      netMinor: gross + deductions,
      paidOn: payout.paidOn,
      currency: terms.currency,
      sourceDocumentId: 'audit',
      sourceRowId: `row-${payout.sourceRowIndex}`,
      lines,
    };
  });

  const windowStart = output.periodStart ?? today();
  const windowEnd = output.periodEnd ?? today();

  const config: AggregatorAccountConfig = {
    id: 'assumed',
    orgId,
    branchId,
    aggregatorId,
    aggregatorCode,
    externalStoreId: 'unknown',
    contractedCommissionRate: terms.commission,
    promoShareTerms: { terms: [], defaultAggregatorSharePct: 0 },
    vatTreatment: 'commission_on_net',
    vatRate: 0.15,
    payoutCycleDays: 14,
    deliveryFeeBearer: 'customer',
    currency: terms.currency,
    // Wide open, so every order in the file is judged rather than falling
    // outside a configured period.
    effectiveFrom: '2000-01-01',
    effectiveTo: null,
  };

  let result;
  try {
    result = reconcile({
      orgId,
      branchId,
      aggregatorId,
      period: period(windowStart, windowEnd),
      currency: terms.currency,
      orders,
      payouts,
      configs: [config],
      asOf: today(),
    });
  } catch (error) {
    return {
      ...EMPTY,
      currency: terms.currency,
      message:
        error instanceof Error
          ? `We could not reconcile this file: ${error.message}`
          : 'We could not reconcile this file.',
    };
  }

  const breakdown: AuditBreakdownRow[] = result.summary.map((row) => {
    const cause = requireCauseCode(row.causeCode);
    return {
      causeCode: row.causeCode,
      label: cause.label,
      labelAr: cause.labelAr,
      count: row.count,
      amountMinor: row.totalDeltaMinor,
      countsTowardsRecovery: cause.countsTowardsRecovery,
    };
  });

  return {
    ok: true,
    message: null,
    recoveryTotalMinor: result.recoveryTotalMinor,
    currency: terms.currency,
    ordersRead: orders.length,
    linesRead: payouts.reduce((total, payout) => total + payout.lines.length, 0),
    unmatchedLines: result.unmatched.length,
    breakdown,
    assumedCommissionRate: terms.commission,
    parseNotes: output.problems.slice(0, 5).map((problem) => problem.message),
  };
}
