import { describe, expect, it } from 'vitest';
import {
  AMBER_THRESHOLD,
  evaluateExportGate,
  flagFor,
  isTouched,
  normalisedEditDistance,
  type ReviewableField,
} from './confidence.js';

const field = (over: Partial<ReviewableField> = {}): ReviewableField => ({
  value: 'Rising damp to the north elevation',
  confidence: 0.9,
  required: false,
  editedByHuman: false,
  reviewedAt: null,
  ...over,
});

describe('flagFor', () => {
  it('marks a high-confidence populated field green', () => {
    expect(flagFor(field())).toBe('green');
  });

  it('marks anything below the amber threshold amber', () => {
    expect(flagFor(field({ confidence: AMBER_THRESHOLD - 0.01 }))).toBe('amber');
  });

  it('suppresses values the model was barely confident about', () => {
    expect(flagFor(field({ confidence: 0.2 }))).toBe('empty');
  });

  it('treats a null value as empty regardless of confidence', () => {
    expect(flagFor(field({ value: null, confidence: 1 }))).toBe('empty');
  });
});

describe('isTouched', () => {
  it('counts an edit as touched', () => {
    expect(isTouched(field({ editedByHuman: true }))).toBe(true);
  });

  it('counts an explicit review as touched', () => {
    expect(isTouched(field({ reviewedAt: new Date() }))).toBe(true);
  });

  it('does not count an untouched field', () => {
    expect(isTouched(field())).toBe(false);
  });
});

describe('evaluateExportGate', () => {
  it('allows export when every field is green', () => {
    expect(evaluateExportGate([field(), field()]).canExport).toBe(true);
  });

  it('blocks export while an amber field is untouched', () => {
    const gate = evaluateExportGate([field({ confidence: 0.5 })]);
    expect(gate.canExport).toBe(false);
    expect(gate.untouchedAmberCount).toBe(1);
    expect(gate.reasons[0]).toMatch(/not yet reviewed/);
  });

  it('unblocks once the amber field has been touched', () => {
    const gate = evaluateExportGate([field({ confidence: 0.5, editedByHuman: true })]);
    expect(gate.canExport).toBe(true);
  });

  it('blocks export on an empty required field even at full confidence', () => {
    const gate = evaluateExportGate([field({ value: null, required: true })]);
    expect(gate.canExport).toBe(false);
    expect(gate.missingRequiredCount).toBe(1);
  });

  it('reports both blockers at once', () => {
    const gate = evaluateExportGate([
      field({ confidence: 0.4 }),
      field({ value: '', required: true }),
    ]);
    expect(gate.reasons).toHaveLength(2);
  });
});

describe('normalisedEditDistance', () => {
  it('is zero for identical strings', () => {
    expect(normalisedEditDistance('damp', 'damp')).toBe(0);
  });

  it('is one when nothing is shared', () => {
    expect(normalisedEditDistance('abc', 'xyz')).toBe(1);
  });

  it('scales with the size of the edit', () => {
    const small = normalisedEditDistance('rising damp', 'rising damps');
    const large = normalisedEditDistance('rising damp', 'penetrating damp to gable');
    expect(small).toBeLessThan(large);
  });

  it('handles an empty side', () => {
    expect(normalisedEditDistance('', 'anything')).toBe(1);
  });
});
