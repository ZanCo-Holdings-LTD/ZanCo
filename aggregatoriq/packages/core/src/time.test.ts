import { describe, expect, it } from 'vitest';
import {
  addDays,
  findCoverageGaps,
  isWithinPeriod,
  localDate,
  minutesBetween,
  parseStatementDate,
  parseStatementInstant,
  period,
  periodLengthDays,
  periodsOverlap,
  zonedTimeToInstant,
} from './time.js';

describe('calendar arithmetic', () => {
  it('crosses month and leap-year boundaries', () => {
    expect(addDays('2025-12-31', 1)).toBe('2026-01-01');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2025-02-28', 1)).toBe('2025-03-01');
    expect(addDays('2025-03-01', -1)).toBe('2025-02-28');
  });

  it('is unaffected by DST, which naive local-time maths would not be', () => {
    expect(addDays('2025-03-29', 1)).toBe('2025-03-30');
    expect(addDays('2025-10-25', 1)).toBe('2025-10-26');
  });
});

describe('periods', () => {
  it('rejects an inverted period rather than reconciling nothing', () => {
    expect(() => period('2025-03-15', '2025-03-01')).toThrow();
  });

  it('is inclusive on both ends, as a statement period is quoted', () => {
    expect(isWithinPeriod('2025-03-01', '2025-03-01', '2025-03-15')).toBe(true);
    expect(isWithinPeriod('2025-03-15', '2025-03-01', '2025-03-15')).toBe(true);
    expect(isWithinPeriod('2025-03-16', '2025-03-01', '2025-03-15')).toBe(false);
    expect(periodLengthDays(period('2025-03-01', '2025-03-15'))).toBe(15);
  });

  it('detects overlap', () => {
    const first = period('2025-03-01', '2025-03-15');
    expect(periodsOverlap(first, period('2025-03-15', '2025-03-31'))).toBe(true);
    expect(periodsOverlap(first, period('2025-03-16', '2025-03-31'))).toBe(false);
  });
});

describe('findCoverageGaps', () => {
  const march = period('2025-03-01', '2025-03-31');

  it('reports the whole period when nothing is covered', () => {
    expect(findCoverageGaps([], march)).toEqual([march]);
  });

  it('reports nothing when fully covered', () => {
    expect(
      findCoverageGaps([period('2025-03-01', '2025-03-15'), period('2025-03-16', '2025-03-31')], march),
    ).toEqual([]);
  });

  it('finds a hole in the middle', () => {
    const gaps = findCoverageGaps(
      [period('2025-03-01', '2025-03-10'), period('2025-03-21', '2025-03-31')],
      march,
    );
    expect(gaps).toEqual([period('2025-03-11', '2025-03-20')]);
  });

  it('finds holes at both ends', () => {
    const gaps = findCoverageGaps([period('2025-03-10', '2025-03-20')], march);
    expect(gaps).toEqual([period('2025-03-01', '2025-03-09'), period('2025-03-21', '2025-03-31')]);
  });

  it('copes with overlapping and out-of-order statements', () => {
    const gaps = findCoverageGaps(
      [
        period('2025-03-16', '2025-03-31'),
        period('2025-03-01', '2025-03-10'),
        period('2025-03-05', '2025-03-12'),
      ],
      march,
    );
    expect(gaps).toEqual([period('2025-03-13', '2025-03-15')]);
  });

  it('ignores statements from other months', () => {
    expect(findCoverageGaps([period('2025-01-01', '2025-01-31')], march)).toEqual([march]);
  });
});

describe('branch-local dates', () => {
  it('assigns a late-evening Dubai order to the right local day', () => {
    // 2025-03-14T21:30Z is 01:30 on the 15th in Dubai. Treating it as the 14th
    // puts it in the wrong statement period.
    expect(localDate(new Date('2025-03-14T21:30:00Z'), 'Asia/Dubai')).toBe('2025-03-15');
    expect(localDate(new Date('2025-03-14T19:30:00Z'), 'Asia/Dubai')).toBe('2025-03-14');
  });

  it('handles Riyadh, an hour behind Dubai', () => {
    expect(localDate(new Date('2025-03-14T21:30:00Z'), 'Asia/Riyadh')).toBe('2025-03-15');
    expect(localDate(new Date('2025-03-14T20:30:00Z'), 'Asia/Riyadh')).toBe('2025-03-14');
  });

  it('round-trips a wall-clock time through its zone', () => {
    const instant = zonedTimeToInstant('2025-03-14', 23, 45, 0, 'Asia/Dubai');
    expect(instant.toISOString()).toBe('2025-03-14T19:45:00.000Z');
    expect(localDate(instant, 'Asia/Dubai')).toBe('2025-03-14');
  });
});

describe('parseStatementDate', () => {
  it('reads the formats that turn up in statements', () => {
    expect(parseStatementDate('2025-03-14')).toBe('2025-03-14');
    expect(parseStatementDate('2025-03-14T18:30:00Z')).toBe('2025-03-14');
    expect(parseStatementDate('2025-03-14 18:30:00')).toBe('2025-03-14');
    expect(parseStatementDate('14/03/2025')).toBe('2025-03-14');
    expect(parseStatementDate('14-03-2025')).toBe('2025-03-14');
    expect(parseStatementDate('14 Mar 2025')).toBe('2025-03-14');
  });

  it('reads day-first, never month-first', () => {
    expect(parseStatementDate('03/04/2025')).toBe('2025-04-03');
  });

  it('returns null rather than guessing', () => {
    expect(parseStatementDate('')).toBeNull();
    expect(parseStatementDate('March-ish')).toBeNull();
    expect(parseStatementDate('31/02/2025')).toBeNull();
    expect(parseStatementDate('14/03/25')).toBeNull();
  });
});

describe('parseStatementInstant', () => {
  it('takes an explicit offset at face value', () => {
    expect(parseStatementInstant('2025-03-14T18:30:00Z', 'Asia/Dubai')?.toISOString()).toBe(
      '2025-03-14T18:30:00.000Z',
    );
    expect(parseStatementInstant('2025-03-14T18:30:00+04:00', 'Asia/Dubai')?.toISOString()).toBe(
      '2025-03-14T14:30:00.000Z',
    );
  });

  it('interprets a bare wall-clock time in the branch timezone', () => {
    expect(parseStatementInstant('14/03/2025 22:15', 'Asia/Dubai')?.toISOString()).toBe(
      '2025-03-14T18:15:00.000Z',
    );
    expect(parseStatementInstant('14/03/2025 22:15', 'Asia/Riyadh')?.toISOString()).toBe(
      '2025-03-14T19:15:00.000Z',
    );
  });

  it('defaults to midnight local when there is no time component', () => {
    expect(parseStatementInstant('14/03/2025', 'Asia/Dubai')?.toISOString()).toBe(
      '2025-03-13T20:00:00.000Z',
    );
  });

  it('returns null on nonsense rather than epoch zero', () => {
    expect(parseStatementInstant('', 'Asia/Dubai')).toBeNull();
    expect(parseStatementInstant('yesterday', 'Asia/Dubai')).toBeNull();
    expect(parseStatementInstant('14/03/2025 99:99', 'Asia/Dubai')).toBeNull();
  });
});

describe('minutesBetween', () => {
  it('is absolute, so window comparisons need no sign handling', () => {
    expect(minutesBetween(new Date('2025-03-14T18:00:00Z'), new Date('2025-03-14T18:30:00Z'))).toBe(30);
    expect(minutesBetween(new Date('2025-03-14T18:30:00Z'), new Date('2025-03-14T18:00:00Z'))).toBe(30);
  });
});
