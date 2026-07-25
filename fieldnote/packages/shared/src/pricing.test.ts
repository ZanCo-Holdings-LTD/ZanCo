import { describe, expect, it } from 'vitest';
import { formatPence, monthlyRevenuePence, PLANS, recommendedPlan } from './pricing.js';
import { costAsShareOfArpu, reportCost } from './cost.js';

describe('recommendedPlan', () => {
  it('uses the founding rate while seats remain', () => {
    expect(recommendedPlan(2, 50)).toBe('founding');
  });

  it('falls back to the team rate at three seats once founding is exhausted', () => {
    expect(recommendedPlan(3, 0)).toBe('team_monthly');
  });

  it('keeps a single seat on solo', () => {
    expect(recommendedPlan(1, 0)).toBe('solo_monthly');
  });

  it('does not apply the founding rate to a team larger than the remaining seats', () => {
    expect(recommendedPlan(10, 4)).toBe('team_monthly');
  });
});

describe('monthlyRevenuePence', () => {
  it('amortises the annual plan across twelve months', () => {
    expect(monthlyRevenuePence('annual', 1)).toBe(Math.round(PLANS.annual.unitAmountPence / 12));
  });

  it('multiplies by seat count', () => {
    expect(monthlyRevenuePence('team_monthly', 5)).toBe(5900 * 5);
  });
});

describe('formatPence', () => {
  it('renders sterling', () => {
    expect(formatPence(6900)).toBe('£69.00');
  });
});

describe('report cost instrumentation', () => {
  const usage = {
    inputTokens: 12_000,
    outputTokens: 1_500,
    cacheReadInputTokens: 40_000,
    cacheCreationInputTokens: 8_000,
    model: 'claude-sonnet-5',
  };

  it('charges cached reads well below base input rate', () => {
    const cheap = reportCost([], [usage]);
    const uncached = reportCost(
      [],
      [{ ...usage, inputTokens: 52_000, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 }],
    );
    expect(cheap.structuringUsd).toBeLessThan(uncached.structuringUsd);
  });

  it('includes transcription minutes in the total', () => {
    const cost = reportCost([40 * 60_000], [usage]);
    expect(cost.transcriptionUsd).toBeGreaterThan(0);
    expect(cost.totalUsd).toBeCloseTo(cost.transcriptionUsd + cost.structuringUsd, 10);
  });

  it('expresses cost as a share of ARPU', () => {
    // £69/month, 5 reports a week ≈ 21 a month.
    const share = costAsShareOfArpu(0.4, 6900, 21);
    expect(share).toBeGreaterThan(0);
    expect(share).toBeLessThan(1);
  });

  it('returns zero share when a customer has produced no reports', () => {
    expect(costAsShareOfArpu(0.4, 6900, 0)).toBe(0);
  });
});
