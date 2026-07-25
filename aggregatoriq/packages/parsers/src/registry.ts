/**
 * The parsing ladder.
 *
 *   1. A deterministic parser, selected by an exact header fingerprint. This
 *      handles the large majority of volume.
 *   2. Schema-guided extraction, for PDFs and layouts nothing recognises.
 *   3. A manual review queue for anything that fails both.
 *
 * Selection is by fingerprint and nothing else. There is no "closest parser"
 * fallback, deliberately: a parser that half-fits a changed format is precisely
 * how a renamed column silently becomes a zero, and a zero commission reads as
 * good news.
 */
import type { AggregatorCode } from '@aggregatoriq/core';
import { detectDrift, fingerprintHeaderSet, fingerprintHeaders, type DriftReport, type KnownFormat } from './fingerprint.js';
import { readSheet } from './csv.js';
import { ALL_PARSERS } from './aggregators/index.js';
import type { Parser, ParserContext, ParseOutput } from './types.js';

export function knownFormats(parsers: readonly Parser[] = ALL_PARSERS): KnownFormat[] {
  return parsers.map((parser) => ({
    parserKey: parser.key,
    fingerprint: fingerprintHeaders(parser.headers),
    setFingerprint: fingerprintHeaderSet(parser.headers),
    headers: parser.headers,
  }));
}

export function parserByKey(key: string, parsers: readonly Parser[] = ALL_PARSERS): Parser | null {
  return parsers.find((parser) => parser.key === key) ?? null;
}

export function parsersFor(
  aggregatorCode: AggregatorCode,
  parsers: readonly Parser[] = ALL_PARSERS,
): Parser[] {
  return parsers.filter((parser) => parser.aggregatorCode === aggregatorCode);
}

export type Route =
  | { readonly rung: 'deterministic'; readonly parser: Parser; readonly drift: DriftReport }
  | { readonly rung: 'extraction'; readonly drift: DriftReport }
  | { readonly rung: 'manual_review'; readonly reason: string };

/**
 * Decide how to read a document.
 *
 * Scoped to the aggregator the branch's ingestion address or upload form says it
 * is from, so a Talabat statement cannot be read by a HungerStation parser that
 * happens to share a fingerprint.
 */
export function route(
  content: string,
  aggregatorCode: AggregatorCode,
  parsers: readonly Parser[] = ALL_PARSERS,
): Route {
  const sheet = readSheet(content);

  // Three columns is the floor for calling something tabular. Every real
  // statement format has eight or more; prose with a couple of commas in it
  // parses as two, and sending that to the extraction rung would spend a model
  // call to conclude what a column count already tells us.
  const MIN_TABULAR_COLUMNS = 3;

  if (sheet.headers.filter((header) => header !== '').length < MIN_TABULAR_COLUMNS) {
    return {
      rung: 'manual_review',
      reason:
        'This does not read as a table — fewer than three columns could be identified. It is ' +
        'usually a PDF, an image, or the body of a forwarded email with the attachment missing.',
    };
  }

  const candidates = parsersFor(aggregatorCode, parsers);
  if (candidates.length === 0) {
    return {
      rung: 'manual_review',
      reason: `No parser is registered for ${aggregatorCode} yet.`,
    };
  }

  const drift = detectDrift(sheet.headers, knownFormats(candidates));

  if (drift.parserKey !== null) {
    const parser = parserByKey(drift.parserKey, candidates);
    if (parser) return { rung: 'deterministic', parser, drift };
  }

  return { rung: 'extraction', drift };
}

export interface ParseAttempt {
  readonly route: Route;
  readonly output: ParseOutput | null;
  readonly error: string | null;
}

/**
 * Run the ladder.
 *
 * A parser that throws is caught and reported rather than propagated: one
 * malformed statement must not fail a batch of thirty. The failure lands in the
 * review queue, where a human sees it — which is the point. Failures are not
 * hidden behind a spinner.
 */
export function parseDocument(
  content: string,
  aggregatorCode: AggregatorCode,
  context: ParserContext,
  parsers: readonly Parser[] = ALL_PARSERS,
): ParseAttempt {
  const chosen = route(content, aggregatorCode, parsers);

  if (chosen.rung !== 'deterministic') {
    return { route: chosen, output: null, error: null };
  }

  try {
    return { route: chosen, output: chosen.parser.parse(content, context), error: null };
  } catch (error) {
    return {
      route: chosen,
      output: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
