/**
 * Plain-date arithmetic.
 *
 * Every expiry, issue and due date in AgentOS is a calendar date, never an
 * instant. A trade licence expires on a day, not at a moment, and the firm
 * reading the dashboard is in GST (UTC+4) or AST (UTC+3) while the server is
 * in UTC. Representing these as `Date` objects and formatting them locally is
 * how you end up telling a customer their licence expires a day late — the one
 * failure mode this product exists to prevent.
 *
 * So: dates are `YYYY-MM-DD` strings, and all arithmetic happens here against
 * UTC midnight, which is never subject to a DST or offset shift.
 */

/** A calendar date in `YYYY-MM-DD` form. */
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
  const [, y, m, d] = match;
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  // Round-trip through UTC to reject 2025-02-30 and friends.
  const ms = Date.UTC(year, month - 1, day);
  const dt = new Date(ms);
  return (
    dt.getUTCFullYear() === year && dt.getUTCMonth() === month - 1 && dt.getUTCDate() === day
  );
}

export function assertPlainDate(value: unknown): asserts value is PlainDate {
  if (!isPlainDate(value)) throw new InvalidDateError(String(value));
}

function toUtcMs(date: PlainDate): number {
  assertPlainDate(date);
  const match = ISO_DATE.exec(date)!;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function fromUtcMs(ms: number): PlainDate {
  const dt = new Date(ms);
  const y = String(dt.getUTCFullYear()).padStart(4, '0');
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const DAY_MS = 86_400_000;

/** Convert a JS `Date` (or an instant) to the calendar date it falls on in UTC. */
export function toPlainDate(value: Date | string | number): PlainDate {
  if (typeof value === 'string' && isPlainDate(value)) return value;
  const dt = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(dt.getTime())) throw new InvalidDateError(String(value));
  return fromUtcMs(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()));
}

/** UTC midnight of a plain date, for storage in a `timestamptz` or comparison. */
export function toDate(date: PlainDate): Date {
  return new Date(toUtcMs(date));
}

export function addDays(date: PlainDate, days: number): PlainDate {
  if (!Number.isInteger(days)) throw new TypeError(`addDays expects an integer, got ${days}`);
  return fromUtcMs(toUtcMs(date) + days * DAY_MS);
}

export function subDays(date: PlainDate, days: number): PlainDate {
  return addDays(date, -days);
}

/** `b - a`, in whole days. Positive when `b` is after `a`. */
export function daysBetween(a: PlainDate, b: PlainDate): number {
  return Math.round((toUtcMs(b) - toUtcMs(a)) / DAY_MS);
}

/** Days from `today` until `date`. Negative once the date is in the past. */
export function daysUntil(date: PlainDate, today: PlainDate): number {
  return daysBetween(today, date);
}

export function compareDates(a: PlainDate, b: PlainDate): -1 | 0 | 1 {
  const av = toUtcMs(a);
  const bv = toUtcMs(b);
  return av < bv ? -1 : av > bv ? 1 : 0;
}

export function minDate(...dates: PlainDate[]): PlainDate {
  if (dates.length === 0) throw new TypeError('minDate requires at least one date');
  return dates.reduce((acc, d) => (compareDates(d, acc) < 0 ? d : acc));
}

export function maxDate(...dates: PlainDate[]): PlainDate {
  if (dates.length === 0) throw new TypeError('maxDate requires at least one date');
  return dates.reduce((acc, d) => (compareDates(d, acc) > 0 ? d : acc));
}

export function isBefore(a: PlainDate, b: PlainDate): boolean {
  return compareDates(a, b) < 0;
}

export function isAfter(a: PlainDate, b: PlainDate): boolean {
  return compareDates(a, b) > 0;
}

export function isOnOrBefore(a: PlainDate, b: PlainDate): boolean {
  return compareDates(a, b) <= 0;
}

export function isOnOrAfter(a: PlainDate, b: PlainDate): boolean {
  return compareDates(a, b) >= 0;
}

/** Inclusive on both ends. */
export function isWithin(date: PlainDate, from: PlainDate, to: PlainDate): boolean {
  return isOnOrAfter(date, from) && isOnOrBefore(date, to);
}

/** Today, in UTC. Pass a clock in tests rather than mocking `Date`. */
export function today(now: Date = new Date()): PlainDate {
  return toPlainDate(now);
}

/**
 * Parse the loose date formats that arrive from CSV imports and document
 * extraction. Returns `null` rather than guessing when the format is
 * ambiguous or unrecognised — a wrong expiry date is worse than no date.
 *
 * Accepted: `YYYY-MM-DD`, `DD/MM/YYYY`, `DD-MM-YYYY`, `DD.MM.YYYY`,
 * `YYYY/MM/DD`, and `DD MMM YYYY` (English month abbreviations).
 *
 * Deliberately NOT accepted: `MM/DD/YYYY`. Gulf paperwork is day-first and a
 * silent US-order reading turns 03/04 into the wrong month.
 */
export function parseLooseDate(input: string): PlainDate | null {
  const raw = input.trim();
  if (raw === '') return null;

  if (isPlainDate(raw)) return raw;

  const dmy = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/.exec(raw);
  if (dmy) {
    const candidate = `${dmy[3]}-${dmy[2]!.padStart(2, '0')}-${dmy[1]!.padStart(2, '0')}`;
    return isPlainDate(candidate) ? candidate : null;
  }

  const ymd = /^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/.exec(raw);
  if (ymd) {
    const candidate = `${ymd[1]}-${ymd[2]!.padStart(2, '0')}-${ymd[3]!.padStart(2, '0')}`;
    return isPlainDate(candidate) ? candidate : null;
  }

  const months: Record<string, string> = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  };
  const dMonY = /^(\d{1,2})[\s-]([A-Za-z]{3,9})[\s-](\d{4})$/.exec(raw);
  if (dMonY) {
    const month = months[dMonY[2]!.slice(0, 3).toLowerCase()];
    if (!month) return null;
    const candidate = `${dMonY[3]}-${month}-${dMonY[1]!.padStart(2, '0')}`;
    return isPlainDate(candidate) ? candidate : null;
  }

  return null;
}
