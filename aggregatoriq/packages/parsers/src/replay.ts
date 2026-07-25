/**
 * Replay.
 *
 * A parser fix has to be applicable to every document already ingested, or the
 * fix only helps future customers and the existing ones keep the wrong numbers.
 * That is possible only because the raw layer is immutable: the rows are still
 * there exactly as the aggregator sent them, so re-parsing is re-reading rather
 * than re-uploading.
 *
 * Built now rather than later, because retrofitting replay onto a system that
 * mutated its raw rows is not a refactor, it is a data recovery project.
 */
import type { AggregatorCode } from '@aggregatoriq/core';
import { parseDocument } from './registry.js';
import type { Parser, ParserContext, ParseOutput } from './types.js';

export interface ReplayInput {
  readonly sourceDocumentId: string;
  readonly aggregatorCode: AggregatorCode;
  readonly context: ParserContext;
  /** The stored raw rows, in `row_index` order. */
  readonly rawRows: readonly Record<string, string>[];
}

export interface ReplayResult {
  readonly sourceDocumentId: string;
  readonly output: ParseOutput | null;
  readonly parserKey: string | null;
  readonly rung: 'deterministic' | 'extraction' | 'manual_review';
  readonly error: string | null;
  /** True when this replay produced different results from what is stored. */
  readonly changed: boolean;
}

/**
 * Rebuild the delimited text a parser expects from stored raw rows.
 *
 * Raw rows are stored positionally (`column_1`, `column_2`, …) precisely so this
 * is exact rather than a guess about column ordering — `jsonb` does not preserve
 * key insertion order, so anything relying on it would work in development and
 * shuffle in production.
 *
 * The width is taken as the maximum across all rows, because a statement's
 * preamble and data rows are routinely different widths and truncating to the
 * first row's width would drop columns.
 */
export function rebuildDelimitedText(rawRows: readonly Record<string, string>[]): string {
  if (rawRows.length === 0) return '';

  let width = 0;
  for (const row of rawRows) {
    for (const key of Object.keys(row)) {
      const match = /^column_(\d+)$/.exec(key);
      if (match) width = Math.max(width, Number(match[1]));
    }
  }
  if (width === 0) return '';

  const escape = (value: string): string =>
    /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

  const ordered = [...rawRows].sort(
    (a, b) => Number(a._row_index ?? 0) - Number(b._row_index ?? 0),
  );

  return ordered
    .map((row) =>
      Array.from({ length: width }, (_, index) => escape(row[`column_${index + 1}`] ?? '')).join(','),
    )
    .join('\n');
}

/**
 * Re-parse one document from its stored raw rows.
 *
 * Note that this does not write anything. The caller decides whether to accept
 * the new canonical rows, which matters because a replay that produced *fewer*
 * orders than the stored version is a regression, not an improvement, and should
 * be looked at before it overwrites anything.
 */
export function replay(input: ReplayInput, parsers?: readonly Parser[]): ReplayResult {
  const content = rebuildDelimitedText(input.rawRows);

  if (content === '') {
    return {
      sourceDocumentId: input.sourceDocumentId,
      output: null,
      parserKey: null,
      rung: 'manual_review',
      error: 'No raw rows are stored for this document.',
      changed: false,
    };
  }

  const attempt = parseDocument(content, input.aggregatorCode, input.context, parsers);

  return {
    sourceDocumentId: input.sourceDocumentId,
    output: attempt.output,
    parserKey: attempt.route.rung === 'deterministic' ? attempt.route.parser.key : null,
    rung: attempt.route.rung,
    error: attempt.error,
    changed: attempt.output !== null,
  };
}

export interface ReplayComparison {
  readonly orderCountBefore: number;
  readonly orderCountAfter: number;
  readonly payoutLineCountBefore: number;
  readonly payoutLineCountAfter: number;
  readonly problemCountAfter: number;
  /** True when the replay reads *less* than the stored version — investigate. */
  readonly isRegression: boolean;
}

export function compareReplay(
  stored: { orderCount: number; payoutLineCount: number },
  output: ParseOutput,
): ReplayComparison {
  const orderCountAfter = output.orders.length;
  const payoutLineCountAfter = output.payouts.reduce(
    (total, payout) => total + payout.lines.length,
    0,
  );

  return {
    orderCountBefore: stored.orderCount,
    orderCountAfter,
    payoutLineCountBefore: stored.payoutLineCount,
    payoutLineCountAfter,
    problemCountAfter: output.problems.length,
    isRegression:
      orderCountAfter < stored.orderCount || payoutLineCountAfter < stored.payoutLineCount,
  };
}
