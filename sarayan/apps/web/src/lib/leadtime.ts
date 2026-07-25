import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { leadTimeObservations } from "@/db/schema";
import { documentType } from "@/content/taxonomy";

/**
 * Renewal lead-time prediction.
 *
 * "Statistics over your own completed renewal tasks, not a model." And below
 * fifty observations the hand-curated default wins outright — a median over
 * four renewals is noise wearing a number's clothes.
 */

export const MIN_OBSERVATIONS = 50;

export interface LeadTimeEstimate {
  days: number;
  source: "curated" | "learned";
  observations: number;
  /** 80th percentile, shown as the "plan for" figure. */
  p80: number | null;
}

export async function estimateLeadTime(documentTypeCode: string): Promise<LeadTimeEstimate> {
  const curated = documentType(documentTypeCode)?.renewalLeadDays ?? 30;

  const rows = await db
    .select({ observedDays: leadTimeObservations.observedDays })
    .from(leadTimeObservations)
    .where(eq(leadTimeObservations.documentTypeCode, documentTypeCode));

  if (rows.length < MIN_OBSERVATIONS) {
    return { days: curated, source: "curated", observations: rows.length, p80: null };
  }

  const sorted = rows.map((row) => row.observedDays).sort((a, b) => a - b);
  return {
    days: percentile(sorted, 0.5),
    source: "learned",
    observations: sorted.length,
    p80: percentile(sorted, 0.8),
  };
}

/** Batch variant, so the renewals list does not issue one query per row. */
export async function estimateLeadTimes(codes: string[]): Promise<Map<string, LeadTimeEstimate>> {
  const unique = [...new Set(codes)];
  const result = new Map<string, LeadTimeEstimate>();
  if (unique.length === 0) return result;

  const rows = await db
    .select({
      code: leadTimeObservations.documentTypeCode,
      count: sql<number>`count(*)::int`,
      median: sql<number>`percentile_cont(0.5) within group (order by ${leadTimeObservations.observedDays})`,
      p80: sql<number>`percentile_cont(0.8) within group (order by ${leadTimeObservations.observedDays})`,
    })
    .from(leadTimeObservations)
    .where(inArray(leadTimeObservations.documentTypeCode, unique))
    .groupBy(leadTimeObservations.documentTypeCode);

  const stats = new Map(rows.map((row) => [row.code, row]));

  for (const code of unique) {
    const curated = documentType(code)?.renewalLeadDays ?? 30;
    const row = stats.get(code);
    if (!row || row.count < MIN_OBSERVATIONS) {
      result.set(code, {
        days: curated,
        source: "curated",
        observations: row?.count ?? 0,
        p80: null,
      });
    } else {
      result.set(code, {
        days: Math.round(row.median),
        source: "learned",
        observations: row.count,
        p80: Math.round(row.p80),
      });
    }
  }

  return result;
}

/** Record a completed renewal. Anonymised — no organisation id is stored. */
export async function recordObservation(input: {
  documentTypeCode: string;
  country: string;
  observedDays: number;
  cost: string | null;
  currency: string | null;
}): Promise<void> {
  // A renewal "completed" months after it started is usually a stale task
  // being tidied up, not a real lead time. Clamp rather than poison the median.
  if (input.observedDays < 0 || input.observedDays > 365) return;
  await db.insert(leadTimeObservations).values(input);
}

function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return Math.round(sorted[lower]);
  return Math.round(sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower));
}
