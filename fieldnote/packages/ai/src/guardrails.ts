import type { GeneratedField, SourceSpan, TemplateSectionDef, Transcript } from '@fieldnote/shared';
import { charRangeToTimestamps } from './deepgram.js';
import type { RawFieldEntry, RawSourceSpan } from './schema.js';

/**
 * Stage 3: grounding.
 *
 * Every non-null value must resolve to real text in the transcript. A value
 * whose span does not resolve is rejected; the caller retries once with the
 * failures named, and anything still ungrounded is discarded — returned null
 * with confidence 0 rather than kept as a guess.
 *
 * This is the control that makes the product defensible. A missing field costs
 * a reviewer fifteen seconds. A fabricated finding costs a professional their
 * indemnity cover.
 */

export interface GroundingResult {
  grounded: GeneratedField[];
  /** Field keys whose span did not resolve. Fed into the retry instruction. */
  failedFieldKeys: string[];
}

/**
 * Whitespace and quote-style differences between the transcript and the model's
 * quote are not evidence of fabrication — smart quotes and collapsed newlines
 * are formatting noise. Normalise both sides before comparing.
 */
function normalise(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Resolve one claimed span against the transcript.
 *
 * Returns null when the span cannot be trusted. The offsets are checked first
 * and the quote second, because a model that miscounts by a few characters but
 * quotes real words is recoverable — we relocate the quote — whereas a quote
 * that appears nowhere in the transcript is not.
 */
export function resolveSpan(
  transcript: Transcript,
  captureId: string,
  claimed: RawSourceSpan,
): SourceSpan | null {
  const { text } = transcript;
  const quote = claimed.quote?.trim();
  if (!quote) return null;

  let start = claimed.charStart;
  let end = claimed.charEnd;

  const withinBounds =
    Number.isInteger(start) &&
    Number.isInteger(end) &&
    start >= 0 &&
    end <= text.length &&
    start < end;

  const selected = withinBounds ? text.slice(start, end) : '';

  if (!withinBounds || normalise(selected) !== normalise(quote)) {
    // The offsets are wrong. If the quoted words genuinely appear in the
    // transcript, trust the words and repair the offsets; otherwise reject.
    const located = locateQuote(text, quote);
    if (!located) return null;
    start = located.start;
    end = located.end;
  }

  const timestamps = charRangeToTimestamps(transcript, start, end);

  return {
    captureId,
    startMs: timestamps?.startMs ?? 0,
    endMs: timestamps?.endMs ?? 0,
    charRange: [start, end],
    // Store the transcript's own text, not the model's rendering of it.
    quote: text.slice(start, end),
  };
}

/** Find a quote in the transcript, tolerating whitespace and quote-mark drift. */
function locateQuote(text: string, quote: string): { start: number; end: number } | null {
  const direct = text.indexOf(quote);
  if (direct !== -1) return { start: direct, end: direct + quote.length };

  // Fall back to a normalised scan. Build an index mapping normalised offsets
  // back to original ones so the stored span still points at real characters.
  const map: number[] = [];
  let normalisedText = '';
  let lastWasSpace = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    const isSpace = /\s/.test(char);
    if (isSpace) {
      if (lastWasSpace || normalisedText.length === 0) continue;
      normalisedText += ' ';
      map.push(i);
      lastWasSpace = true;
      continue;
    }
    lastWasSpace = false;
    normalisedText += foldChar(char);
    map.push(i);
  }

  const needle = normalise(quote);
  const index = normalisedText.toLowerCase().indexOf(needle);
  if (index === -1) return null;

  const start = map[index];
  const endMapped = map[Math.min(index + needle.length, map.length - 1)];
  if (start === undefined || endMapped === undefined) return null;

  return { start, end: Math.min(endMapped + 1, text.length) };
}

function foldChar(char: string): string {
  if (char === '‘' || char === '’') return "'";
  if (char === '“' || char === '”') return '"';
  if (char === '–' || char === '—') return '-';
  return char;
}

/**
 * Apply the guardrail to one section's raw model output.
 *
 * A null value needs no span — "not stated" is the answer we want and asking
 * the model to cite an absence would be incoherent. Everything else must cite.
 */
export function groundSection(
  section: TemplateSectionDef,
  raw: RawFieldEntry[],
  transcript: Transcript,
  captureId: string,
): GroundingResult {
  const byKey = new Map(raw.map((entry) => [entry.fieldKey, entry]));
  const grounded: GeneratedField[] = [];
  const failedFieldKeys: string[] = [];

  for (const field of section.fields) {
    const entry = byKey.get(field.key);

    // The model omitted the field entirely. Treat as not stated.
    if (!entry) {
      grounded.push({ fieldKey: field.key, value: null, confidence: 0, sourceSpan: null });
      continue;
    }

    if (entry.value === null || entry.value === undefined) {
      grounded.push({ fieldKey: field.key, value: null, confidence: 0, sourceSpan: null });
      continue;
    }

    if (!entry.sourceSpan) {
      // A value with no citation at all is the exact failure mode this stage
      // exists to catch.
      failedFieldKeys.push(field.key);
      continue;
    }

    const span = resolveSpan(transcript, captureId, entry.sourceSpan);
    if (!span) {
      failedFieldKeys.push(field.key);
      continue;
    }

    grounded.push({
      fieldKey: field.key,
      value: coerce(entry.value, field.type, field.enumValues),
      confidence: clamp(entry.confidence),
      sourceSpan: span,
    });
  }

  return { grounded, failedFieldKeys };
}

/**
 * Everything still ungrounded after the retry becomes an explicit null.
 *
 * Returning the field at zero confidence rather than dropping it keeps the
 * report's shape intact: the reviewer sees an empty row where a finding might
 * belong, which is a prompt to check, not a silent omission.
 */
export function discardUngrounded(
  grounded: GeneratedField[],
  failedFieldKeys: string[],
): GeneratedField[] {
  const present = new Set(grounded.map((field) => field.fieldKey));
  const discarded = failedFieldKeys
    .filter((key) => !present.has(key))
    .map<GeneratedField>((fieldKey) => ({
      fieldKey,
      value: null,
      confidence: 0,
      sourceSpan: null,
    }));
  return [...grounded, ...discarded];
}

function clamp(confidence: number): number {
  if (!Number.isFinite(confidence)) return 0;
  return Math.min(1, Math.max(0, confidence));
}

/**
 * Final type coercion.
 *
 * The JSON schema already constrains shape, but enum membership is worth
 * re-checking here: a value outside the allowed set is the model paraphrasing,
 * and in a compliance report a paraphrased classification code is a wrong one.
 */
function coerce(
  value: string | number | boolean | string[] | null,
  type: string,
  enumValues: string[] | null,
): string | number | boolean | string[] | null {
  switch (type) {
    case 'enum':
      return typeof value === 'string' && enumValues?.includes(value) ? value : null;
    case 'multi_enum': {
      if (!Array.isArray(value)) return null;
      const allowed = value.filter((item) => enumValues?.includes(item));
      return allowed.length > 0 ? allowed : null;
    }
    case 'number': {
      const numeric = typeof value === 'number' ? value : Number(value);
      return Number.isFinite(numeric) ? numeric : null;
    }
    case 'boolean':
      return typeof value === 'boolean' ? value : null;
    default:
      return typeof value === 'string' ? value : null;
  }
}
