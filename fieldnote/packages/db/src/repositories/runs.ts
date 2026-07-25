import { desc, eq } from 'drizzle-orm';
import type { Database } from '../client.js';
import { reconRuns } from '../schema/runs.js';

export interface StartRunInput {
  orgId: string;
  reportId: string;
  engineVersion: string;
  modelVersion: string;
  promptVersion: string;
  sectionsTotal: number;
}

export async function start(db: Database, input: StartRunInput): Promise<string> {
  const [row] = await db.insert(reconRuns).values(input).returning({ id: reconRuns.id });
  if (!row) throw new Error('Failed to start recon run');
  return row.id;
}

export async function recordSection(
  db: Database,
  runId: string,
  ungroundedCount: number,
): Promise<void> {
  const [current] = await db
    .select({ done: reconRuns.sectionsDone, ungrounded: reconRuns.ungroundedFields })
    .from(reconRuns)
    .where(eq(reconRuns.id, runId))
    .limit(1);
  if (!current) return;

  await db
    .update(reconRuns)
    .set({
      sectionsDone: current.done + 1,
      ungroundedFields: current.ungrounded + ungroundedCount,
    })
    .where(eq(reconRuns.id, runId));
}

export async function finish(
  db: Database,
  runId: string,
  status: 'succeeded' | 'failed',
): Promise<void> {
  await db
    .update(reconRuns)
    .set({ status, finishedAt: new Date() })
    .where(eq(reconRuns.id, runId));
}

/** Run history for a report, newest first. Surfaced in the review workspace. */
export async function listForReport(db: Database, reportId: string) {
  return db
    .select()
    .from(reconRuns)
    .where(eq(reconRuns.reportId, reportId))
    .orderBy(desc(reconRuns.startedAt))
    .limit(20);
}
