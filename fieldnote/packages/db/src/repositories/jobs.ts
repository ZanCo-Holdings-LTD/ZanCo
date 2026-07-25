import { eq, sql } from 'drizzle-orm';
import type { JobKind } from '@fieldnote/shared';
import type { Database } from '../client.js';
import { jobs, type Job } from '../schema/jobs.js';

export interface EnqueueInput {
  orgId: string;
  kind: JobKind;
  payload: Record<string, unknown>;
  /** Natural key for the unit of work; a repeat enqueue is a no-op. */
  idempotencyKey: string;
  runAfter?: Date;
  maxAttempts?: number;
}

export async function enqueue(db: Database, input: EnqueueInput): Promise<string | null> {
  const [row] = await db
    .insert(jobs)
    .values({
      orgId: input.orgId,
      kind: input.kind,
      payload: input.payload,
      idempotencyKey: input.idempotencyKey,
      runAfter: input.runAfter ?? new Date(),
      maxAttempts: input.maxAttempts ?? 5,
    })
    .onConflictDoNothing({ target: [jobs.kind, jobs.idempotencyKey] })
    .returning({ id: jobs.id });

  // Null means the job was already queued. That is a success, not an error.
  return row?.id ?? null;
}

/**
 * Claim up to `batchSize` ready jobs for this worker.
 *
 * Delegates to `claim_jobs`, which uses FOR UPDATE SKIP LOCKED and reclaims
 * expired leases in the same call.
 */
export async function claim(
  db: Database,
  workerId: string,
  batchSize: number,
  leaseSeconds = 300,
): Promise<Job[]> {
  const rows = await db.execute<Job>(
    sql`select * from public.claim_jobs(${workerId}, ${batchSize}, ${leaseSeconds})`,
  );
  return [...rows];
}

export async function succeed(db: Database, jobId: string): Promise<void> {
  await db
    .update(jobs)
    .set({ state: 'succeeded', finishedAt: new Date(), lockedAt: null, lockedBy: null })
    .where(eq(jobs.id, jobId));
}

/**
 * Record a failure and decide whether to retry.
 *
 * Exponential backoff with a ceiling; once `maxAttempts` is spent the job goes
 * to `dead` rather than retrying forever. A dead job is visible in the report's
 * status so a stuck survey is never silently stuck.
 */
export async function fail(
  db: Database,
  job: Pick<Job, 'id' | 'attempts' | 'maxAttempts'>,
  error: string,
  retryable: boolean,
): Promise<'retrying' | 'dead'> {
  const exhausted = !retryable || job.attempts >= job.maxAttempts;

  if (exhausted) {
    await db
      .update(jobs)
      .set({
        state: 'dead',
        lastError: error.slice(0, 2000),
        finishedAt: new Date(),
        lockedAt: null,
        lockedBy: null,
      })
      .where(eq(jobs.id, job.id));
    return 'dead';
  }

  const backoffSeconds = Math.min(2 ** job.attempts * 5, 600);
  await db
    .update(jobs)
    .set({
      state: 'queued',
      lastError: error.slice(0, 2000),
      runAfter: new Date(Date.now() + backoffSeconds * 1000),
      lockedAt: null,
      lockedBy: null,
    })
    .where(eq(jobs.id, job.id));
  return 'retrying';
}

export interface QueueDepth {
  queued: number;
  running: number;
  dead: number;
  oldestQueuedAgeSeconds: number | null;
}

/** Exposed on the worker's /health so a backed-up queue is visible to alerting. */
export async function depth(db: Database): Promise<QueueDepth> {
  const rows = await db.execute<{
    state: string;
    count: string;
    oldest_seconds: string | null;
  }>(sql`
    select state,
           count(*) as count,
           extract(epoch from (now() - min(run_after))) as oldest_seconds
      from jobs
     where state in ('queued', 'running', 'dead')
     group by state
  `);

  const result: QueueDepth = { queued: 0, running: 0, dead: 0, oldestQueuedAgeSeconds: null };
  for (const row of rows) {
    const count = Number(row.count);
    if (row.state === 'queued') {
      result.queued = count;
      result.oldestQueuedAgeSeconds = row.oldest_seconds ? Number(row.oldest_seconds) : null;
    } else if (row.state === 'running') {
      result.running = count;
    } else if (row.state === 'dead') {
      result.dead = count;
    }
  }
  return result;
}

/** Requeue a dead job after the underlying cause has been fixed. */
export async function revive(db: Database, jobId: string): Promise<void> {
  await db
    .update(jobs)
    .set({ state: 'queued', attempts: 0, runAfter: new Date(), lastError: null })
    .where(eq(jobs.id, jobId));
}
