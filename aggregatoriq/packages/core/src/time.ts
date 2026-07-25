/**
 * Time.
 *
 * Two kinds of time appear in this product and conflating them is a documented
 * way to produce wrong numbers:
 *
 *   Instants — when an order was placed. Stored as `timestamptz`, compared as
 *   absolute moments. Used by the fuzzy matcher's time-window rule.
 *
 *   Calendar dates — a statement period, a payout date. Stored as `date`,
 *   handled as `YYYY-MM-DD` strings. A payout period that runs "1–15 March" is
 *   not an instant range, and turning it into one in the server's timezone is
 *   how orders on the boundary land in the wrong period and appear as
 *   MISSING_PAYOUT when they were simply paid in the next cycle.
 *
 * A branch carries an IANA timezone precisely so that "which day did this order
 * fall on, for this branch" has one answer.
 */

export type PlainDate = string;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export class InvalidDateError extends Error {
  constructor(value: string) {
    super(`Not a valid YYYY-MM-DD date: ${JSON.stringify(value)}`);
    this.name = 'InvalidDateError';
  }
}

export function isPlainDate(value: unknown): value is PlainDate {
  if (typeof value !== 'string') return false;
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const dt = new Date(Date.UTC(year, month - 1, day));
  return (
    dt.getUTCFullYear() === year && dt.getUTCMonth() === month - 1 && dt.getUTCDate() === day
  );
}

export function assertPlainDate(value: unknown): asserts value is PlainDate {
  if (!isPlainDate(value)) throw new InvalidDateError(String(value));
}

const DAY_MS = 86_400_000;

function toUtcMs(date: PlainDate): number {
  assertPlainDate(date);
  const match = ISO_DATE.exec(date)!;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function fromUtcMs(ms: number): PlainDate {
  const dt = new Date(ms);
  return [
    String(dt.getUTCFullYear()).padStart(4, '0'),
    String(dt.getUTCMonth() + 1).padStart(2, '0'),
    String(dt.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

export function addDays(date: PlainDate, days: number): PlainDate {
  if (!Number.isInteger(days)) throw new TypeError(`addDays expects an integer, got ${days}`);
  return fromUtcMs(toUtcMs(date) + days * DAY_MS);
}

export function daysBetween(a: PlainDate, b: PlainDate): number {
  return Math.round((toUtcMs(b) - toUtcMs(a)) / DAY_MS);
}

export function compareDates(a: PlainDate, b: PlainDate): -1 | 0 | 1 {
  const av = toUtcMs(a);
  const bv = toUtcMs(b);
  return av < bv ? -1 : av > bv ? 1 : 0;
}

export function isBefore(a: PlainDate, b: PlainDate): boolean {
  return compareDates(a, b) < 0;
}

export function isAfter(a: PlainDate, b: PlainDate): boolean {
  return compareDates(a, b) > 0;
}

/** Inclusive on both ends, which is how a statement period is quoted. */
export function isWithinPeriod(date: PlainDate, start: PlainDate, end: PlainDate): boolean {
  return compareDates(date, start) >= 0 && compareDates(date, end) <= 0;
}

export interface Period {
  readonly start: PlainDate;
  readonly end: PlainDate;
}

export function period(start: PlainDate, end: PlainDate): Period {
  assertPlainDate(start);
  assertPlainDate(end);
  if (isAfter(start, end)) {
    throw new InvalidDateError(`Period start ${start} is after end ${end}`);
  }
  return { start, end };
}

export function periodsOverlap(a: Period, b: Period): boolean {
  return !isAfter(a.start, b.end) && !isAfter(b.start, a.end);
}

export function periodContains(outer: Period, date: PlainDate): boolean {
  return isWithinPeriod(date, outer.start, outer.end);
}

export function periodLengthDays(value: Period): number {
  return daysBetween(value.start, value.end) + 1;
}

/**
 * The gaps between the periods a branch has statements for.
 *
 * A missing period is itself a finding — a month with orders and no statement
 * is either an aggregator that did not send one or a restaurant that forgot to
 * forward it, and either way it is money nobody has looked at. Surfacing this
 * is why the statements screen exists.
 */
export function findCoverageGaps(covered: readonly Period[], expected: Period): Period[] {
  if (covered.length === 0) return [expected];

  const relevant = covered
    .filter((candidate) => periodsOverlap(candidate, expected))
    .sort((a, b) => compareDates(a.start, b.start));

  if (relevant.length === 0) return [expected];

  const gaps: Period[] = [];
  let cursor = expected.start;

  for (const covering of relevant) {
    if (isBefore(cursor, covering.start)) {
      gaps.push(period(cursor, addDays(covering.start, -1)));
    }
    const nextCursor = addDays(covering.end, 1);
    if (isAfter(nextCursor, cursor)) cursor = nextCursor;
  }

  if (!isAfter(cursor, expected.end)) {
    gaps.push(period(cursor, expected.end));
  }

  return gaps;
}

/**
 * The calendar date an instant falls on, in a branch's own timezone.
 *
 * Uses `Intl` rather than offset arithmetic so that DST and any future offset
 * change are handled by the platform's tz database rather than by assumptions
 * baked in here. Gulf timezones do not observe DST today, but the product will
 * not stay in the Gulf forever and this is not the code to have to remember.
 */
export function localDate(instant: Date, timeZone: string): PlainDate {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);

  const lookup = (type: string): string =>
    parts.find((part) => part.type === type)?.value ?? '';

  const candidate = `${lookup('year')}-${lookup('month')}-${lookup('day')}`;
  assertPlainDate(candidate);
  return candidate;
}

export function toPlainDateUtc(value: Date): PlainDate {
  return fromUtcMs(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

export function today(now: Date = new Date()): PlainDate {
  return toPlainDateUtc(now);
}

export function minutesBetween(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / 60_000;
}

/**
 * Parse the date formats that arrive in aggregator statements.
 *
 * Day-first only. Gulf paperwork is day-first, and a silent US-order reading
 * turns 03/04 into the wrong month — which in this product means an order lands
 * in the wrong statement period and is reported as missing.
 */
export function parseStatementDate(input: string): PlainDate | null {
  const raw = input.trim();
  if (raw === '') return null;

  if (isPlainDate(raw)) return raw;

  // ISO instant or `YYYY-MM-DD HH:mm:ss`.
  const isoPrefix = /^(\d{4}-\d{2}-\d{2})[T ]/.exec(raw);
  if (isoPrefix && isPlainDate(isoPrefix[1]!)) return isoPrefix[1]!;

  const dmy = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})/.exec(raw);
  if (dmy) {
    const candidate = `${dmy[3]}-${dmy[2]!.padStart(2, '0')}-${dmy[1]!.padStart(2, '0')}`;
    return isPlainDate(candidate) ? candidate : null;
  }

  const ymd = /^(\d{4})[/.](\d{1,2})[/.](\d{1,2})/.exec(raw);
  if (ymd) {
    const candidate = `${ymd[1]}-${ymd[2]!.padStart(2, '0')}-${ymd[3]!.padStart(2, '0')}`;
    return isPlainDate(candidate) ? candidate : null;
  }

  const months: Record<string, string> = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  };
  const dMonY = /^(\d{1,2})[\s-]([A-Za-z]{3,9})[\s-](\d{4})/.exec(raw);
  if (dMonY) {
    const month = months[dMonY[2]!.slice(0, 3).toLowerCase()];
    if (!month) return null;
    const candidate = `${dMonY[3]}-${month}-${dMonY[1]!.padStart(2, '0')}`;
    return isPlainDate(candidate) ? candidate : null;
  }

  return null;
}

/** Parse a full timestamp from a statement, returning `null` if unusable. */
export function parseStatementInstant(input: string, timeZone: string): Date | null {
  const raw = input.trim();
  if (raw === '') return null;

  // A genuine ISO instant with an offset is unambiguous — take it as given.
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/.test(raw)) {
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const date = parseStatementDate(raw);
  if (date === null) return null;

  // Safe to search the whole string: no supported date format contains a colon.
  const timeMatch = /(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(raw);
  const hours = timeMatch ? Number(timeMatch[1]) : 0;
  const minutes = timeMatch ? Number(timeMatch[2]) : 0;
  const seconds = timeMatch?.[3] !== undefined ? Number(timeMatch[3]) : 0;

  if (hours > 23 || minutes > 59 || seconds > 59) return null;

  return zonedTimeToInstant(date, hours, minutes, seconds, timeZone);
}

/**
 * Interpret a wall-clock time in a named timezone as an absolute instant.
 *
 * Done by measuring the zone's offset at an approximate instant and correcting,
 * which is accurate everywhere except the one ambiguous hour of a DST fall-back
 * — where it picks the first occurrence. Gulf zones have no DST, so this is a
 * correctness note for later expansion rather than a live concern.
 */
export function zonedTimeToInstant(
  date: PlainDate,
  hours: number,
  minutes: number,
  seconds: number,
  timeZone: string,
): Date {
  const naiveUtc = toUtcMs(date) + hours * 3_600_000 + minutes * 60_000 + seconds * 1_000;
  const offset = zoneOffsetMs(new Date(naiveUtc), timeZone);
  const corrected = naiveUtc - offset;
  // One refinement pass, in case the first guess landed the other side of a
  // transition.
  const refinedOffset = zoneOffsetMs(new Date(corrected), timeZone);
  return new Date(naiveUtc - refinedOffset);
}

function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);

  const lookup = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');

  const asUtc = Date.UTC(
    lookup('year'),
    lookup('month') - 1,
    lookup('day'),
    lookup('hour') % 24,
    lookup('minute'),
    lookup('second'),
  );

  return asUtc - instant.getTime();
}
