import { describe, expect, it } from 'vitest';
import {
  EXTRACTION_SYSTEM_PROMPT,
  HallucinationError,
  assertGrounded,
  checkGrounding,
  extractionSchema,
  type Extraction,
} from './llm.js';

const RAW_ROWS = [
  { _row_index: '0', 'Order ID': 'Order ID', Type: 'Type', Amount: 'Amount' },
  { _row_index: '1', 'Order ID': 'TLB1001', Type: 'Commission', Amount: '25.00' },
  { _row_index: '2', 'Order ID': 'TLB1002', Type: 'Commission', Amount: '1,234.50' },
];

function extraction(overrides: Partial<Extraction> = {}): Extraction {
  return {
    documentKind: 'payout_statement',
    externalPayoutId: null,
    periodStart: null,
    periodEnd: null,
    paidOn: null,
    unreadable: [],
    lines: [
      {
        sourceRowIndex: 1,
        externalOrderId: { value: 'TLB1001', sourceText: 'TLB1001', confidence: 0.99 },
        lineType: 'commission',
        lineTypeSourceText: 'Commission',
        amount: { value: '25.00', sourceText: '25.00', confidence: 0.99 },
        description: null,
      },
    ],
    ...overrides,
  };
}

describe('the extraction schema', () => {
  it('accepts a well-formed extraction', () => {
    expect(() => extractionSchema.parse(extraction())).not.toThrow();
  });

  it('rejects a line type outside the canonical set', () => {
    const bad = { ...extraction() };
    (bad.lines[0] as { lineType: string }).lineType = 'mystery_fee';
    expect(() => extractionSchema.parse(bad)).toThrow();
  });

  it('requires a source text on every value', () => {
    const bad = { ...extraction() };
    delete (bad.lines[0]!.amount as { sourceText?: string }).sourceText;
    expect(() => extractionSchema.parse(bad)).toThrow();
  });
});

describe('grounding', () => {
  it('accepts values that appear verbatim in the row they cite', () => {
    expect(checkGrounding(extraction(), RAW_ROWS)).toEqual([]);
    expect(() => assertGrounded(extraction(), RAW_ROWS)).not.toThrow();
  });

  it('accepts a thousands separator, which is formatting rather than invention', () => {
    const result = extraction({
      lines: [
        {
          sourceRowIndex: 2,
          externalOrderId: null,
          lineType: 'commission',
          lineTypeSourceText: 'Commission',
          amount: { value: '1,234.50', sourceText: '1,234.50', confidence: 0.98 },
          description: null,
        },
      ],
    });
    expect(checkGrounding(result, RAW_ROWS)).toEqual([]);
  });

  it('rejects a value the model changed after reading a real cell', () => {
    // The dangerous case: a real citation with an altered number. Plausible,
    // well-cited, and wrong.
    const result = extraction({
      lines: [
        {
          sourceRowIndex: 1,
          externalOrderId: null,
          lineType: 'commission',
          lineTypeSourceText: 'Commission',
          amount: { value: '35.00', sourceText: '25.00', confidence: 0.99 },
          description: null,
        },
      ],
    });

    const issues = checkGrounding(result, RAW_ROWS);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.reason).toBe('value_not_in_source_text');
    expect(() => assertGrounded(result, RAW_ROWS)).toThrow(HallucinationError);
  });

  it('rejects an invented citation', () => {
    const result = extraction({
      lines: [
        {
          sourceRowIndex: 1,
          externalOrderId: null,
          lineType: 'commission',
          lineTypeSourceText: 'Commission',
          amount: { value: '99.00', sourceText: '99.00', confidence: 0.99 },
          description: null,
        },
      ],
    });

    const issues = checkGrounding(result, RAW_ROWS);
    expect(issues[0]!.reason).toBe('source_text_not_in_row');
  });

  it('rejects a citation pointing at a row that does not exist', () => {
    const result = extraction({
      lines: [
        {
          sourceRowIndex: 99,
          externalOrderId: null,
          lineType: 'commission',
          lineTypeSourceText: 'Commission',
          amount: { value: '25.00', sourceText: '25.00', confidence: 0.99 },
          description: null,
        },
      ],
    });
    expect(checkGrounding(result, RAW_ROWS)[0]!.reason).toBe('row_out_of_range');
  });

  it('rejects a value cited from the wrong row', () => {
    // 25.00 is real, but it is not in row 2.
    const result = extraction({
      lines: [
        {
          sourceRowIndex: 2,
          externalOrderId: null,
          lineType: 'commission',
          lineTypeSourceText: 'Commission',
          amount: { value: '25.00', sourceText: '25.00', confidence: 0.99 },
          description: null,
        },
      ],
    });
    expect(checkGrounding(result, RAW_ROWS)).toHaveLength(1);
  });

  it('rejects a line type classified from words not in the row', () => {
    const result = extraction({
      lines: [
        {
          sourceRowIndex: 1,
          externalOrderId: null,
          lineType: 'chargeback',
          lineTypeSourceText: 'Customer Chargeback',
          amount: { value: '25.00', sourceText: '25.00', confidence: 0.99 },
          description: null,
        },
      ],
    });
    const issues = checkGrounding(result, RAW_ROWS);
    expect(issues.some((issue) => issue.path.endsWith('.lineType'))).toBe(true);
  });

  it('grounds document-level fields against the whole document', () => {
    const withPeriod = extraction({
      periodStart: { value: 'TLB1001', sourceText: 'TLB1001', confidence: 0.9 },
    });
    expect(checkGrounding(withPeriod, RAW_ROWS)).toEqual([]);

    const invented = extraction({
      periodStart: { value: '01/01/1999', sourceText: '01/01/1999', confidence: 0.9 },
    });
    expect(checkGrounding(invented, RAW_ROWS)).toHaveLength(1);
  });
});

describe('the prompt', () => {
  it('forbids computation explicitly', () => {
    // The deterministic-core rule has to be stated to the model as well as
    // enforced around it.
    expect(EXTRACTION_SYSTEM_PROMPT).toContain('Never compute anything');
    expect(EXTRACTION_SYSTEM_PROMPT).toContain('locator, not a calculator');
    expect(EXTRACTION_SYSTEM_PROMPT).toContain('An omission is safe; a guess is not');
  });
});
