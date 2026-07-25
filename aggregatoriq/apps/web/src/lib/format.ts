import { formatMoney, money, type Currency } from '@aggregatoriq/core';

/**
 * Formatting for display.
 *
 * Amounts are formatted from minor units at the very edge, in the view. Nothing
 * upstream of here ever holds a decimal, which is what keeps the arithmetic
 * exact all the way to the screen.
 */
export function amount(minor: number, currency: string, locale = 'en'): string {
  return formatMoney(money(Math.trunc(minor), currency as Currency), locale);
}

/** Signed, with an explicit plus, for a delta where direction is the message. */
export function signedAmount(minor: number, currency: string, locale = 'en'): string {
  const formatted = amount(Math.abs(minor), currency, locale);
  if (minor === 0) return formatted;
  return minor > 0 ? `+${formatted}` : `−${formatted}`;
}

export function percent(value: number | null, locale = 'en'): string {
  if (value === null) return '—';
  return new Intl.NumberFormat(locale, {
    style: 'percent',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/**
 * Render a calendar date without going near a timezone.
 *
 * `new Date('2025-03-15')` is midnight UTC, which in a negative offset formats
 * as the 14th. Splitting the string avoids the entire class of bug.
 */
export function plainDate(value: string | null, locale = 'en'): string {
  if (value === null) return '—';

  const [year, month, day] = value.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined) return value;

  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

export function dateTime(value: Date | null, locale = 'en'): string {
  if (value === null) return '—';
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(value);
}

export function count(value: number, locale = 'en'): string {
  return new Intl.NumberFormat(locale).format(value);
}
