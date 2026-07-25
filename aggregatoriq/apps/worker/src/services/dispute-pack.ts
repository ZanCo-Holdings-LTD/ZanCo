/**
 * Dispute pack generation.
 *
 * This is the deliverable. Everything upstream — ingestion, matching, the rule
 * set — exists so that an operator can hand a partner manager a document that
 * says "here is what you charged, here is what our contract says, here is the
 * difference, and here are the rows it came from".
 *
 * Two properties matter more than presentation:
 *
 *   Every claim carries its evidence. Each variance prints its computation and
 *   the source rows behind it. A pack whose numbers cannot be checked is one an
 *   aggregator dismisses in a sentence.
 *
 *   Nothing is rounded, restated or summarised into existence. The totals are
 *   sums of the figures printed above them, and the figures are the engine's.
 */
import { formatMoney, money, requireCauseCode, type Currency } from '@aggregatoriq/core';
import type { VarianceRecord } from '@aggregatoriq/db/repositories';
import { body, heading, mono, renderPdf, rule, spacer, title, type PdfBlock } from './pdf.js';

export interface DisputePackInput {
  readonly organisationName: string;
  readonly branchName: string;
  readonly aggregatorName: string;
  readonly externalStoreId: string | null;
  readonly reference: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly currency: Currency;
  readonly generatedOn: string;
  readonly variances: readonly VarianceRecord[];
  /** Raw rows keyed by id, so each claim can print the evidence behind it. */
  readonly sourceRows: ReadonlyMap<string, { rowIndex: number; raw: unknown; filename: string | null }>;
}

function amount(minor: number, currency: Currency): string {
  return formatMoney(money(minor, currency), 'en');
}

export function buildDisputePackPdf(input: DisputePackInput): Buffer {
  const claimable = input.variances.filter(
    (variance) => requireCauseCode(variance.causeCode).countsTowardsRecovery && variance.deltaMinor > 0,
  );
  const forInvestigation = input.variances.filter(
    (variance) => !requireCauseCode(variance.causeCode).countsTowardsRecovery,
  );

  const total = claimable.reduce((sum, variance) => sum + variance.deltaMinor, 0);

  const blocks: PdfBlock[] = [
    title(`Settlement discrepancy claim — ${input.reference}`),
    body(`From: ${input.organisationName} (${input.branchName})`),
    body(
      `To: ${input.aggregatorName}${input.externalStoreId ? ` — store ${input.externalStoreId}` : ''}`,
    ),
    body(`Period: ${input.periodStart} to ${input.periodEnd}`),
    body(`Prepared: ${input.generatedOn}`),
    rule(),
    spacer(),
    heading(`Total claimed: ${amount(total, input.currency)}`),
    body(
      `${claimable.length} discrepancy item(s) across ${countCauses(claimable)} category(ies). ` +
        `Each item below states what the contracted terms produce, what the statement charged, ` +
        `and the statement rows the figures were read from.`,
    ),
    spacer(),
  ];

  const grouped = new Map<string, VarianceRecord[]>();
  for (const variance of claimable) {
    const bucket = grouped.get(variance.causeCode) ?? [];
    bucket.push(variance);
    grouped.set(variance.causeCode, bucket);
  }

  const ordered = [...grouped.entries()].sort(
    ([, a], [, b]) =>
      b.reduce((sum, v) => sum + v.deltaMinor, 0) - a.reduce((sum, v) => sum + v.deltaMinor, 0),
  );

  for (const [code, items] of ordered) {
    const cause = requireCauseCode(code);
    const subtotal = items.reduce((sum, variance) => sum + variance.deltaMinor, 0);

    blocks.push(rule());
    blocks.push(heading(`${cause.label} — ${amount(subtotal, input.currency)}`));
    blocks.push(body(cause.description));
    blocks.push(spacer());

    for (const [index, variance] of items.entries()) {
      blocks.push(
        heading(`${index + 1}. ${amount(variance.deltaMinor, input.currency)} claimed`),
      );
      blocks.push(
        body(
          `Expected ${amount(variance.expectedMinor, input.currency)}, ` +
            `charged ${amount(variance.actualMinor, input.currency)}.`,
        ),
      );
      blocks.push(body(variance.evidence.computation));

      const rows = variance.evidence.source_row_ids
        .map((id) => input.sourceRows.get(id))
        .filter((row): row is NonNullable<typeof row> => row !== undefined);

      if (rows.length > 0) {
        blocks.push(body('Statement rows:'));
        for (const row of rows.slice(0, 6)) {
          blocks.push(
            mono(
              `  ${row.filename ?? 'statement'} row ${row.rowIndex + 1}: ${summariseRow(row.raw)}`,
            ),
          );
        }
        if (rows.length > 6) {
          blocks.push(mono(`  ... and ${rows.length - 6} further row(s), listed in the CSV export.`));
        }
      }
      blocks.push(spacer());
    }
  }

  if (forInvestigation.length > 0) {
    blocks.push(rule());
    blocks.push(heading('Raised for explanation, not claimed'));
    blocks.push(
      body(
        'The items below are not included in the total above. They are deductions we cannot ' +
          'account for, or timing issues, and we are asking for an explanation rather than a ' +
          'refund.',
      ),
    );
    blocks.push(spacer());

    for (const variance of forInvestigation) {
      const cause = requireCauseCode(variance.causeCode);
      blocks.push(heading(`${cause.label} — ${amount(variance.deltaMinor, input.currency)}`));
      blocks.push(body(variance.evidence.computation));
      blocks.push(spacer());
    }
  }

  blocks.push(rule());
  blocks.push(
    body(
      'Every figure in this document was computed from the statements and order exports ' +
        `${input.aggregatorName} provided, against the commission and promotion terms on our ` +
        'account. We are happy to walk through any item.',
    ),
  );

  return renderPdf(blocks);
}

/**
 * CSV export of the same pack.
 *
 * Not a lesser version of the PDF: a partner manager who wants to check the
 * numbers will paste this into a spreadsheet, and making that easy makes the
 * claim easier to accept.
 */
export function buildDisputePackCsv(input: DisputePackInput): string {
  const headers = [
    'reference', 'cause_code', 'cause_label', 'recoverable', 'order_id',
    'expected', 'charged', 'claimed', 'currency', 'confidence',
    'computation', 'source_rows',
  ];

  const rows = input.variances.map((variance) => {
    const cause = requireCauseCode(variance.causeCode);
    const rows_ = variance.evidence.source_row_ids
      .map((id) => {
        const row = input.sourceRows.get(id);
        return row ? `${row.filename ?? 'statement'}#${row.rowIndex + 1}` : id;
      })
      .join(' ');

    return [
      input.reference,
      variance.causeCode,
      cause.label,
      cause.countsTowardsRecovery ? 'yes' : 'no',
      variance.orderId ?? '',
      formatDecimal(variance.expectedMinor, input.currency),
      formatDecimal(variance.actualMinor, input.currency),
      formatDecimal(variance.deltaMinor, input.currency),
      variance.currency,
      variance.confidence.toFixed(3),
      variance.evidence.computation,
      rows_,
    ];
  });

  return [headers, ...rows].map((row) => row.map(quoteCsv).join(',')).join('\n');
}

function formatDecimal(minor: number, currency: Currency): string {
  const exponent = currency === 'KWD' || currency === 'BHD' || currency === 'OMR' ? 3 : 2;
  const negative = minor < 0;
  const digits = Math.abs(minor).toString().padStart(exponent + 1, '0');
  return `${negative ? '-' : ''}${digits.slice(0, -exponent)}.${digits.slice(-exponent)}`;
}

function quoteCsv(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function countCauses(variances: readonly VarianceRecord[]): number {
  return new Set(variances.map((variance) => variance.causeCode)).size;
}

/** Render a raw row compactly enough to fit a PDF line. */
function summariseRow(raw: unknown): string {
  if (typeof raw !== 'object' || raw === null) return String(raw);

  return Object.entries(raw as Record<string, unknown>)
    .filter(([key]) => !key.startsWith('_'))
    .map(([, value]) => String(value))
    .filter((value) => value !== '')
    .join(' | ')
    .slice(0, 150);
}
