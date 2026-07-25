/**
 * Deterministic parser factories.
 *
 * Aggregator statements differ in their column names and their vocabulary, not
 * in their shape: an order export is one row per order, a payout statement is
 * one row per settlement line. So each aggregator supplies a *configuration* —
 * which header means what, and which of their type words maps to which canonical
 * line type — and the reading, coercion and error handling live here once.
 *
 * One parser per aggregator written out longhand would mean the same date-format
 * bug fixed three times and missed on the fourth.
 */
import { localDate, parseAmountToMinor, parseStatementDate, parseStatementInstant } from '@aggregatoriq/core';
import type { Currency, OrderStatus, PayoutLineType, PlainDate, SourceDocumentKind } from '@aggregatoriq/core';
import { fingerprintHeaders } from './fingerprint.js';
import { readSheet, type Sheet } from './csv.js';
import type {
  ParsedOrder,
  ParsedPayout,
  ParsedPayoutLine,
  Parser,
  ParserContext,
  ParseOutput,
  RowProblem,
} from './types.js';

// ---------------------------------------------------------------------------
// Shared reading helpers
// ---------------------------------------------------------------------------

/** Resolve a configured column name against the sheet's actual headers. */
function column(sheet: Sheet, name: string | undefined): string | null {
  if (name === undefined) return null;
  const target = name.trim().toLowerCase();
  return sheet.headers.find((header) => header.trim().toLowerCase() === target) ?? null;
}

function cell(row: Record<string, string>, header: string | null): string {
  if (header === null) return '';
  return (row[header] ?? '').trim();
}

interface Reader {
  readonly row: Record<string, string>;
  readonly index: number;
  readonly problems: RowProblem[];
}

/**
 * Read a money cell.
 *
 * A blank cell is a legitimate zero — most statements leave a fee column empty
 * rather than writing 0.00. An unreadable cell is not: it records a problem and
 * returns null, so the caller drops the row rather than treating a number it
 * could not read as nothing.
 */
function money(reader: Reader, header: string | null, currency: Currency, field: string): number | null {
  const raw = cell(reader.row, header);
  if (raw === '') return 0;

  const parsed = parseAmountToMinor(raw, currency);
  if (parsed === null) {
    reader.problems.push({
      sourceRowIndex: reader.index,
      field,
      rawValue: raw,
      message: `Could not read "${raw}" as an amount. The row was skipped rather than counted as zero.`,
    });
    return null;
  }
  return parsed;
}

function requiredText(reader: Reader, header: string | null, field: string): string | null {
  const raw = cell(reader.row, header);
  if (raw === '') {
    reader.problems.push({
      sourceRowIndex: reader.index,
      field,
      rawValue: null,
      message: `${field} is empty and is required to identify this row.`,
    });
    return null;
  }
  return raw;
}

// ---------------------------------------------------------------------------
// Order exports
// ---------------------------------------------------------------------------

export interface OrderParserConfig {
  readonly key: string;
  readonly version: string;
  readonly aggregatorCode: Parser['aggregatorCode'];
  readonly headers: readonly string[];
  readonly columns: {
    readonly orderId: string;
    readonly orderedAt: string;
    readonly status: string;
    readonly itemTotal: string;
    readonly deliveryFee?: string;
    readonly vat?: string;
    readonly discount?: string;
    readonly gross?: string;
    readonly promoType?: string;
    readonly promoFundedBy?: string;
    readonly promoAmount?: string;
  };
  /** Their status vocabulary mapped to ours. Unlisted values become `unknown`. */
  readonly statusMap: Readonly<Record<string, OrderStatus>>;
  /** Their promo-funding vocabulary. Unlisted values are treated as operator-funded. */
  readonly fundedByMap?: Readonly<Record<string, 'aggregator' | 'operator' | 'customer' | 'shared'>>;
}

export function createOrderParser(config: OrderParserConfig): Parser {
  return {
    key: config.key,
    version: config.version,
    aggregatorCode: config.aggregatorCode,
    kind: 'order_export' satisfies SourceDocumentKind,
    headers: config.headers,
    parse: (content, context) => parseOrders(config, content, context),
  };
}

function parseOrders(
  config: OrderParserConfig,
  content: string,
  context: ParserContext,
): ParseOutput {
  const sheet = readSheet(content);
  const problems: RowProblem[] = [];
  const orders: ParsedOrder[] = [];

  const columns = {
    orderId: column(sheet, config.columns.orderId),
    orderedAt: column(sheet, config.columns.orderedAt),
    status: column(sheet, config.columns.status),
    itemTotal: column(sheet, config.columns.itemTotal),
    deliveryFee: column(sheet, config.columns.deliveryFee),
    vat: column(sheet, config.columns.vat),
    discount: column(sheet, config.columns.discount),
    gross: column(sheet, config.columns.gross),
    promoType: column(sheet, config.columns.promoType),
    promoFundedBy: column(sheet, config.columns.promoFundedBy),
    promoAmount: column(sheet, config.columns.promoAmount),
  };

  sheet.rows.forEach((row, offset) => {
    const index = sheet.headerRowIndex + 1 + offset;
    const reader: Reader = { row, index, problems };

    const externalOrderId = requiredText(reader, columns.orderId, 'order id');
    if (externalOrderId === null) return;

    const rawDate = cell(row, columns.orderedAt);
    const orderedAt = parseStatementInstant(rawDate, context.timezone);
    if (orderedAt === null) {
      problems.push({
        sourceRowIndex: index,
        field: 'ordered at',
        rawValue: rawDate || null,
        message:
          `Could not read "${rawDate}" as a date and time. Without it the order cannot be placed ` +
          `in a statement period, so the row was skipped rather than guessed at.`,
      });
      return;
    }

    const itemTotal = money(reader, columns.itemTotal, context.currency, 'item total');
    const deliveryFee = money(reader, columns.deliveryFee, context.currency, 'delivery fee');
    const vat = money(reader, columns.vat, context.currency, 'vat');
    const discount = money(reader, columns.discount, context.currency, 'discount');
    const grossColumn = money(reader, columns.gross, context.currency, 'gross');

    if (itemTotal === null || deliveryFee === null || vat === null || discount === null || grossColumn === null) {
      return;
    }

    // Prefer the aggregator's own gross when they state one — it is the figure
    // they will argue from. Otherwise derive it, and say so implicitly by the
    // components adding up.
    const gross =
      columns.gross !== null && cell(row, columns.gross) !== ''
        ? grossColumn
        : itemTotal + vat + deliveryFee;

    const statusRaw = cell(row, columns.status);
    const status = config.statusMap[statusRaw.trim().toLowerCase()] ?? 'unknown';
    if (statusRaw !== '' && status === 'unknown') {
      problems.push({
        sourceRowIndex: index,
        field: 'status',
        rawValue: statusRaw,
        message:
          `Unrecognised order status "${statusRaw}". The order was kept but marked unknown, ` +
          `which means no cancellation or missing-payout finding will be raised for it.`,
      });
    }

    const promoAmount = money(reader, columns.promoAmount, context.currency, 'promo amount');
    const promoType = cell(row, columns.promoType);
    const fundedByRaw = cell(row, columns.promoFundedBy).trim().toLowerCase();

    const promoFunding: ParsedOrder['promoFunding'] =
      promoAmount !== null && promoAmount > 0 && promoType !== ''
        ? [
            {
              promoType,
              amountMinor: promoAmount,
              fundedBy: config.fundedByMap?.[fundedByRaw] ?? 'operator',
              aggregatorSharePct: null,
            },
          ]
        : [];

    orders.push({
      sourceRowIndex: index,
      externalOrderId,
      orderedAt,
      localDate: localDate(orderedAt, context.timezone),
      grossAmountMinor: gross,
      itemTotalMinor: itemTotal,
      deliveryFeeMinor: deliveryFee,
      vatAmountMinor: vat,
      discountTotalMinor: discount,
      promoFunding,
      status,
      currency: context.currency,
    });
  });

  const dates = orders.map((order) => order.localDate).sort();

  return {
    kind: 'order_export',
    parserKey: config.key,
    parserVersion: config.version,
    method: 'deterministic',
    headerFingerprint: fingerprintHeaders(sheet.headers),
    periodStart: dates[0] ?? null,
    periodEnd: dates[dates.length - 1] ?? null,
    orders,
    payouts: [],
    problems,
    rawRows: rawRowsOf(sheet),
  };
}

// ---------------------------------------------------------------------------
// Payout statements
// ---------------------------------------------------------------------------

export interface PayoutParserConfig {
  readonly key: string;
  readonly version: string;
  readonly aggregatorCode: Parser['aggregatorCode'];
  readonly headers: readonly string[];
  readonly columns: {
    readonly payoutId?: string;
    readonly orderId?: string;
    readonly lineType: string;
    readonly amount: string;
    readonly date?: string;
    readonly description?: string;
    readonly reference?: string;
    readonly periodStart?: string;
    readonly periodEnd?: string;
    readonly paidOn?: string;
  };
  /** Their transaction-type vocabulary mapped to ours. */
  readonly lineTypeMap: Readonly<Record<string, PayoutLineType>>;
  /**
   * Whether the statement quotes deductions as positive numbers.
   *
   * Several do — a "Commission" column of 25.00 meaning 25.00 taken. The sign is
   * then applied from the line type here, at the parser boundary, so that
   * everything downstream can rely on deductions being negative.
   */
  readonly deductionsArePositive: boolean;
  /** Fallback payout id when the statement has no such column. */
  readonly payoutIdFallback?: (context: ParserContext, period: { start: PlainDate; end: PlainDate }) => string;
}

const DEDUCTION_TYPES: readonly PayoutLineType[] = [
  'commission',
  'promo_recharge',
  'refund',
  'cancellation',
  'chargeback',
  'penalty',
];

export function createPayoutParser(config: PayoutParserConfig): Parser {
  return {
    key: config.key,
    version: config.version,
    aggregatorCode: config.aggregatorCode,
    kind: 'payout_statement' satisfies SourceDocumentKind,
    headers: config.headers,
    parse: (content, context) => parsePayout(config, content, context),
  };
}

function parsePayout(
  config: PayoutParserConfig,
  content: string,
  context: ParserContext,
): ParseOutput {
  const sheet = readSheet(content);
  const problems: RowProblem[] = [];

  const columns = {
    payoutId: column(sheet, config.columns.payoutId),
    orderId: column(sheet, config.columns.orderId),
    lineType: column(sheet, config.columns.lineType),
    amount: column(sheet, config.columns.amount),
    date: column(sheet, config.columns.date),
    description: column(sheet, config.columns.description),
    reference: column(sheet, config.columns.reference),
    periodStart: column(sheet, config.columns.periodStart),
    periodEnd: column(sheet, config.columns.periodEnd),
    paidOn: column(sheet, config.columns.paidOn),
  };

  interface Draft {
    lines: ParsedPayoutLine[];
    dates: PlainDate[];
    periodStart: PlainDate | null;
    periodEnd: PlainDate | null;
    paidOn: PlainDate | null;
    headerRowIndex: number;
  }

  const drafts = new Map<string, Draft>();

  sheet.rows.forEach((row, offset) => {
    const index = sheet.headerRowIndex + 1 + offset;
    const reader: Reader = { row, index, problems };

    const rawType = cell(row, columns.lineType);
    const lineType = config.lineTypeMap[rawType.trim().toLowerCase()];

    if (lineType === undefined) {
      problems.push({
        sourceRowIndex: index,
        field: 'line type',
        rawValue: rawType || null,
        message:
          `Unrecognised transaction type "${rawType}". The line was not imported — mapping it to ` +
          `"other" would put an unexplained amount into the reconciliation as though it were ` +
          `understood.`,
      });
      return;
    }

    const amount = money(reader, columns.amount, context.currency, 'amount');
    if (amount === null) return;

    // Apply the sign convention here, once, at the boundary.
    const signed =
      config.deductionsArePositive && DEDUCTION_TYPES.includes(lineType)
        ? -Math.abs(amount)
        : amount;

    const payoutId =
      cell(row, columns.payoutId) ||
      config.payoutIdFallback?.(context, {
        start: cell(row, columns.periodStart) || '',
        end: cell(row, columns.periodEnd) || '',
      }) ||
      'STATEMENT';

    const draft = drafts.get(payoutId) ?? {
      lines: [],
      dates: [],
      periodStart: null,
      periodEnd: null,
      paidOn: null,
      headerRowIndex: index,
    };

    draft.lines.push({
      sourceRowIndex: index,
      externalOrderId: cell(row, columns.orderId) || null,
      lineType,
      amountMinor: signed,
      currency: context.currency,
      description: cell(row, columns.description) || null,
      reference: cell(row, columns.reference) || null,
    });

    const transactionDate = parseStatementDate(cell(row, columns.date));
    if (transactionDate !== null) draft.dates.push(transactionDate);

    draft.periodStart ??= parseStatementDate(cell(row, columns.periodStart));
    draft.periodEnd ??= parseStatementDate(cell(row, columns.periodEnd));
    draft.paidOn ??= parseStatementDate(cell(row, columns.paidOn));

    drafts.set(payoutId, draft);
  });

  const payouts: ParsedPayout[] = [];

  for (const [externalPayoutId, draft] of [...drafts.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const sortedDates = [...draft.dates].sort();
    const start = draft.periodStart ?? sortedDates[0] ?? null;
    const end = draft.periodEnd ?? sortedDates[sortedDates.length - 1] ?? null;

    if (start === null || end === null) {
      problems.push({
        sourceRowIndex: draft.headerRowIndex,
        field: 'period',
        rawValue: null,
        message:
          `Statement ${externalPayoutId} carries no usable dates, so the period it covers is ` +
          `unknown. Without a period it cannot be matched to orders or checked for coverage gaps.`,
      });
      continue;
    }

    payouts.push({
      sourceRowIndex: draft.headerRowIndex,
      externalPayoutId,
      periodStart: start,
      periodEnd: end,
      paidOn: draft.paidOn,
      currency: context.currency,
      lines: draft.lines,
    });
  }

  const allStarts = payouts.map((payout) => payout.periodStart).sort();
  const allEnds = payouts.map((payout) => payout.periodEnd).sort();

  return {
    kind: 'payout_statement',
    parserKey: config.key,
    parserVersion: config.version,
    method: 'deterministic',
    headerFingerprint: fingerprintHeaders(sheet.headers),
    periodStart: allStarts[0] ?? null,
    periodEnd: allEnds[allEnds.length - 1] ?? null,
    orders: [],
    payouts,
    problems,
    rawRows: rawRowsOf(sheet),
  };
}

/**
 * Every row of the document, header and preamble included, as it was read.
 *
 * Stored *positionally* rather than keyed by header. Two reasons, and the first
 * one bit during development:
 *
 *   A statement's preamble rows are narrower than its header, so keying by
 *   header silently discards cells from any row that does not match the header's
 *   width — and a raw layer that loses data is not a raw layer.
 *
 *   Replay reconstructs the delimited text from these rows. Positional keys make
 *   that reconstruction exact; header keys make it a guess about column order.
 *
 * The header row is itself one of these rows, so the drill-through view can
 * label the columns by reading row `_header_row_index`.
 */
function rawRowsOf(sheet: Sheet): Record<string, string>[] {
  return sheet.rawRows.map((row, index) => {
    const record: Record<string, string> = {
      _row_index: String(index),
      _header_row_index: String(sheet.headerRowIndex),
    };
    row.forEach((value, position) => {
      record[`column_${position + 1}`] = value;
    });
    return record;
  });
}
