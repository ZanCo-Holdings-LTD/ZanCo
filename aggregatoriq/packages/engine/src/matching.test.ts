import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_MATCH_OPTIONS,
  fuzzyConfidence,
  matchPayoutLines,
  normaliseOrderReference,
} from './matching.js';
import { aLine, anOrder, resetFixtureIds } from './testing/fixtures.js';

beforeEach(() => {
  resetFixtureIds();
});

describe('normaliseOrderReference', () => {
  it('ignores the noise aggregators add to the same reference', () => {
    expect(normaliseOrderReference('#123456')).toBe('123456');
    expect(normaliseOrderReference(' 123 456 ')).toBe('123456');
    expect(normaliseOrderReference('tlb-99')).toBe('TLB-99');
  });

  it('keeps a prefix, because collapsing it could match two different orders', () => {
    expect(normaliseOrderReference('TLB123456')).not.toBe(normaliseOrderReference('123456'));
  });

  it('treats empty as absent', () => {
    expect(normaliseOrderReference('')).toBeNull();
    expect(normaliseOrderReference('   ')).toBeNull();
    expect(normaliseOrderReference(null)).toBeNull();
  });
});

describe('rung 1 — exact order id', () => {
  it('matches with full confidence', () => {
    const order = anOrder({ externalOrderId: 'TLB1001' });
    const line = aLine('pay-1', { lineType: 'commission', amountMinor: -2_500, externalOrderId: 'TLB1001' });

    const result = matchPayoutLines([order], [line]);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]!.method).toBe('exact_order_id');
    expect(result.matches[0]!.confidence).toBe(1);
    expect(result.unmatched).toHaveLength(0);
  });

  it('matches across formatting differences', () => {
    const order = anOrder({ externalOrderId: '1001' });
    const line = aLine('pay-1', { lineType: 'commission', amountMinor: -100, externalOrderId: '#1001' });
    expect(matchPayoutLines([order], [line]).matches[0]!.method).toBe('exact_order_id');
  });

  it('collects several lines under one order', () => {
    const order = anOrder({ externalOrderId: 'TLB1001' });
    const lines = [
      aLine('pay-1', { lineType: 'gross_sale', amountMinor: 10_500, externalOrderId: 'TLB1001' }),
      aLine('pay-1', { lineType: 'commission', amountMinor: -2_500, externalOrderId: 'TLB1001' }),
    ];
    const result = matchPayoutLines([order], lines);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]!.payoutLineIds).toHaveLength(2);
  });
});

describe('rung 2 — order id plus amount', () => {
  it('disambiguates two orders sharing a reference', () => {
    const cheap = anOrder({ id: 'ord-a', externalOrderId: 'DUP1', itemTotalMinor: 10_000 });
    const dear = anOrder({ id: 'ord-b', externalOrderId: 'DUP1', itemTotalMinor: 50_000 });
    const line = aLine('pay-1', {
      lineType: 'gross_sale',
      amountMinor: dear.grossAmountMinor,
      externalOrderId: 'DUP1',
    });

    const result = matchPayoutLines([cheap, dear], [line]);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]!.orderId).toBe('ord-b');
    expect(result.matches[0]!.method).toBe('order_id_and_amount');
    expect(result.matches[0]!.confidence).toBeLessThan(1);
  });

  it('gives up rather than guessing when the amount does not single one out', () => {
    const first = anOrder({ id: 'ord-a', externalOrderId: 'DUP1', itemTotalMinor: 10_000 });
    const second = anOrder({ id: 'ord-b', externalOrderId: 'DUP1', itemTotalMinor: 10_000 });
    const line = aLine('pay-1', {
      lineType: 'gross_sale',
      amountMinor: first.grossAmountMinor,
      externalOrderId: 'DUP1',
    });

    const result = matchPayoutLines([first, second], [line]);
    expect(result.matches).toHaveLength(0);
    expect(result.unmatched[0]!.reason).toBe('ambiguous');
  });
});

describe('rung 3 — fuzzy on amount and time', () => {
  it('matches a single plausible candidate', () => {
    const order = anOrder({ itemTotalMinor: 10_000 });
    const line = aLine('pay-1', {
      lineType: 'gross_sale',
      amountMinor: order.grossAmountMinor,
      externalOrderId: null,
    });

    const result = matchPayoutLines([order], [line]);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]!.method).toBe('fuzzy_time_and_amount');
    expect(result.matches[0]!.confidence).toBeGreaterThanOrEqual(DEFAULT_MATCH_OPTIONS.confidenceFloor);
    expect(result.matches[0]!.confidence).toBeLessThan(1);
  });

  it('refuses to choose between two same-value orders on the same day', () => {
    // Indistinguishable, and a wrong match produces a confident claim about an
    // order that was never involved.
    const first = anOrder({ id: 'ord-a', itemTotalMinor: 10_000, orderedAt: new Date('2025-03-05T12:00:00Z') });
    const second = anOrder({ id: 'ord-b', itemTotalMinor: 10_000, orderedAt: new Date('2025-03-05T18:00:00Z') });
    const line = aLine('pay-1', {
      lineType: 'gross_sale',
      amountMinor: first.grossAmountMinor,
      externalOrderId: null,
    });

    const result = matchPayoutLines([first, second], [line]);
    expect(result.matches).toHaveLength(0);
    expect(result.unmatched[0]!.reason).toBe('ambiguous');
  });

  it('does not fuzzy-match a reference the aggregator gave us but we lack', () => {
    // The aggregator said which order it was. Guessing from the amount would
    // attribute the deduction to an unrelated order.
    const order = anOrder({ externalOrderId: 'TLB1001', itemTotalMinor: 10_000 });
    const line = aLine('pay-1', {
      lineType: 'commission',
      amountMinor: -order.grossAmountMinor,
      externalOrderId: 'TLB-NOT-OURS',
    });

    const result = matchPayoutLines([order], [line]);
    expect(result.matches).toHaveLength(0);
    expect(result.unmatched[0]!.reason).toBe('no_candidate');
  });

  it('reports no candidate at all as unmatched', () => {
    const order = anOrder({ itemTotalMinor: 10_000 });
    const line = aLine('pay-1', { lineType: 'adjustment', amountMinor: -99_999, externalOrderId: null });
    const result = matchPayoutLines([order], [line]);
    expect(result.unmatched[0]!.reason).toBe('no_order_reference');
  });
});

describe('confidence', () => {
  it('rises with an exact amount and a tight window', () => {
    const exactTight = fuzzyConfidence(true, 0, 1_440);
    const approxWide = fuzzyConfidence(false, 1_440, 1_440);
    expect(exactTight).toBeGreaterThan(approxWide);
    expect(approxWide).toBeGreaterThanOrEqual(DEFAULT_MATCH_OPTIONS.confidenceFloor);
    expect(exactTight).toBeLessThanOrEqual(1);
  });

  it('reports a multi-line match at the weakest rung used', () => {
    const order = anOrder({ externalOrderId: 'TLB1001', itemTotalMinor: 10_000 });
    const lines = [
      aLine('pay-1', { lineType: 'commission', amountMinor: -2_500, externalOrderId: 'TLB1001' }),
      aLine('pay-1', { lineType: 'gross_sale', amountMinor: order.grossAmountMinor, externalOrderId: null }),
    ];
    const result = matchPayoutLines([order], lines);
    expect(result.matches[0]!.payoutLineIds).toHaveLength(2);
    expect(result.matches[0]!.method).toBe('fuzzy_time_and_amount');
  });
});

describe('unpaid orders', () => {
  it('reports orders with no attributed line', () => {
    const paid = anOrder({ id: 'ord-paid', externalOrderId: 'A' });
    const unpaid = anOrder({ id: 'ord-unpaid', externalOrderId: 'B', itemTotalMinor: 77_777 });
    const line = aLine('pay-1', { lineType: 'commission', amountMinor: -100, externalOrderId: 'A' });

    const result = matchPayoutLines([paid, unpaid], [line]);
    expect(result.unpaidOrderIds).toEqual(['ord-unpaid']);
  });
});

describe('determinism', () => {
  it('does not depend on input order', () => {
    const orders = [
      anOrder({ id: 'ord-a', externalOrderId: 'A' }),
      anOrder({ id: 'ord-b', externalOrderId: 'B' }),
    ];
    const lines = [
      aLine('pay-1', { id: 'line-1', lineType: 'commission', amountMinor: -100, externalOrderId: 'A' }),
      aLine('pay-1', { id: 'line-2', lineType: 'commission', amountMinor: -200, externalOrderId: 'B' }),
    ];

    const forward = matchPayoutLines(orders, lines);
    const reversed = matchPayoutLines([...orders].reverse(), [...lines].reverse());
    expect(JSON.stringify(reversed)).toBe(JSON.stringify(forward));
  });
});
