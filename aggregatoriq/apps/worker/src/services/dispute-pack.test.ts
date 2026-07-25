import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { VarianceRecord } from '@aggregatoriq/db/repositories';
import { buildDisputePackCsv, buildDisputePackPdf, type DisputePackInput } from './dispute-pack.js';
import { pricePerBranchMinor, recoveryShareMinor, verifyHmacSignature } from '../payments.js';

function variance(overrides: Partial<VarianceRecord> = {}): VarianceRecord {
  return {
    id: 'var-1',
    reconRunId: 'run-1',
    branchId: 'branch-1',
    aggregatorId: 'agg-1',
    orderId: 'order-1',
    causeCode: 'COMMISSION_RATE_MISMATCH',
    expectedMinor: -2_500,
    actualMinor: -3_000,
    deltaMinor: 500,
    currency: 'SAR',
    confidence: 1,
    evidence: {
      source_row_ids: ['row-1'],
      rule: 'commission_rate_mismatch',
      computation: 'Contracted 25% of 100.00 is 25.00; the statement deducted 30.00.',
      inputs: {},
    },
    status: 'open',
    dismissedReason: null,
    ...overrides,
  };
}

function packInput(variances: VarianceRecord[]): DisputePackInput {
  return {
    organisationName: 'Example Restaurants',
    branchName: 'Riyadh Olaya',
    aggregatorName: 'Talabat',
    externalStoreId: 'STORE-1',
    reference: 'DISP-2025-001',
    periodStart: '2025-03-01',
    periodEnd: '2025-03-15',
    currency: 'SAR',
    generatedOn: '2025-04-01',
    variances,
    sourceRows: new Map([
      ['row-1', { rowIndex: 4, raw: { column_1: 'TLB1002', column_2: 'Commission', column_3: '30.00' }, filename: 'march.csv' }],
    ]),
  };
}

describe('the dispute pack PDF', () => {
  it('produces a structurally valid PDF', () => {
    const pdf = buildDisputePackPdf(packInput([variance()]));
    const text = pdf.toString('latin1');

    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(text).toContain('/Type /Catalog');
    expect(text).toContain('xref');
    expect(text).toContain('startxref');
  });

  it('prints the claim, the arithmetic and the row it came from', () => {
    // A pack whose numbers cannot be checked is one an aggregator dismisses in
    // a sentence.
    const text = buildDisputePackPdf(packInput([variance()])).toString('latin1');

    expect(text).toContain('DISP-2025-001');
    expect(text).toContain('Contracted 25%');
    expect(text).toContain('march.csv row 5');
  });

  it('keeps flagged items out of the total and says why', () => {
    const pdf = buildDisputePackPdf(
      packInput([
        variance(),
        variance({
          id: 'var-2',
          causeCode: 'LATE_PAYOUT',
          expectedMinor: 0,
          actualMinor: 0,
          deltaMinor: 0,
          evidence: {
            source_row_ids: ['row-1'],
            rule: 'late_payout',
            computation: 'Paid 12 days outside the contracted cycle.',
            inputs: {},
          },
        }),
      ]),
    );
    const text = pdf.toString('latin1');

    expect(text).toContain('Raised for explanation, not claimed');
    // The total is the single claimable item, not both.
    expect(text).toMatch(/Total claimed: SAR\s*5\.00/);
  });

  it('does not produce a corrupt file when a name is not Latin', () => {
    const input = { ...packInput([variance()]), organisationName: 'مطاعم الرياض' };
    const text = buildDisputePackPdf(input).toString('latin1');

    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('?');
  });

  it('paginates a long pack rather than overflowing one page', () => {
    const many = Array.from({ length: 60 }, (_, index) =>
      variance({ id: `var-${index}`, orderId: `order-${index}` }),
    );
    const text = buildDisputePackPdf(packInput(many)).toString('latin1');
    const pageCount = (text.match(/\/Type \/Page[^s]/g) ?? []).length;

    expect(pageCount).toBeGreaterThan(1);
    expect(text).toContain('/Count');
  });
});

describe('the dispute pack CSV', () => {
  const csv = buildDisputePackCsv(packInput([variance()]));

  it('carries the same figures as the PDF', () => {
    expect(csv).toContain('COMMISSION_RATE_MISMATCH');
    expect(csv).toContain('-25.00');
    expect(csv).toContain('-30.00');
    expect(csv).toContain('5.00');
  });

  it('marks whether each row counts as recoverable', () => {
    const flagged = buildDisputePackCsv(
      packInput([variance({ causeCode: 'ADJUSTMENT_UNEXPLAINED' })]),
    );
    expect(csv).toContain(',yes,');
    expect(flagged).toContain(',no,');
  });

  it('quotes a computation containing a comma, and leaves one without alone', () => {
    // A commission figure with a thousands separator is the common case, and an
    // unquoted comma there would shift every later column by one.
    const withComma = buildDisputePackCsv(
      packInput([
        variance({
          evidence: {
            source_row_ids: ['row-1'],
            rule: 'commission_rate_mismatch',
            computation: 'Contracted 25% of 1,200.00 is 300.00, and 360.00 was deducted.',
            inputs: {},
          },
        }),
      ]),
    );

    expect(withComma).toContain(
      '"Contracted 25% of 1,200.00 is 300.00, and 360.00 was deducted."',
    );
    expect(csv).toContain('Contracted 25% of 100.00 is 25.00; the statement deducted 30.00.');
    expect(csv).not.toContain('"Contracted');
  });

  it('cites the source row', () => {
    expect(csv).toContain('march.csv#5');
  });
});

describe('pricing', () => {
  it('holds the published rates', () => {
    expect(pricePerBranchMinor(1, false)).toBe(9_900);
    expect(pricePerBranchMinor(5, false)).toBe(9_900);
    expect(pricePerBranchMinor(6, false)).toBe(7_900);
  });

  it('locks the founding rate regardless of branch count', () => {
    expect(pricePerBranchMinor(1, true)).toBe(7_900);
    expect(pricePerBranchMinor(40, true)).toBe(7_900);
  });

  it('caps the recovery share so one large recovery cannot produce a hostile invoice', () => {
    expect(recoveryShareMinor(100_000)).toBe(15_000);
    expect(recoveryShareMinor(10_000_000)).toBe(49_900);
  });
});

describe('webhook signatures', () => {
  const secret = 'a-secret-at-least-sixteen-chars';
  const bodyText = '{"type":"invoice.paid"}';

  it('accepts a correct signature in either notation', () => {
    const digest = createHmac('sha256', secret).update(bodyText, 'utf8').digest('hex');

    expect(verifyHmacSignature(bodyText, digest, secret)).toBe(true);
    expect(verifyHmacSignature(bodyText, `sha256=${digest}`, secret)).toBe(true);
  });

  it('rejects a missing, wrong or truncated signature', () => {
    expect(verifyHmacSignature(bodyText, undefined, secret)).toBe(false);
    expect(verifyHmacSignature(bodyText, '', secret)).toBe(false);
    expect(verifyHmacSignature(bodyText, 'deadbeef', secret)).toBe(false);
  });

  it('rejects a signature over a different body', () => {
    // Verifying against a re-serialised object verifies a different document
    // from the one that was signed.
    const digest = createHmac('sha256', secret).update('{"type":"other"}', 'utf8').digest('hex');
    expect(verifyHmacSignature(bodyText, digest, secret)).toBe(false);
  });
});
