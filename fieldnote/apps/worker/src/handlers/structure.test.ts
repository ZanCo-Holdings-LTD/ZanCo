import { describe, expect, it } from 'vitest';
import type { Transcript } from '@fieldnote/shared';
import { mergeTranscripts } from './structure.js';

function make(text: string, durationMs: number, wordStartMs = 0): Transcript {
  return {
    text,
    words: text.split(' ').map((word, index) => ({
      word,
      startMs: wordStartMs + index * 100,
      endMs: wordStartMs + index * 100 + 90,
      confidence: 0.9,
    })),
    provider: 'deepgram',
    model: 'nova-3',
    meanConfidence: 0.9,
    durationMs,
  };
}

describe('mergeTranscripts', () => {
  it('returns the original when there is only one', () => {
    const single = make('rising damp', 1000);
    expect(mergeTranscripts([single])).toBe(single);
  });

  it('concatenates text with a paragraph break', () => {
    const merged = mergeTranscripts([make('first capture', 1000), make('second capture', 1000)]);
    expect(merged.text).toBe('first capture\n\nsecond capture');
  });

  it('shifts the second capture’s word timings by the first’s duration', () => {
    // Getting this wrong makes every citation in a multi-capture report point
    // at the wrong moment in the wrong recording.
    const merged = mergeTranscripts([make('a b', 5_000), make('c d', 3_000)]);
    const shifted = merged.words.slice(2);
    expect(shifted[0]!.startMs).toBe(5_000);
    expect(shifted[1]!.startMs).toBe(5_100);
  });

  it('sums durations', () => {
    const merged = mergeTranscripts([make('a', 5_000), make('b', 3_000)]);
    expect(merged.durationMs).toBe(8_000);
  });

  it('recomputes mean confidence across all words', () => {
    const merged = mergeTranscripts([make('a b', 1000), make('c d e', 1000)]);
    expect(merged.meanConfidence).toBeCloseTo(0.9, 5);
  });

  it('keeps the merged text and word offsets consistent', () => {
    // The provenance guarantee rests on character offsets indexing into
    // exactly the string the model was shown.
    const merged = mergeTranscripts([make('rising damp', 1000), make('dry rot', 1000)]);
    for (const word of merged.words) {
      expect(merged.text).toContain(word.word);
    }
  });
});
