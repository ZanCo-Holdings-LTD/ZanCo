/**
 * Money is an integer count of minor units plus an ISO-4217 code. There are no
 * floats anywhere near a fee ledger that reconciles government payments a firm
 * has fronted on a client's behalf.
 *
 * Note the Gulf currencies with three decimal places — a Kuwaiti dinar has 1000
 * fils, not 100. Getting that wrong silently multiplies a fee by ten.
 */
import type { Currency } from './types.js';

export interface Money {
  readonly amountMinor: number;
  readonly currency: Currency;
}

const MINOR_UNIT_EXPONENT: Record<Currency, number> = {
  AED: 2,
  SAR: 2,
  GBP: 2,
  USD: 2,
  EUR: 2,
  QAR: 2,
  OMR: 3,
  BHD: 3,
  KWD: 3,
};

export function minorUnitExponent(currency: Currency): number {
  return MINOR_UNIT_EXPONENT[currency];
}

export class CurrencyMismatchError extends Error {
  constructor(a: Currency, b: Currency) {
    super(`Cannot combine ${a} and ${b} — convert to a single currency first`);
    this.name = 'CurrencyMismatchError';
  }
}

export function money(amountMinor: number, currency: Currency): Money {
  if (!Number.isInteger(amountMinor)) {
    throw new TypeError(`amountMinor must be an integer, got ${amountMinor}`);
  }
  if (!Number.isSafeInteger(amountMinor)) {
    throw new RangeError(`amountMinor ${amountMinor} exceeds the safe integer range`);
  }
  return { amountMinor, currency };
}

export function zero(currency: Currency): Money {
  return { amountMinor: 0, currency };
}

export function add(a: Money, b: Money): Money {
  if (a.currency !== b.currency) throw new CurrencyMismatchError(a.currency, b.currency);
  return money(a.amountMinor + b.amountMinor, a.currency);
}

export function subtract(a: Money, b: Money): Money {
  if (a.currency !== b.currency) throw new CurrencyMismatchError(a.currency, b.currency);
  return money(a.amountMinor - b.amountMinor, a.currency);
}

export function negate(a: Money): Money {
  return money(-a.amountMinor, a.currency);
}

/** Rounds half away from zero, so a 2.5 fils split does not drift towards even. */
export function multiply(a: Money, factor: number): Money {
  const raw = a.amountMinor * factor;
  const rounded = raw < 0 ? -Math.round(-raw) : Math.round(raw);
  return money(rounded, a.currency);
}

export function sum(items: readonly Money[], currency: Currency): Money {
  return items.reduce<Money>((acc, item) => add(acc, item), zero(currency));
}

export function isZero(a: Money): boolean {
  return a.amountMinor === 0;
}

export function compareMoney(a: Money, b: Money): -1 | 0 | 1 {
  if (a.currency !== b.currency) throw new CurrencyMismatchError(a.currency, b.currency);
  return a.amountMinor < b.amountMinor ? -1 : a.amountMinor > b.amountMinor ? 1 : 0;
}

/** Decimal string, e.g. `1234` AED -> `"12.34"`. No symbol, no grouping. */
export function toDecimalString(a: Money): string {
  const exponent = minorUnitExponent(a.currency);
  const negative = a.amountMinor < 0;
  const digits = Math.abs(a.amountMinor).toString().padStart(exponent + 1, '0');
  const whole = digits.slice(0, digits.length - exponent);
  const fraction = exponent > 0 ? `.${digits.slice(digits.length - exponent)}` : '';
  return `${negative ? '-' : ''}${whole}${fraction}`;
}

/**
 * Parse user or CSV input into minor units. Tolerates thousands separators and
 * a leading currency code; rejects anything with more precision than the
 * currency has, rather than silently truncating a fee.
 */
export function parseDecimalToMinor(input: string, currency: Currency): number | null {
  const exponent = minorUnitExponent(currency);
  const cleaned = input.trim().replace(/^[A-Za-z]{3}\s*/, '').replace(/,/g, '').replace(/\s/g, '');
  if (cleaned === '') return null;

  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(cleaned);
  if (!match) return null;

  const [, sign, whole, fraction = ''] = match;
  if (fraction.length > exponent) return null;

  const padded = fraction.padEnd(exponent, '0');
  const value = Number(`${whole}${padded}`);
  if (!Number.isSafeInteger(value)) return null;
  return sign === '-' ? -value : value;
}

/** Localised display string. Falls back to the plain decimal if Intl is absent. */
export function formatMoney(a: Money, locale = 'en'): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: a.currency,
      minimumFractionDigits: minorUnitExponent(a.currency),
      maximumFractionDigits: minorUnitExponent(a.currency),
    }).format(a.amountMinor / 10 ** minorUnitExponent(a.currency));
  } catch {
    return `${a.currency} ${toDecimalString(a)}`;
  }
}
