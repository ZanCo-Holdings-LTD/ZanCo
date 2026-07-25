import { describe, expect, it } from 'vitest';
import {
  CurrencyMismatchError,
  applyRate,
  money,
  oneUnit,
  parseAmountToMinor,
  sum,
  toDecimalString,
} from './money.js';

describe('money', () => {
  it('refuses fractional minor units', () => {
    expect(() => money(10.5, 'AED')).toThrow(TypeError);
  });

  it('will not silently combine currencies', () => {
    expect(() => sum([money(1, 'AED'), money(1, 'SAR')], 'AED')).toThrow(CurrencyMismatchError);
  });

  it('formats two-decimal and three-decimal currencies correctly', () => {
    expect(toDecimalString(money(123_456, 'AED'))).toBe('1234.56');
    expect(toDecimalString(money(123_456, 'KWD'))).toBe('123.456');
    expect(toDecimalString(money(-250, 'SAR'))).toBe('-2.50');
    expect(oneUnit('AED')).toBe(100);
    expect(oneUnit('KWD')).toBe(1000);
  });
});

describe('applyRate', () => {
  it('rounds half away from zero, once, at this boundary', () => {
    // 25.05 AED at 30% is 751.5 fils. Every rule rounds the same way or the
    // engine produces single-fils noise variances.
    expect(applyRate(money(2_505, 'AED'), 0.3).amountMinor).toBe(752);
    expect(applyRate(money(-2_505, 'AED'), 0.3).amountMinor).toBe(-752);
  });

  it('is exact for the rates aggregators actually use', () => {
    expect(applyRate(money(10_000, 'AED'), 0.25).amountMinor).toBe(2_500);
    expect(applyRate(money(10_000, 'AED'), 0.3).amountMinor).toBe(3_000);
    expect(applyRate(money(9_999, 'SAR'), 0.22).amountMinor).toBe(2_200);
  });

  it('rejects a non-finite rate rather than producing NaN money', () => {
    expect(() => applyRate(money(100, 'AED'), Number.NaN)).toThrow(TypeError);
    expect(() => applyRate(money(100, 'AED'), Number.POSITIVE_INFINITY)).toThrow(TypeError);
  });
});

describe('parseAmountToMinor', () => {
  it('reads the plain cases', () => {
    expect(parseAmountToMinor('1234.56', 'AED')).toBe(123_456);
    expect(parseAmountToMinor('1,234.56', 'AED')).toBe(123_456);
    expect(parseAmountToMinor('1234', 'AED')).toBe(123_400);
    expect(parseAmountToMinor('0.05', 'AED')).toBe(5);
    expect(parseAmountToMinor('  42.00  ', 'AED')).toBe(4_200);
  });

  it('reads every negative convention aggregator exports use', () => {
    expect(parseAmountToMinor('-12.34', 'AED')).toBe(-1_234);
    expect(parseAmountToMinor('(12.34)', 'AED')).toBe(-1_234);
    expect(parseAmountToMinor('12.34-', 'AED')).toBe(-1_234);
    expect(parseAmountToMinor('(1,234.56)', 'AED')).toBe(-123_456);
  });

  it('reads a currency code on either side', () => {
    expect(parseAmountToMinor('AED 1234.56', 'AED')).toBe(123_456);
    expect(parseAmountToMinor('1234.56 SAR', 'SAR')).toBe(123_456);
  });

  it('reads Arabic-Indic digits from Saudi exports', () => {
    expect(parseAmountToMinor('١٢٣٤.٥٦', 'SAR')).toBe(123_456);
    expect(parseAmountToMinor('۱۲۳۴.۵۶', 'SAR')).toBe(123_456);
  });

  it('distinguishes a decimal comma from a thousands separator', () => {
    expect(parseAmountToMinor('1.234,56', 'AED')).toBe(123_456);
    expect(parseAmountToMinor('12,34', 'AED')).toBe(1_234);
    expect(parseAmountToMinor('1,234', 'AED')).toBe(123_400);
    expect(parseAmountToMinor('1,234,567.89', 'AED')).toBe(123_456_789);
  });

  it('handles three-decimal currencies', () => {
    expect(parseAmountToMinor('12.345', 'KWD')).toBe(12_345);
    expect(parseAmountToMinor('12.34', 'KWD')).toBe(12_340);
  });

  it('returns null rather than guessing, so the row becomes a parse failure', () => {
    // A zero here would silently understate what the restaurant is owed.
    expect(parseAmountToMinor('', 'AED')).toBeNull();
    expect(parseAmountToMinor('n/a', 'AED')).toBeNull();
    expect(parseAmountToMinor('--', 'AED')).toBeNull();
    expect(parseAmountToMinor('1234.567', 'AED')).toBeNull();
    expect(parseAmountToMinor('12.3.4', 'AED')).toBeNull();
  });
});
