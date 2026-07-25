import { describe, expect, it } from 'vitest';
import {
  CurrencyMismatchError,
  add,
  formatMoney,
  money,
  multiply,
  parseDecimalToMinor,
  subtract,
  sum,
  toDecimalString,
} from './money.js';

describe('money', () => {
  it('refuses fractional minor units', () => {
    expect(() => money(10.5, 'AED')).toThrow(TypeError);
  });

  it('will not silently combine currencies', () => {
    expect(() => add(money(100, 'AED'), money(100, 'SAR'))).toThrow(CurrencyMismatchError);
    expect(() => subtract(money(100, 'AED'), money(100, 'GBP'))).toThrow(CurrencyMismatchError);
  });

  it('adds and sums', () => {
    expect(add(money(2500, 'AED'), money(750, 'AED')).amountMinor).toBe(3250);
    expect(sum([money(100, 'AED'), money(200, 'AED')], 'AED').amountMinor).toBe(300);
    expect(sum([], 'AED').amountMinor).toBe(0);
  });

  it('rounds a multiplication half away from zero', () => {
    expect(multiply(money(101, 'AED'), 0.5).amountMinor).toBe(51);
    expect(multiply(money(-101, 'AED'), 0.5).amountMinor).toBe(-51);
  });
});

describe('minor unit handling', () => {
  it('uses two decimals for AED and SAR', () => {
    expect(toDecimalString(money(123_456, 'AED'))).toBe('1234.56');
    expect(toDecimalString(money(5, 'SAR'))).toBe('0.05');
    expect(toDecimalString(money(-250, 'GBP'))).toBe('-2.50');
  });

  it('uses three decimals for the dinar currencies', () => {
    // A Kuwaiti dinar has 1000 fils. Treating it as 100 multiplies a fee by ten.
    expect(toDecimalString(money(1_234, 'KWD'))).toBe('1.234');
    expect(toDecimalString(money(1_234, 'BHD'))).toBe('1.234');
    expect(toDecimalString(money(1_234, 'OMR'))).toBe('1.234');
  });

  it('parses decimal input back to minor units', () => {
    expect(parseDecimalToMinor('1234.56', 'AED')).toBe(123_456);
    expect(parseDecimalToMinor('1,234.56', 'AED')).toBe(123_456);
    expect(parseDecimalToMinor('AED 1234.56', 'AED')).toBe(123_456);
    expect(parseDecimalToMinor('1234', 'AED')).toBe(123_400);
    expect(parseDecimalToMinor('1.234', 'KWD')).toBe(1_234);
  });

  it('rejects input with more precision than the currency has', () => {
    // Truncating here would quietly lose part of a government fee.
    expect(parseDecimalToMinor('1234.567', 'AED')).toBeNull();
    expect(parseDecimalToMinor('1.2345', 'KWD')).toBeNull();
    expect(parseDecimalToMinor('not a number', 'AED')).toBeNull();
    expect(parseDecimalToMinor('', 'AED')).toBeNull();
  });

  it('round-trips', () => {
    for (const value of ['0.00', '0.01', '999999.99', '-42.50']) {
      const minor = parseDecimalToMinor(value, 'AED')!;
      expect(toDecimalString(money(minor, 'AED'))).toBe(value === '-42.50' ? '-42.50' : value);
    }
  });

  it('formats without throwing on any supported currency', () => {
    for (const currency of ['AED', 'SAR', 'GBP', 'KWD'] as const) {
      expect(formatMoney(money(123_456, currency))).toBeTypeOf('string');
      expect(formatMoney(money(123_456, currency), 'ar')).toBeTypeOf('string');
    }
  });
});
