import { describe, expect, it } from 'vitest';
import {
  CONFIDENCE_THRESHOLD,
  confirmField,
  extractionEnvelopeSchema,
  isPlausibleDocumentDate,
  overallConfidence,
  reviewExtraction,
  reviewField,
  type ExtractionEnvelope,
} from './contract.js';

const TODAY = '2026-01-15';

function envelope(overrides: Partial<ExtractionEnvelope['result']['fields']> = {}, confidence = 0.99): ExtractionEnvelope {
  return {
    modelVersion: 'test-model-1',
    promptVersion: 'extract-v1',
    overallConfidence: confidence,
    result: {
      docType: 'trade_licence',
      docTypeConfidence: 0.99,
      detectedLanguage: 'en',
      notes: null,
      fields: {
        documentNumber: { value: 'DL-123456', confidence: 0.99 },
        issuingAuthority: { value: 'IFZA', confidence: 0.97 },
        issuedOn: { value: '2024-03-15', confidence: 0.98 },
        expiresOn: { value: '2026-03-14', confidence: 0.99 },
        holderName: null,
        legalName: { value: 'Example Trading FZ-LLC', confidence: 0.96 },
        nationality: null,
        ...overrides,
      },
    },
  };
}

describe('extraction contract', () => {
  it('validates a well-formed envelope', () => {
    expect(() => extractionEnvelopeSchema.parse(envelope())).not.toThrow();
  });

  it('rejects a confidence outside 0..1', () => {
    const bad = envelope({ expiresOn: { value: '2026-03-14', confidence: 1.4 } });
    expect(() => extractionEnvelopeSchema.parse(bad)).toThrow();
  });
});

describe('the confirmation rule', () => {
  it('always requires confirmation, however confident the model is', () => {
    const review = reviewExtraction(envelope({}, 1), TODAY);
    expect(review.requiresConfirmation).toBe(true);
    expect(review.fields.every((f) => f.disposition !== ('accept' as never))).toBe(true);
  });

  it('offers a high-confidence field as a suggestion, never as a value', () => {
    const review = reviewField('expiresOn', { value: '2026-03-14', confidence: 0.99 }, TODAY);
    expect(review.disposition).toBe('suggest');
  });

  it('flags a field in the middle band for a closer look', () => {
    const review = reviewField('expiresOn', { value: '2026-03-14', confidence: 0.9 }, TODAY);
    expect(review.disposition).toBe('suggest_flagged');
  });

  it('routes a below-threshold field to manual entry rather than pre-filling it', () => {
    const review = reviewField(
      'expiresOn',
      { value: '2026-03-14', confidence: CONFIDENCE_THRESHOLD - 0.01 },
      TODAY,
    );
    expect(review.disposition).toBe('manual_entry_required');
    expect(review.reasons.join(' ')).toContain('below the');
  });

  it('rejects an implausible date no matter how confident the model was', () => {
    // An OCR slip that turns 2026 into 2062 reads as perfectly confident.
    for (const value of ['2079-03-14', '1988-03-14']) {
      const review = reviewField('expiresOn', { value, confidence: 1 }, TODAY);
      expect(review.disposition).toBe('manual_entry_required');
      expect(review.reasons.join(' ')).toContain('plausible range');
    }
  });

  it('rejects a malformed date', () => {
    const review = reviewField('expiresOn', { value: '14/03/2026', confidence: 1 }, TODAY);
    expect(review.disposition).toBe('manual_entry_required');
  });

  it('marks the whole extraction as needing manual entry when a critical field fails', () => {
    const review = reviewExtraction(
      envelope({ expiresOn: { value: '2026-03-14', confidence: 0.4 } }),
      TODAY,
    );
    expect(review.requiresManualEntry).toBe(true);
  });

  it('does not require manual entry when only a non-critical field is weak', () => {
    const review = reviewExtraction(
      envelope({ issuingAuthority: { value: 'IFZA', confidence: 0.2 } }),
      TODAY,
    );
    expect(review.requiresManualEntry).toBe(false);
  });

  it('treats a missing field as manual entry, not as an empty success', () => {
    const review = reviewField('expiresOn', null, TODAY);
    expect(review.disposition).toBe('manual_entry_required');
    expect(review.value).toBeNull();
  });
});

describe('isPlausibleDocumentDate', () => {
  it('accepts a genuine ten-year passport', () => {
    expect(isPlausibleDocumentDate('2035-01-15', TODAY)).toBe(true);
  });

  it('accepts a document that lapsed a few years ago', () => {
    expect(isPlausibleDocumentDate('2019-01-15', TODAY)).toBe(true);
  });

  it('rejects dates far outside any document lifetime', () => {
    expect(isPlausibleDocumentDate('2099-01-15', TODAY)).toBe(false);
    expect(isPlausibleDocumentDate('1901-01-15', TODAY)).toBe(false);
  });
});

describe('confirmField', () => {
  const review = reviewField('expiresOn', { value: '2026-03-14', confidence: 0.99 }, TODAY);

  it('will not accept a confirmation with no named human behind it', () => {
    expect(confirmField(review, '2026-03-14', null).accepted).toBe(false);
    expect(confirmField(review, '2026-03-14', '  ').accepted).toBe(false);
  });

  it('accepts a confirmation from a named user', () => {
    expect(confirmField(review, '2026-03-14', 'user-1').accepted).toBe(true);
  });

  it('accepts a corrected value that differs from the suggestion', () => {
    const decision = confirmField(review, '2026-03-15', 'user-1');
    expect(decision.accepted).toBe(true);
  });

  it('rejects a corrected value that is not a real date', () => {
    expect(confirmField(review, '14/03/2026', 'user-1').accepted).toBe(false);
    expect(confirmField(review, '', 'user-1').accepted).toBe(false);
  });
});

describe('overallConfidence', () => {
  it('is the weakest of the fields that actually matter', () => {
    const result = envelope({ documentNumber: { value: 'X', confidence: 0.5 } }).result;
    expect(overallConfidence(result)).toBe(0.5);
  });
});
