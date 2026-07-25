import { describe, expect, it } from 'vitest';
import { detectDelimiter, findHeaderRow, parseCsv, readSheet } from './csv.js';
import { detectDrift, fingerprintHeaders, normaliseHeader } from './fingerprint.js';
import { ALL_PARSERS, hungerstationPayout, jahezPayout, talabatOrders, talabatPayout } from './aggregators/index.js';
import { knownFormats, parseDocument, route } from './registry.js';
import { parseStatusFor, type ParserContext } from './types.js';
import { compareReplay, rebuildDelimitedText, replay } from './replay.js';
import {
  HUNGERSTATION_PAYOUT_CSV,
  JAHEZ_PAYOUT_CSV,
  TALABAT_ORDERS_CSV,
  TALABAT_PAYOUT_CSV,
  TALABAT_PAYOUT_DRIFTED_CSV,
  UNRECOGNISABLE_TEXT,
} from './fixtures.js';

const SAUDI: ParserContext = {
  aggregatorCode: 'talabat',
  currency: 'SAR',
  timezone: 'Asia/Riyadh',
};

describe('CSV reading', () => {
  it('handles quotes, doubled quotes, CRLF and the Excel BOM', () => {
    expect(parseCsv('﻿a,b\r\n"x,y","say ""hi"""')).toEqual([
      ['a', 'b'],
      ['x,y', 'say "hi"'],
    ]);
  });

  it('detects the delimiter by column consistency, not raw frequency', () => {
    expect(detectDelimiter('a,b,c\n1,2,3')).toBe(',');
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';');
    expect(detectDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t');
    // Commas inside quoted values must not out-vote the real semicolon.
    expect(detectDelimiter('a;b\n"1,2,3,4";x')).toBe(';');
  });

  it('finds the header row beneath a preamble', () => {
    const rows = parseCsv(TALABAT_PAYOUT_CSV);
    expect(findHeaderRow(rows)).toBeGreaterThan(0);

    const sheet = readSheet(TALABAT_PAYOUT_CSV);
    expect(sheet.headers).toContain('Transaction Type');
  });

  it('disambiguates duplicated headers rather than losing a column', () => {
    const sheet = readSheet('Amount,Amount\n1.00,2.00');
    expect(sheet.headers).toEqual(['Amount', 'Amount_2']);
    expect(sheet.rows[0]).toEqual({ Amount: '1.00', Amount_2: '2.00' });
  });
});

describe('fingerprinting', () => {
  it('ignores cosmetic differences in a header', () => {
    expect(normaliseHeader('Amount (SAR)')).toBe('amount');
    expect(normaliseHeader('  ORDER_ID  ')).toBe('order id');
    expect(fingerprintHeaders(['Order ID', 'Amount (SAR)'])).toBe(
      fingerprintHeaders(['order_id', 'amount']),
    );
  });

  it('treats a reordered header as a different fingerprint', () => {
    expect(fingerprintHeaders(['A', 'B'])).not.toBe(fingerprintHeaders(['B', 'A']));
  });

  it('recognises a known format', () => {
    const report = detectDrift(talabatPayout.headers, knownFormats());
    expect(report.kind).toBe('known');
    expect(report.parserKey).toBe('talabat_payout_v1');
    expect(report.shouldAlert).toBe(false);
  });

  it('alerts on a renamed column and refuses to use the closest parser', () => {
    // A partial match is how a renamed column silently becomes a zero.
    const headers = readSheet(TALABAT_PAYOUT_DRIFTED_CSV).headers;
    const report = detectDrift(headers, knownFormats());

    expect(report.kind).toBe('columns_removed');
    expect(report.parserKey).toBeNull();
    expect(report.shouldAlert).toBe(true);
    expect(report.addedHeaders).toContain('txn type');
    expect(report.removedHeaders).toContain('transaction type');
  });

  it('flags a completely unknown layout', () => {
    const report = detectDrift(['Widgets', 'Sprockets'], knownFormats());
    expect(report.kind).toBe('unknown');
    expect(report.parserKey).toBeNull();
    expect(report.shouldAlert).toBe(true);
  });
});

describe('routing', () => {
  it('sends a recognised statement down the deterministic path', () => {
    const chosen = route(TALABAT_PAYOUT_CSV, 'talabat');
    expect(chosen.rung).toBe('deterministic');
  });

  it('sends a drifted format to extraction rather than to a half-matching parser', () => {
    const chosen = route(TALABAT_PAYOUT_DRIFTED_CSV, 'talabat');
    expect(chosen.rung).toBe('extraction');
  });

  it('sends an email body to manual review', () => {
    const chosen = route(UNRECOGNISABLE_TEXT, 'talabat');
    expect(chosen.rung).toBe('manual_review');
  });

  it('will not read a Talabat statement with a HungerStation parser', () => {
    const chosen = route(TALABAT_PAYOUT_CSV, 'hungerstation');
    expect(chosen.rung).not.toBe('deterministic');
  });
});

describe('the Talabat order parser', () => {
  const output = talabatOrders.parse(TALABAT_ORDERS_CSV, SAUDI);

  it('reads every order', () => {
    expect(output.orders).toHaveLength(5);
    expect(output.problems).toEqual([]);
    expect(parseStatusFor(output)).toBe('parsed');
  });

  it('reads amounts as integer minor units, thousands separators and all', () => {
    const big = output.orders.find((order) => order.externalOrderId === 'TLB1005')!;
    expect(big.itemTotalMinor).toBe(120_000);
    expect(big.grossAmountMinor).toBe(126_000);
  });

  it('places a late-evening order on the right local day', () => {
    // 21:47 in Riyadh is still the 6th locally, but 18:47Z.
    const order = output.orders.find((candidate) => candidate.externalOrderId === 'TLB1004')!;
    expect(order.localDate).toBe('2025-03-06');
    expect(order.orderedAt.toISOString()).toBe('2025-03-06T18:47:00.000Z');
  });

  it('maps their status vocabulary to ours', () => {
    const cancelled = output.orders.find((order) => order.externalOrderId === 'TLB1003')!;
    expect(cancelled.status).toBe('cancelled');
    expect(output.orders.filter((order) => order.status === 'delivered')).toHaveLength(4);
  });

  it('records who the aggregator says funded a promotion', () => {
    const promoted = output.orders.find((order) => order.externalOrderId === 'TLB1002')!;
    expect(promoted.promoFunding).toEqual([
      {
        promoType: 'Ramadan15',
        amountMinor: 2_000,
        fundedBy: 'aggregator',
        aggregatorSharePct: null,
      },
    ]);
  });
});

describe('the Talabat payout parser', () => {
  const output = talabatPayout.parse(TALABAT_PAYOUT_CSV, SAUDI);
  const payout = output.payouts[0]!;

  it('groups the lines into one settlement with its period', () => {
    expect(output.payouts).toHaveLength(1);
    expect(payout.externalPayoutId).toBe('PAY-2025-05');
    expect(payout.periodStart).toBe('2025-03-01');
    expect(payout.periodEnd).toBe('2025-03-15');
    expect(payout.paidOn).toBe('2025-03-29');
  });

  it('applies the sign convention at the boundary', () => {
    // The statement quotes deductions as positives; everything downstream relies
    // on them being negative.
    const commissions = payout.lines.filter((line) => line.lineType === 'commission');
    expect(commissions.length).toBeGreaterThan(0);
    expect(commissions.every((line) => line.amountMinor < 0)).toBe(true);

    const sales = payout.lines.filter((line) => line.lineType === 'gross_sale');
    expect(sales.every((line) => line.amountMinor > 0)).toBe(true);
  });

  it('does not import a transaction type it does not recognise', () => {
    // Mapping an unknown type to "other" would put an unexplained amount into
    // the reconciliation as though it were understood.
    const jahez = jahezPayout.parse(JAHEZ_PAYOUT_CSV, { ...SAUDI, aggregatorCode: 'jahez' });
    const problem = jahez.problems.find((issue) => issue.rawValue === 'Mystery Fee');

    expect(problem).toBeDefined();
    expect(problem!.message).toContain('was not imported');
    expect(jahez.payouts[0]!.lines.every((line) => line.amountMinor !== -9_900)).toBe(true);
  });

  it('keeps the lineage index on every line', () => {
    for (const line of payout.lines) {
      expect(line.sourceRowIndex).toBeGreaterThanOrEqual(0);
      expect(line.sourceRowIndex).toBeLessThan(output.rawRows.length);
    }
  });

  it('keeps an unreferenced chargeback, which the engine needs to see', () => {
    const chargeback = payout.lines.find((line) => line.lineType === 'chargeback')!;
    expect(chargeback.externalOrderId).toBeNull();
    expect(chargeback.amountMinor).toBe(-7_500);
  });
});

describe('the HungerStation payout parser', () => {
  const output = hungerstationPayout.parse(HUNGERSTATION_PAYOUT_CSV, {
    ...SAUDI,
    aggregatorCode: 'hungerstation',
  });

  it('reads a semicolon-delimited export', () => {
    expect(output.payouts).toHaveLength(1);
    expect(output.payouts[0]!.lines).toHaveLength(5);
  });

  it('reads already-signed values without double-negating them', () => {
    const commissions = output.payouts[0]!.lines.filter((line) => line.lineType === 'commission');
    expect(commissions.map((line) => line.amountMinor)).toEqual([-2_500, -5_250]);
  });

  it('reads accounting parentheses as a negative', () => {
    const line = output.payouts[0]!.lines.find((candidate) => candidate.amountMinor === -5_250);
    expect(line).toBeDefined();
  });
});

describe('parse quality reporting', () => {
  it('marks a mostly-good document as partially parsed rather than clean', () => {
    const jahez = jahezPayout.parse(JAHEZ_PAYOUT_CSV, { ...SAUDI, aggregatorCode: 'jahez' });
    expect(jahez.problems.length).toBeGreaterThan(0);
    expect(parseStatusFor(jahez)).not.toBe('parsed');
  });

  it('never silently drops a row it could not read', () => {
    const withBadAmount = [
      'Payout Reference,Transaction Date,Order ID,Transaction Type,Amount,Description,Period Start,Period End,Payment Date',
      'P1,05/03/2025,O1,Commission,not-a-number,,01/03/2025,15/03/2025,29/03/2025',
    ].join('\n');

    const output = talabatPayout.parse(withBadAmount, SAUDI);
    expect(output.problems).toHaveLength(1);
    expect(output.problems[0]!.message).toContain('rather than counted as zero');
  });
});

describe('parseDocument', () => {
  it('returns an output for a recognised statement', () => {
    const attempt = parseDocument(TALABAT_PAYOUT_CSV, 'talabat', SAUDI);
    expect(attempt.route.rung).toBe('deterministic');
    expect(attempt.output?.payouts).toHaveLength(1);
    expect(attempt.error).toBeNull();
  });

  it('does not throw on an unreadable document', () => {
    const attempt = parseDocument(UNRECOGNISABLE_TEXT, 'talabat', SAUDI);
    expect(attempt.output).toBeNull();
    expect(attempt.route.rung).toBe('manual_review');
  });
});

describe('replay', () => {
  const original = talabatPayout.parse(TALABAT_PAYOUT_CSV, SAUDI);

  it('reproduces the same result from stored raw rows', () => {
    // The whole point: a parser fix must be applicable to documents already
    // ingested, without the original file.
    const result = replay({
      sourceDocumentId: 'doc-1',
      aggregatorCode: 'talabat',
      context: SAUDI,
      rawRows: original.rawRows,
    });

    expect(result.rung).toBe('deterministic');
    expect(result.output?.payouts).toHaveLength(1);
    expect(result.output?.payouts[0]!.lines.map((line) => line.amountMinor)).toEqual(
      original.payouts[0]!.lines.map((line) => line.amountMinor),
    );
  });

  it('round-trips quoted values through the rebuilt text', () => {
    const rebuilt = rebuildDelimitedText(original.rawRows);
    expect(rebuilt).toContain('"1,260.00"');
  });

  it('flags a replay that reads less than the stored version', () => {
    const comparison = compareReplay({ orderCount: 0, payoutLineCount: 99 }, original);
    expect(comparison.isRegression).toBe(true);
  });

  it('reports no rows to replay rather than throwing', () => {
    const result = replay({
      sourceDocumentId: 'doc-empty',
      aggregatorCode: 'talabat',
      context: SAUDI,
      rawRows: [],
    });
    expect(result.rung).toBe('manual_review');
    expect(result.error).toContain('No raw rows');
  });
});

describe('the registry', () => {
  it('gives every parser a unique key and a distinct fingerprint', () => {
    const keys = ALL_PARSERS.map((parser) => parser.key);
    expect(new Set(keys).size).toBe(keys.length);

    const fingerprints = ALL_PARSERS.map((parser) => fingerprintHeaders(parser.headers));
    expect(new Set(fingerprints).size).toBe(fingerprints.length);
  });

  it('recognises each parser’s own header layout', () => {
    for (const parser of ALL_PARSERS) {
      const report = detectDrift(parser.headers, knownFormats());
      expect(report.kind, parser.key).toBe('known');
    }
  });
});
