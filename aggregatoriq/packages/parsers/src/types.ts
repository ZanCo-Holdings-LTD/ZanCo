/**
 * The parser contract.
 *
 * A parser turns one document into canonical-shaped records, each carrying the
 * index of the raw row it came from. It does not touch the database and does not
 * know what a source row's id is — the caller writes the raw rows first, then
 * maps `sourceRowIndex` to the real id. That separation is what makes replay
 * possible: the raw rows already exist, so a parser fix re-runs against them
 * without re-reading the original file.
 */
import type {
  AggregatorCode,
  Currency,
  OrderStatus,
  ParseMethod,
  PayoutLineType,
  PlainDate,
  SourceDocumentKind,
} from '@aggregatoriq/core';

export interface ParserContext {
  readonly aggregatorCode: AggregatorCode;
  readonly currency: Currency;
  /** The branch's IANA timezone, which decides an order's calendar date. */
  readonly timezone: string;
  readonly externalStoreId?: string | null;
}

export interface ParsedOrder {
  readonly sourceRowIndex: number;
  readonly externalOrderId: string;
  readonly orderedAt: Date;
  readonly localDate: PlainDate;
  readonly grossAmountMinor: number;
  readonly itemTotalMinor: number;
  readonly deliveryFeeMinor: number;
  readonly vatAmountMinor: number;
  readonly discountTotalMinor: number;
  readonly promoFunding: readonly {
    promoType: string;
    amountMinor: number;
    fundedBy: 'aggregator' | 'operator' | 'customer' | 'shared';
    aggregatorSharePct: number | null;
  }[];
  readonly status: OrderStatus;
  readonly currency: Currency;
}

export interface ParsedPayoutLine {
  readonly sourceRowIndex: number;
  readonly externalOrderId: string | null;
  readonly lineType: PayoutLineType;
  readonly amountMinor: number;
  readonly currency: Currency;
  readonly description: string | null;
  readonly reference: string | null;
}

export interface ParsedPayout {
  readonly sourceRowIndex: number;
  readonly externalPayoutId: string;
  readonly periodStart: PlainDate;
  readonly periodEnd: PlainDate;
  readonly paidOn: PlainDate | null;
  readonly currency: Currency;
  readonly lines: readonly ParsedPayoutLine[];
}

/**
 * A row that could not be read.
 *
 * Never silently dropped and never defaulted to zero. A statement where 3% of
 * rows failed to parse must present as a partial parse the operator can see,
 * because the alternative is a recovery figure that is quietly missing 3% of the
 * evidence.
 */
export interface RowProblem {
  readonly sourceRowIndex: number;
  readonly field: string | null;
  readonly rawValue: string | null;
  readonly message: string;
}

export interface ParseOutput {
  readonly kind: SourceDocumentKind;
  readonly parserKey: string;
  readonly parserVersion: string;
  readonly method: ParseMethod;
  readonly headerFingerprint: string | null;
  readonly periodStart: PlainDate | null;
  readonly periodEnd: PlainDate | null;
  readonly orders: readonly ParsedOrder[];
  readonly payouts: readonly ParsedPayout[];
  readonly problems: readonly RowProblem[];
  /** Every raw row, in order, exactly as read. Written to `source_rows`. */
  readonly rawRows: readonly Record<string, string>[];
}

export interface Parser {
  readonly key: string;
  readonly version: string;
  readonly aggregatorCode: AggregatorCode;
  readonly kind: SourceDocumentKind;
  /** Header list this parser was written against, used for fingerprinting. */
  readonly headers: readonly string[];
  readonly parse: (content: string, context: ParserContext) => ParseOutput;
}

export class ParseFailure extends Error {
  readonly parserKey: string;
  constructor(parserKey: string, message: string) {
    super(message);
    this.name = 'ParseFailure';
    this.parserKey = parserKey;
  }
}

/**
 * Whether a parse is good enough to reconcile against.
 *
 * A document with problems is not rejected outright — most of it is usually
 * fine and the operator would rather see 97% of their money than none of it —
 * but it is marked `partially_parsed` so the reconciliation says so, and past a
 * threshold it goes to review instead. Hiding failures behind a spinner is the
 * one thing the brief is explicit about not doing.
 */
export const PARTIAL_PARSE_TOLERANCE = 0.05;

export function parseStatusFor(
  output: ParseOutput,
): 'parsed' | 'partially_parsed' | 'needs_review' {
  const total = output.rawRows.length;
  if (total === 0) return 'needs_review';
  if (output.problems.length === 0) return 'parsed';

  const failedRows = new Set(output.problems.map((problem) => problem.sourceRowIndex)).size;
  return failedRows / total > PARTIAL_PARSE_TOLERANCE ? 'needs_review' : 'partially_parsed';
}
