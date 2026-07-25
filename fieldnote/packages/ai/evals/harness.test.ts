import { describe, expect, it } from 'vitest';
import { aggregate, scoreField, THRESHOLDS } from './harness.js';
import type { GeneratedField } from '@fieldnote/shared';

const field = (value: unknown, sourceSpan: GeneratedField['sourceSpan'] = null): GeneratedField =>
  ({ fieldKey: 'damp_type', value, confidence: 0.9, sourceSpan }) as GeneratedField;

const span = {
  captureId: '00000000-0000-4000-8000-000000000001',
  startMs: 0,
  endMs: 100,
  charRange: [0, 11] as [number, number],
  quote: 'rising damp',
};

describe('scoreField', () => {
  it('counts a value against an empty expectation as a hallucination', () => {
    const outcome = scoreField('f1', 's', { fieldKey: 'damp_type', expected: null }, field('Rising damp', span));
    expect(outcome.hallucinated).toBe(true);
  });

  it('counts a missing value against a real expectation as a miss', () => {
    const outcome = scoreField('f1', 's', { fieldKey: 'damp_type', expected: 'Rising damp' }, field(null));
    expect(outcome.missed).toBe(true);
  });

  it('scores edit distance when both sides are present', () => {
    const outcome = scoreField(
      'f1',
      's',
      { fieldKey: 'damp_type', expected: 'Rising damp to north elevation' },
      field('Rising damp', span),
    );
    expect(outcome.matched).toBe(true);
    expect(outcome.editDistance).toBeGreaterThan(0);
  });

  it('treats an empty array as no value', () => {
    const outcome = scoreField('f1', 's', { fieldKey: 'damp_type', expected: null }, field([]));
    expect(outcome.hallucinated).toBe(false);
  });

  it('flags a produced value carrying no source span', () => {
    const outcome = scoreField(
      'f1',
      's',
      { fieldKey: 'damp_type', expected: 'Rising damp' },
      field('Rising damp', null),
    );
    expect(outcome.groundedSpan).toBe(false);
  });
});

describe('aggregate', () => {
  const clean = [
    scoreField('f1', 's', { fieldKey: 'a', expected: 'Rising damp' }, field('Rising damp', span)),
    scoreField('f1', 's', { fieldKey: 'b', expected: null }, field(null)),
  ];

  it('passes a clean run', () => {
    const report = aggregate(clean, 1);
    expect(report.failures).toHaveLength(0);
    expect(report.hallucinationRate).toBe(0);
  });

  it('hard-fails on a single hallucination', () => {
    const report = aggregate(
      [...clean, scoreField('f1', 's', { fieldKey: 'c', expected: null }, field('Dry rot', span))],
      1,
    );
    expect(report.hallucinationRate).toBeGreaterThan(THRESHOLDS.maxHallucinationRate);
    expect(report.failures.join(' ')).toMatch(/Hallucination rate/);
  });

  it('fails when recall drops below the threshold', () => {
    const missed = Array.from({ length: 10 }, (_, i) =>
      scoreField('f1', 's', { fieldKey: `m${i}`, expected: 'value' }, field(null)),
    );
    const report = aggregate([...clean, ...missed], 1);
    expect(report.recall).toBeLessThan(THRESHOLDS.minRecall);
    expect(report.failures.join(' ')).toMatch(/Recall/);
  });

  it('fails when a value survived without a grounded span', () => {
    const report = aggregate(
      [
        ...clean,
        scoreField('f1', 's', { fieldKey: 'd', expected: 'Rising damp' }, field('Rising damp', null)),
      ],
      1,
    );
    expect(report.ungroundedCount).toBe(1);
    expect(report.failures.join(' ')).toMatch(/guardrail has a hole/);
  });
});
