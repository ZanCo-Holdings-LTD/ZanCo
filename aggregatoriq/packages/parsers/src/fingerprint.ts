/**
 * Header fingerprinting and format drift detection.
 *
 * Aggregators change their export formats without notice. When that happens the
 * dangerous outcome is not a crash — a crash is fine, someone looks at it. The
 * dangerous outcome is a column being renamed and a parser silently reading zero
 * where a commission used to be, producing a reconciliation that says everything
 * is fine.
 *
 * So every document is fingerprinted on its header row. A fingerprint we have
 * seen before takes the deterministic path. An unrecognised one raises an alert
 * and routes to the LLM path — never to a "closest match" parser, because a
 * parser that half-fits is exactly how the silent-wrong-number failure happens.
 */
import { createHash } from 'node:crypto';

/**
 * Normalise a header before hashing.
 *
 * Case, punctuation, whitespace and a trailing currency hint are cosmetic and
 * change between exports of the same format. Column *order* is significant and
 * is preserved — a format that reorders its columns is a format that needs
 * re-checking.
 */
export function normaliseHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function fingerprintHeaders(headers: readonly string[]): string {
  const normalised = headers
    .map(normaliseHeader)
    .filter((header) => header !== '');

  return createHash('sha256').update(normalised.join('|'), 'utf8').digest('hex').slice(0, 32);
}

/**
 * An order-insensitive fingerprint.
 *
 * Used only to tell "they reordered the columns" apart from "they changed the
 * columns" in the drift alert. It is never used to select a parser.
 */
export function fingerprintHeaderSet(headers: readonly string[]): string {
  const normalised = headers
    .map(normaliseHeader)
    .filter((header) => header !== '')
    .sort();

  return createHash('sha256').update(normalised.join('|'), 'utf8').digest('hex').slice(0, 32);
}

export type DriftKind = 'known' | 'reordered' | 'columns_added' | 'columns_removed' | 'unknown';

export interface KnownFormat {
  readonly parserKey: string;
  readonly fingerprint: string;
  readonly setFingerprint: string;
  readonly headers: readonly string[];
}

export interface DriftReport {
  readonly kind: DriftKind;
  readonly fingerprint: string;
  /** The parser to use, or `null` when nothing matches and the LLM path applies. */
  readonly parserKey: string | null;
  readonly addedHeaders: readonly string[];
  readonly removedHeaders: readonly string[];
  /** Whether a human should be told now rather than at the next reconciliation. */
  readonly shouldAlert: boolean;
  readonly message: string;
}

/**
 * Compare an incoming document's headers against the formats we know.
 *
 * The important case is `columns_added`. A new column is usually harmless, and
 * it is tempting to carry on with the existing parser. This does carry on — the
 * exact fingerprint still fails, so the caller must decide — but it alerts,
 * because a new column is often the visible half of a change that also altered
 * what an existing column means.
 */
export function detectDrift(
  headers: readonly string[],
  known: readonly KnownFormat[],
): DriftReport {
  const fingerprint = fingerprintHeaders(headers);
  const setFingerprint = fingerprintHeaderSet(headers);

  const exact = known.find((format) => format.fingerprint === fingerprint);
  if (exact) {
    return {
      kind: 'known',
      fingerprint,
      parserKey: exact.parserKey,
      addedHeaders: [],
      removedHeaders: [],
      shouldAlert: false,
      message: `Recognised as ${exact.parserKey}.`,
    };
  }

  const reordered = known.find((format) => format.setFingerprint === setFingerprint);
  if (reordered) {
    return {
      kind: 'reordered',
      fingerprint,
      parserKey: reordered.parserKey,
      addedHeaders: [],
      removedHeaders: [],
      shouldAlert: true,
      message:
        `Same columns as ${reordered.parserKey} but in a different order. The parser reads by ` +
        `column name so this is safe, but the format changed and that is worth knowing.`,
    };
  }

  const incoming = new Set(headers.map(normaliseHeader).filter((header) => header !== ''));

  let closest: KnownFormat | null = null;
  let closestOverlap = 0;
  for (const format of known) {
    const formatHeaders = new Set(format.headers.map(normaliseHeader));
    const overlap = [...incoming].filter((header) => formatHeaders.has(header)).length;
    if (overlap > closestOverlap) {
      closestOverlap = overlap;
      closest = format;
    }
  }

  if (closest === null || closestOverlap === 0) {
    return {
      kind: 'unknown',
      fingerprint,
      parserKey: null,
      addedHeaders: [...incoming].sort(),
      removedHeaders: [],
      shouldAlert: true,
      message:
        'No known format matches these headers. Routing to schema-guided extraction and ' +
        'flagging for review rather than guessing at a parser.',
    };
  }

  const closestHeaders = new Set(closest.headers.map(normaliseHeader));
  const added = [...incoming].filter((header) => !closestHeaders.has(header)).sort();
  const removed = [...closestHeaders].filter((header) => !incoming.has(header)).sort();

  const kind: DriftKind = removed.length > 0 ? 'columns_removed' : 'columns_added';

  return {
    kind,
    fingerprint,
    // Deliberately null: a partly-matching parser is how a renamed column
    // silently becomes a zero.
    parserKey: null,
    addedHeaders: added,
    removedHeaders: removed,
    shouldAlert: true,
    message:
      `Closest known format is ${closest.parserKey}, but ` +
      `${added.length} column(s) were added and ${removed.length} removed. ` +
      `Not using that parser — a partial match is how a renamed column silently becomes a zero. ` +
      `Routing to schema-guided extraction and flagging for review.`,
  };
}
