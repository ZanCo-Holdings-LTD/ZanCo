import type { StructuringUsage } from './types.js';

/**
 * Inference cost per report, as a share of ARPU.
 *
 * Long reports from heavy users can invert unit margin, so this is instrumented
 * from the first AI milestone rather than retrofitted. Every structuring call
 * records usage; the worker rolls it up per report and emits an alert above the
 * configured ratio.
 */

/** USD per million tokens. Update alongside any model change. */
export const MODEL_RATES_USD_PER_MTOK: Record<string, { input: number; output: number }> = {
  'claude-sonnet-5': { input: 3.0, output: 15.0 },
  'claude-opus-4-8': { input: 5.0, output: 25.0 },
  'claude-haiku-4-5': { input: 1.0, output: 5.0 },
};

/** Cached reads bill at roughly a tenth of the base input rate. */
const CACHE_READ_MULTIPLIER = 0.1;
/** Cache writes carry a premium over the base input rate. */
const CACHE_WRITE_MULTIPLIER = 1.25;

/** Deepgram Nova pre-recorded, USD per audio minute. */
export const ASR_USD_PER_MINUTE = 0.0043;

export function structuringCostUsd(usage: StructuringUsage): number {
  const rate = MODEL_RATES_USD_PER_MTOK[usage.model];
  if (!rate) return 0;
  const perToken = (rateUsdPerMTok: number) => rateUsdPerMTok / 1_000_000;
  return (
    usage.inputTokens * perToken(rate.input) +
    usage.cacheReadInputTokens * perToken(rate.input) * CACHE_READ_MULTIPLIER +
    usage.cacheCreationInputTokens * perToken(rate.input) * CACHE_WRITE_MULTIPLIER +
    usage.outputTokens * perToken(rate.output)
  );
}

export function transcriptionCostUsd(durationMs: number): number {
  return (durationMs / 60_000) * ASR_USD_PER_MINUTE;
}

export interface ReportCostBreakdown {
  transcriptionUsd: number;
  structuringUsd: number;
  totalUsd: number;
}

export function reportCost(
  captureDurationsMs: number[],
  usages: StructuringUsage[],
): ReportCostBreakdown {
  const transcriptionUsd = captureDurationsMs.reduce(
    (sum, ms) => sum + transcriptionCostUsd(ms),
    0,
  );
  const structuringUsd = usages.reduce((sum, usage) => sum + structuringCostUsd(usage), 0);
  return {
    transcriptionUsd,
    structuringUsd,
    totalUsd: transcriptionUsd + structuringUsd,
  };
}

/**
 * Share of a seat's monthly revenue consumed by inference for one report.
 * Alert when the rolling mean exceeds INFERENCE_COST_ALERT_RATIO.
 */
export function costAsShareOfArpu(
  totalUsd: number,
  monthlyRevenuePence: number,
  reportsPerMonth: number,
  usdPerGbp = 1.27,
): number {
  if (monthlyRevenuePence <= 0 || reportsPerMonth <= 0) return 0;
  const arpuUsdPerReport = (monthlyRevenuePence / 100) * usdPerGbp * (1 / reportsPerMonth);
  return totalUsd / arpuUsdPerReport;
}
