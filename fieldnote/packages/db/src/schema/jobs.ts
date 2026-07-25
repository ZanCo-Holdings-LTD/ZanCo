import { index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { jobKindEnum, jobStateEnum } from './enums.js';
import { organisations } from './orgs.js';

/**
 * Postgres-backed job queue.
 *
 * A separate broker would be one more thing to run, monitor and pay for at a
 * volume that does not need it. Claiming uses `FOR UPDATE SKIP LOCKED`, which
 * gives correct at-least-once semantics across as many worker processes as we
 * care to run. Revisit if sustained throughput ever exceeds a few hundred jobs
 * a second — it will not for a long time.
 */
export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    kind: jobKindEnum('kind').notNull(),
    state: jobStateEnum('state').notNull().default('queued'),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    /**
     * Natural key for the unit of work. A unique index over
     * (kind, idempotency_key) makes double-enqueue a no-op, which matters
     * because the phone retries uploads aggressively.
     */
    idempotencyKey: text('idempotency_key').notNull(),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    runAfter: timestamp('run_after', { withTimezone: true }).notNull().defaultNow(),
    /** Held by the claiming worker; a stale lease is reclaimable. */
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    lockedBy: text('locked_by'),
    lastError: text('last_error'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // The claim query's covering index: ready jobs, oldest first.
    claimIdx: index('jobs_claim_idx').on(table.state, table.runAfter),
    orgIdx: index('jobs_org_idx').on(table.orgId),
    lockedIdx: index('jobs_locked_idx').on(table.lockedAt),
  }),
);

export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
