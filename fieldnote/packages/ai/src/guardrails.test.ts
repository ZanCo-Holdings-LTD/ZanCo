import { describe, expect, it } from 'vitest';
import type { TemplateSectionDef, Transcript } from '@fieldnote/shared';
import { discardUngrounded, groundSection, resolveSpan } from './guardrails.js';
import type { RawFieldEntry } from './schema.js';

const TEXT =
  'The north elevation shows rising damp to approximately one metre. ' +
  'I found no evidence of dry rot in the sub-floor timbers. ' +
  'Moisture readings were around 22 percent at skirting level.';

const transcript: Transcript = {
  text: TEXT,
  words: TEXT.split(' ').map((word, index) => ({
    word,
    startMs: index * 400,
    endMs: index * 400 + 350,
    confidence: 0.95,
  })),
  provider: 'deepgram',
  model: 'nova-3',
  meanConfidence: 0.95,
  durationMs: 20_000,
};

const CAPTURE = '00000000-0000-4000-8000-000000000001';

const section: TemplateSectionDef = {
  id: '00000000-0000-4000-8000-0000000000aa',
  key: 'internal_damp',
  title: 'Internal dampness',
  guidance: null,
  orderIndex: 0,
  fields: [
    {
      id: '00000000-0000-4000-8000-0000000000b1',
      key: 'affected_areas',
      label: 'Areas affected',
      type: 'long_text',
      required: true,
      enumValues: null,
      extractionHint: null,
      orderIndex: 0,
    },
    {
      id: '00000000-0000-4000-8000-0000000000b2',
      key: 'damp_type',
      label: 'Type of dampness',
      type: 'enum',
      required: true,
      enumValues: ['Rising damp', 'Penetrating damp', 'Condensation'],
      extractionHint: null,
      orderIndex: 1,
    },
    {
      id: '00000000-0000-4000-8000-0000000000b3',
      key: 'relative_humidity',
      label: 'Relative humidity',
      type: 'number',
      required: false,
      enumValues: null,
      extractionHint: null,
      orderIndex: 2,
    },
  ],
};

/** Build a span the model might return for a real substring. */
function spanFor(quote: string) {
  const charStart = TEXT.indexOf(quote);
  return { charStart, charEnd: charStart + quote.length, quote };
}

describe('resolveSpan', () => {
  it('accepts a span whose offsets and quote both match', () => {
    const span = resolveSpan(transcript, CAPTURE, spanFor('rising damp'));
    expect(span).not.toBeNull();
    expect(span!.quote).toBe('rising damp');
    expect(span!.charRange[0]).toBe(TEXT.indexOf('rising damp'));
  });

  it('repairs offsets when the quoted words are real but mislocated', () => {
    // The model quoted genuine transcript text but miscounted the offsets.
    const span = resolveSpan(transcript, CAPTURE, {
      charStart: 0,
      charEnd: 11,
      quote: 'rising damp',
    });
    expect(span).not.toBeNull();
    expect(span!.charRange[0]).toBe(TEXT.indexOf('rising damp'));
  });

  it('rejects a quote that appears nowhere in the transcript', () => {
    // This is the fabrication case the whole stage exists to catch.
    const span = resolveSpan(transcript, CAPTURE, {
      charStart: 0,
      charEnd: 30,
      quote: 'extensive dry rot throughout the property',
    });
    expect(span).toBeNull();
  });

  it('rejects an out-of-bounds range with an unfindable quote', () => {
    const span = resolveSpan(transcript, CAPTURE, {
      charStart: 9_000,
      charEnd: 9_100,
      quote: 'asbestos insulating board',
    });
    expect(span).toBeNull();
  });

  it('rejects an empty quote', () => {
    const span = resolveSpan(transcript, CAPTURE, { charStart: 0, charEnd: 0, quote: '   ' });
    expect(span).toBeNull();
  });

  it('tolerates smart quotes and collapsed whitespace', () => {
    const span = resolveSpan(transcript, CAPTURE, {
      charStart: 0,
      charEnd: 0,
      quote: 'rising  damp   to approximately one metre',
    });
    expect(span).not.toBeNull();
  });

  it('stores the transcript text, not the model’s rendering of it', () => {
    const span = resolveSpan(transcript, CAPTURE, {
      charStart: 0,
      charEnd: 0,
      quote: 'RISING DAMP',
    });
    expect(span!.quote).toBe('rising damp');
  });

  it('resolves audio timestamps for the span', () => {
    const span = resolveSpan(transcript, CAPTURE, spanFor('rising damp'));
    expect(span!.endMs).toBeGreaterThan(span!.startMs);
  });
});

describe('groundSection', () => {
  const entry = (over: Partial<RawFieldEntry>): RawFieldEntry => ({
    fieldKey: 'affected_areas',
    value: 'North elevation, rising damp to approximately one metre',
    confidence: 0.9,
    sourceSpan: spanFor('rising damp to approximately one metre'),
    ...over,
  });

  it('keeps a well-cited value', () => {
    const result = groundSection(section, [entry({})], transcript, CAPTURE);
    expect(result.failedFieldKeys).toHaveLength(0);
    const field = result.grounded.find((f) => f.fieldKey === 'affected_areas');
    expect(field?.sourceSpan).not.toBeNull();
  });

  it('fails a value with no citation at all', () => {
    const result = groundSection(section, [entry({ sourceSpan: null })], transcript, CAPTURE);
    expect(result.failedFieldKeys).toContain('affected_areas');
  });

  it('fails a value whose citation is fabricated', () => {
    const result = groundSection(
      section,
      [entry({ sourceSpan: { charStart: 0, charEnd: 10, quote: 'asbestos present throughout' } })],
      transcript,
      CAPTURE,
    );
    expect(result.failedFieldKeys).toContain('affected_areas');
  });

  it('accepts a null value without requiring a citation', () => {
    const result = groundSection(
      section,
      [entry({ value: null, confidence: 0, sourceSpan: null })],
      transcript,
      CAPTURE,
    );
    expect(result.failedFieldKeys).toHaveLength(0);
    expect(result.grounded.find((f) => f.fieldKey === 'affected_areas')?.value).toBeNull();
  });

  it('returns a null for a field the model omitted entirely', () => {
    const result = groundSection(section, [], transcript, CAPTURE);
    expect(result.grounded).toHaveLength(section.fields.length);
    expect(result.grounded.every((field) => field.value === null)).toBe(true);
  });

  it('nulls an enum value outside the allowed set', () => {
    // A paraphrased classification in a compliance report is a wrong one.
    const result = groundSection(
      section,
      [
        entry({
          fieldKey: 'damp_type',
          value: 'Damp from below',
          sourceSpan: spanFor('rising damp'),
        }),
      ],
      transcript,
      CAPTURE,
    );
    expect(result.grounded.find((f) => f.fieldKey === 'damp_type')?.value).toBeNull();
  });

  it('keeps an enum value that is in the allowed set', () => {
    const result = groundSection(
      section,
      [entry({ fieldKey: 'damp_type', value: 'Rising damp', sourceSpan: spanFor('rising damp') })],
      transcript,
      CAPTURE,
    );
    expect(result.grounded.find((f) => f.fieldKey === 'damp_type')?.value).toBe('Rising damp');
  });

  it('clamps a confidence outside [0, 1]', () => {
    const result = groundSection(section, [entry({ confidence: 4.2 })], transcript, CAPTURE);
    expect(result.grounded.find((f) => f.fieldKey === 'affected_areas')?.confidence).toBe(1);
  });

  it('coerces a numeric string into a number', () => {
    const result = groundSection(
      section,
      [
        entry({
          fieldKey: 'relative_humidity',
          value: '22' as unknown as number,
          sourceSpan: spanFor('22 percent'),
        }),
      ],
      transcript,
      CAPTURE,
    );
    expect(result.grounded.find((f) => f.fieldKey === 'relative_humidity')?.value).toBe(22);
  });
});

describe('discardUngrounded', () => {
  it('turns a still-failing field into an explicit null rather than dropping it', () => {
    // The reviewer must see an empty row where a finding might belong.
    const fields = discardUngrounded(
      [{ fieldKey: 'damp_type', value: 'Rising damp', confidence: 0.9, sourceSpan: null }],
      ['affected_areas'],
    );
    const discarded = fields.find((field) => field.fieldKey === 'affected_areas');
    expect(discarded).toBeDefined();
    expect(discarded!.value).toBeNull();
    expect(discarded!.confidence).toBe(0);
  });

  it('does not duplicate a field that the retry recovered', () => {
    const fields = discardUngrounded(
      [{ fieldKey: 'affected_areas', value: 'North wall', confidence: 0.8, sourceSpan: null }],
      ['affected_areas'],
    );
    expect(fields.filter((field) => field.fieldKey === 'affected_areas')).toHaveLength(1);
  });
});
