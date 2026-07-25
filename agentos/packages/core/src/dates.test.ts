import { describe, expect, it } from 'vitest';
import {
  addDays,
  daysBetween,
  daysUntil,
  isPlainDate,
  isWithin,
  maxDate,
  minDate,
  parseLooseDate,
  subDays,
  toPlainDate,
} from './dates.js';

describe('isPlainDate', () => {
  it('accepts real calendar dates', () => {
    expect(isPlainDate('2026-03-14')).toBe(true);
    expect(isPlainDate('2024-02-29')).toBe(true);
  });

  it('rejects dates that do not exist', () => {
    expect(isPlainDate('2025-02-29')).toBe(false);
    expect(isPlainDate('2025-04-31')).toBe(false);
    expect(isPlainDate('2025-13-01')).toBe(false);
    expect(isPlainDate('2025-00-10')).toBe(false);
  });

  it('rejects anything that is not the exact format', () => {
    expect(isPlainDate('2025-3-14')).toBe(false);
    expect(isPlainDate('14/03/2025')).toBe(false);
    expect(isPlainDate('')).toBe(false);
    expect(isPlainDate(20250314)).toBe(false);
  });
});

describe('date arithmetic', () => {
  it('adds and subtracts across month and year boundaries', () => {
    expect(addDays('2025-12-31', 1)).toBe('2026-01-01');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2025-02-28', 1)).toBe('2025-03-01');
    expect(subDays('2026-01-01', 1)).toBe('2025-12-31');
  });

  it('counts whole days between dates', () => {
    expect(daysBetween('2025-01-01', '2025-01-31')).toBe(30);
    expect(daysBetween('2025-01-31', '2025-01-01')).toBe(-30);
    expect(daysBetween('2024-01-01', '2025-01-01')).toBe(366);
  });

  it('is unaffected by the DST transitions that would break local-time maths', () => {
    // Europe/London springs forward on 2025-03-30 and falls back on 2025-10-26.
    // A naive `new Date(...)` + 24h would drift an hour and land on the wrong day.
    expect(addDays('2025-03-29', 1)).toBe('2025-03-30');
    expect(addDays('2025-03-30', 1)).toBe('2025-03-31');
    expect(daysBetween('2025-03-29', '2025-03-31')).toBe(2);
    expect(addDays('2025-10-25', 1)).toBe('2025-10-26');
    expect(daysBetween('2025-10-25', '2025-10-27')).toBe(2);
  });

  it('reports days until a date relative to a supplied today', () => {
    expect(daysUntil('2025-06-30', '2025-06-01')).toBe(29);
    expect(daysUntil('2025-05-30', '2025-06-01')).toBe(-2);
  });

  it('orders and bounds dates', () => {
    expect(minDate('2025-06-01', '2025-01-01', '2025-12-01')).toBe('2025-01-01');
    expect(maxDate('2025-06-01', '2025-01-01', '2025-12-01')).toBe('2025-12-01');
    expect(isWithin('2025-06-01', '2025-01-01', '2025-12-01')).toBe(true);
    expect(isWithin('2025-01-01', '2025-01-01', '2025-12-01')).toBe(true);
    expect(isWithin('2024-12-31', '2025-01-01', '2025-12-01')).toBe(false);
  });

  it('converts an instant to the UTC calendar date it falls on', () => {
    expect(toPlainDate(new Date('2025-06-01T23:30:00Z'))).toBe('2025-06-01');
    expect(toPlainDate(new Date('2025-06-01T00:30:00Z'))).toBe('2025-06-01');
  });
});

describe('parseLooseDate', () => {
  it('reads the formats that arrive from spreadsheets', () => {
    expect(parseLooseDate('2026-03-14')).toBe('2026-03-14');
    expect(parseLooseDate('14/03/2026')).toBe('2026-03-14');
    expect(parseLooseDate('14-03-2026')).toBe('2026-03-14');
    expect(parseLooseDate('14.03.2026')).toBe('2026-03-14');
    expect(parseLooseDate('2026/03/14')).toBe('2026-03-14');
    expect(parseLooseDate('14 Mar 2026')).toBe('2026-03-14');
    expect(parseLooseDate('14 March 2026')).toBe('2026-03-14');
    expect(parseLooseDate('  2026-03-14  ')).toBe('2026-03-14');
  });

  it('reads day-first, never month-first', () => {
    // 03/04/2026 is 3 April in Gulf paperwork. Reading it as 4 March would put
    // a renewal a month early or a month late depending on which way it went.
    expect(parseLooseDate('03/04/2026')).toBe('2026-04-03');
  });

  it('returns null rather than guessing', () => {
    expect(parseLooseDate('')).toBeNull();
    expect(parseLooseDate('next March')).toBeNull();
    expect(parseLooseDate('31/02/2026')).toBeNull();
    expect(parseLooseDate('14/03/26')).toBeNull();
    expect(parseLooseDate('N/A')).toBeNull();
    expect(parseLooseDate('14 Foo 2026')).toBeNull();
  });
});
