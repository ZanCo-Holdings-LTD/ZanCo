/**
 * Calendar-day arithmetic in UTC.
 *
 * Every date in Sarayan that a human would call "a date" (issue date, expiry
 * date, alert due date) is a calendar day, not an instant. Timezone drift on an
 * expiry date is not a rounding error — it is a missed renewal. So all of it
 * runs through here, in UTC, on whole days.
 */

/** A calendar day with no time component, serialised as `YYYY-MM-DD`. */
export type PlainDate = string;

const DAY_MS = 86_400_000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isPlainDate(value: unknown): value is PlainDate {
  if (typeof value !== "string") return false;
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const [, y, m, d] = match;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  // Rejects 2026-02-30 and friends, which `Date.UTC` would silently roll over.
  return (
    date.getUTCFullYear() === Number(y) &&
    date.getUTCMonth() === Number(m) - 1 &&
    date.getUTCDate() === Number(d)
  );
}

export function toPlainDate(value: Date | string): PlainDate {
  if (typeof value === "string") {
    if (isPlainDate(value)) return value;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) throw new RangeError(`Not a date: ${value}`);
    return parsed.toISOString().slice(0, 10);
  }
  if (Number.isNaN(value.getTime())) throw new RangeError("Not a date: Invalid Date");
  return value.toISOString().slice(0, 10);
}

/** Midnight UTC on the given calendar day. */
export function toUtcInstant(date: PlainDate): Date {
  if (!isPlainDate(date)) throw new RangeError(`Not a plain date: ${date}`);
  return new Date(`${date}T00:00:00.000Z`);
}

export function addDays(date: PlainDate, days: number): PlainDate {
  return toPlainDate(new Date(toUtcInstant(date).getTime() + days * DAY_MS));
}

export function addMonths(date: PlainDate, months: number): PlainDate {
  const start = toUtcInstant(date);
  const targetMonth = start.getUTCMonth() + months;
  const candidate = new Date(
    Date.UTC(start.getUTCFullYear(), targetMonth, start.getUTCDate()),
  );
  // 31 Jan + 1 month should be 28/29 Feb, not 2/3 March.
  if (candidate.getUTCMonth() !== ((targetMonth % 12) + 12) % 12) {
    return toPlainDate(new Date(Date.UTC(start.getUTCFullYear(), targetMonth + 1, 0)));
  }
  return toPlainDate(candidate);
}

/** Whole calendar days from `from` to `to`. Negative when `to` is in the past. */
export function daysBetween(from: PlainDate, to: PlainDate): number {
  return Math.round((toUtcInstant(to).getTime() - toUtcInstant(from).getTime()) / DAY_MS);
}

export function today(now: Date = new Date()): PlainDate {
  return toPlainDate(now);
}

export function minDate(a: PlainDate, b: PlainDate): PlainDate {
  return a <= b ? a : b;
}

export function maxDate(a: PlainDate, b: PlainDate): PlainDate {
  return a >= b ? a : b;
}
