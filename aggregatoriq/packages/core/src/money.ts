/**
 * Money.
 *
 * Every amount in AggregatorIQ is an integer count of minor units plus an
 * ISO-4217 code. There are no floats anywhere near this product, and that is
 * not fastidiousness: the entire proposition is telling a restaurant "you are
 * owed 4,312.50 AED and here is the arithmetic". A number that fails to
 * reproduce exactly on a re-run is worse than no number, because the operator
 * takes it to the aggregator and loses the argument.
 *
 * Note the three-decimal Gulf currencies. A Kuwaiti dinar has 1000 fils. Treat
 * it as 100 and every figure you show a Kuwaiti operator is out by a factor of
 * ten.
 */

export const CURRENCIES = ['AED', 'SAR', 'GBP', 'USD', 'EUR', 'QAR', 'OMR', 'BHD', 'KWD'] as const;
export type Currency = (typeof CURRENCIES)[number];

export function isCurrency(value: unknown): value is Currency {
  return typeof value === 'string' && (CURRENCIES as readonly string[]).includes(value);
}

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
    super(`Cannot combine ${a} and ${b} — a reconciliation must run in one currency`);
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

export function abs(a: Money): Money {
  return money(Math.abs(a.amountMinor), a.currency);
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

/**
 * Apply a commission rate to an amount.
 *
 * Rounding is half away from zero and applied once, at this boundary. Every
 * commission calculation in the engine goes through here so that the whole
 * product rounds identically — a rule that rounded differently from its
 * neighbour would produce single-fils variances that are pure noise and would
 * destroy trust faster than a missed variance ever could.
 */
export function applyRate(amount: Money, rate: number): Money {
  if (!Number.isFinite(rate)) throw new TypeError(`Commission rate must be finite, got ${rate}`);
  const raw = amount.amountMinor * rate;
  const rounded = raw < 0 ? -Math.round(-raw) : Math.round(raw);
  return money(rounded, amount.currency);
}

export function multiply(a: Money, factor: number): Money {
  return applyRate(a, factor);
}

/** Decimal string, e.g. `123456` AED -> `"1234.56"`. No symbol, no grouping. */
export function toDecimalString(a: Money): string {
  const exponent = minorUnitExponent(a.currency);
  const negative = a.amountMinor < 0;
  const digits = Math.abs(a.amountMinor).toString().padStart(exponent + 1, '0');
  const whole = digits.slice(0, digits.length - exponent);
  const fraction = exponent > 0 ? `.${digits.slice(digits.length - exponent)}` : '';
  return `${negative ? '-' : ''}${whole}${fraction}`;
}

/**
 * Parse an amount out of a statement cell.
 *
 * Aggregator exports are not consistent about any of this: negatives arrive as
 * `-12.34`, `(12.34)` and `12.34-`; thousands separators appear and disappear;
 * some Saudi exports use Arabic-Indic digits. Returning `null` rather than
 * guessing is the whole point — an unparseable amount must surface as a parse
 * failure, not as a zero that silently understates what a restaurant is owed.
 */
export function parseAmountToMinor(input: string, currency: Currency): number | null {
  const exponent = minorUnitExponent(currency);

  let text = input.trim();
  if (text === '') return null;

  text = normaliseDigits(text);

  let negative = false;

  // Accounting parentheses.
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1).trim();
  }
  // Trailing sign, as some ERP exports emit.
  if (text.endsWith('-')) {
    negative = true;
    text = text.slice(0, -1).trim();
  }

  // Strip a leading or trailing currency code or symbol.
  text = text
    .replace(/^[A-Za-z]{2,3}\s*/, '')
    .replace(/\s*[A-Za-z]{2,3}$/, '')
    .replace(/[^\d.,\-+\s]/g, '')
    .trim();

  text = text.replace(/\s/g, '');

  if (text.startsWith('-')) {
    negative = true;
    text = text.slice(1);
  } else if (text.startsWith('+')) {
    text = text.slice(1);
  }

  text = stripThousandsSeparators(text);

  // Anything that is not now a plain decimal is rejected below rather than
  // coerced — an unparseable amount must surface as a parse failure.
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) return null;

  const [, whole, fraction = ''] = match;

  // More precision than the currency has is a signal the cell was
  // misinterpreted, not something to round away.
  if (fraction.length > exponent) return null;

  const value = Number(`${whole}${fraction.padEnd(exponent, '0')}`);
  if (!Number.isSafeInteger(value)) return null;

  return negative ? -value : value;
}

/** Arabic-Indic and Eastern Arabic-Indic digits appear in Saudi exports. */
function normaliseDigits(text: string): string {
  return text.replace(/[٠-٩۰-۹]/g, (char) => {
    const code = char.charCodeAt(0);
    const base = code >= 0x06f0 ? 0x06f0 : 0x0660;
    return String(code - base);
  });
}

/**
 * Decide whether commas are thousands separators or a decimal comma and return
 * a canonical `1234.56`. Anything it cannot canonicalise is returned unchanged,
 * to be rejected by the caller's final format check.
 */
function stripThousandsSeparators(text: string): string {
  const hasComma = text.includes(',');
  const hasDot = text.includes('.');

  if (hasComma && hasDot) {
    // Whichever appears last is the decimal separator.
    return text.lastIndexOf(',') > text.lastIndexOf('.')
      ? text.replace(/\./g, '').replace(',', '.')
      : text.replace(/,/g, '');
  }

  if (hasComma) {
    const parts = text.split(',');
    // `1,234` is a thousands separator; `12,34` is a decimal comma. Three
    // digits after the last comma with more than one group is the giveaway.
    const tail = parts[parts.length - 1]!;
    if (parts.length > 2 || tail.length === 3) return text.replace(/,/g, '');
    return text.replace(',', '.');
  }

  return text;
}

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

/** One unit of currency in minor units — the default materiality threshold. */
export function oneUnit(currency: Currency): number {
  return 10 ** minorUnitExponent(currency);
}
