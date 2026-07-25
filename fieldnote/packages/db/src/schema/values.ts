import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import type { SourceSpan } from '@fieldnote/shared';
import { organisations } from './orgs.js';
import { reports } from './reports.js';
import { templateFields } from './templates.js';

/**
 * One value per template field per report.
 *
 * `generatedValue` is immutable: it records exactly what the model produced,
 * forever, next to whatever the human ended up signing. That pairing is both
 * the audit trail for a professional indemnity claim and the training signal
 * for the phrase corpus.
 */
export const reportValues = pgTable(
  'report_values',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    reportId: uuid('report_id')
      .notNull()
      .references(() => reports.id, { onDelete: 'cascade' }),
    fieldId: uuid('field_id')
      .notNull()
      .references(() => templateFields.id, { onDelete: 'cascade' }),

    /** Current value. This is what renders into the PDF. */
    value: jsonb('value').$type<unknown>(),
    /** What the model produced. Never updated after the first write. */
    generatedValue: jsonb('generated_value').$type<unknown>(),

    confidence: numeric('confidence', { precision: 4, scale: 3 }),
    sourceSpan: jsonb('source_span').$type<SourceSpan | null>(),

    modelVersion: text('model_version'),
    promptVersion: text('prompt_version'),
    /**
     * Release that produced this value. With model and prompt version, any
     * historical row traces to the exact code that generated it — required
     * once the code that made it has been deployed over.
     */
    engineVersion: text('engine_version'),

    editedByHuman: boolean('edited_by_human').notNull().default(false),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewedBy: uuid('reviewed_by'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    reportIdx: index('report_values_report_idx').on(table.reportId),
    orgIdx: index('report_values_org_idx').on(table.orgId),
    fieldUnique: unique('report_values_report_field_unique').on(table.reportId, table.fieldId),
  }),
);

export const reportValuesRelations = relations(reportValues, ({ one }) => ({
  report: one(reports, { fields: [reportValues.reportId], references: [reports.id] }),
  field: one(templateFields, {
    fields: [reportValues.fieldId],
    references: [templateFields.id],
  }),
}));

export type ReportValue = typeof reportValues.$inferSelect;
export type NewReportValue = typeof reportValues.$inferInsert;
