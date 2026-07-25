import { describe, expect, it } from 'vitest';
import { formatDate, formatTimestamp, formatValue } from './model.js';

describe('formatValue', () => {
  it('renders a boolean as Yes or No', () => {
    expect(formatValue(true, 'boolean', null).text).toBe('Yes');
    expect(formatValue(false, 'boolean', null).text).toBe('No');
  });

  it('marks an absent value as empty rather than hiding it', () => {
    // An omission has to be visible on the page; a silently dropped required
    // field reads as "not a problem" to a client.
    const result = formatValue(null, 'text', null);
    expect(result.isEmpty).toBe(true);
    expect(result.text).toBe('—');
  });

  it('orders multi-enum values by the template’s declared order', () => {
    const options = ['Rising damp', 'Penetrating damp', 'Condensation'];
    const result = formatValue(['Condensation', 'Rising damp'], 'multi_enum', options);
    expect(result.text).toBe('Rising damp, Condensation');
  });

  it('treats an empty multi-enum as empty', () => {
    expect(formatValue([], 'multi_enum', ['A']).isEmpty).toBe(true);
  });

  it('marks long text as prose so it renders as paragraphs', () => {
    expect(formatValue('A long finding.', 'long_text', null).isProse).toBe(true);
  });

  it('does not mark short text as prose', () => {
    expect(formatValue('Victorian', 'text', null).isProse).toBe(false);
  });

  it('keeps a zero as a real value', () => {
    // `0` is falsy but a moisture reading of zero is a finding, not a gap.
    const result = formatValue(0, 'number', null);
    expect(result.isEmpty).toBe(false);
    expect(result.text).toBe('0');
  });
});

describe('formatDate', () => {
  it('renders a UK long date', () => {
    expect(formatDate(new Date('2026-03-14T00:00:00Z'))).toBe('14 March 2026');
  });

  it('returns null for a missing date', () => {
    expect(formatDate(null)).toBeNull();
  });

  it('returns null for an unparseable value', () => {
    expect(formatDate('not a date')).toBeNull();
  });
});

describe('formatTimestamp', () => {
  it('renders minutes and padded seconds', () => {
    expect(formatTimestamp(125_000)).toBe('2:05');
  });

  it('returns null when there is no offset', () => {
    expect(formatTimestamp(null)).toBeNull();
  });
});
