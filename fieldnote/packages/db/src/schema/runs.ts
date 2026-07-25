import { index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { organisations } from './orgs.js';
import { reports } from './reports.js';

/**
 * One pass of the pipeline over one report.
 *
 * Makes "why did this report change between Tuesday and Thursday" answerable
 * without diffing two PDFs: each run records the engine, model and prompt
 * versions that produced it, and how many fields failed grounding.
 *
 * Re-running a report on unchanged inputs with the same three versions must
 * produce the same values. That property is what lets a historical result stay
 * explainable after the code has moved on.
 */
export const reconRuns = pgTable(
  'recon_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    reportId: uuid('report_id')
      .notNull()
      .references(() => reports.id, { onDelete: 'cascade' }),
    engineVersion: text('engine_version').notNull(),
    modelVersion: text('model_version'),
    promptVersion: text('prompt_version'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    status: text('status').notNull().default('running'),
    sectionsTotal: integer('sections_total').notNull().default(0),
    sectionsDone: integer('sections_done').notNull().default(0),
    /** Fields the model claimed but could not cite. Should trend to zero. */
    ungroundedFields: integer('ungrounded_fields').notNull().default(0),
  },
  (table) => ({
    reportIdx: index('recon_runs_report_idx').on(table.reportId, table.startedAt),
    orgIdx: index('recon_runs_org_idx').on(table.orgId),
  }),
);

export type ReconRun = typeof reconRuns.$inferSelect;
export type NewReconRun = typeof reconRuns.$inferInsert;
