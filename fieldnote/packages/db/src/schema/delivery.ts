import { relations } from 'drizzle-orm';
import { index, integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { organisations } from './orgs.js';
import { reports } from './reports.js';

/**
 * An immutable rendered PDF. Version history exists so that "which document did
 * the client actually receive" always has a precise answer.
 */
export const reportVersions = pgTable(
  'report_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    reportId: uuid('report_id')
      .notNull()
      .references(() => reports.id, { onDelete: 'cascade' }),
    versionNo: integer('version_no').notNull(),
    pdfPath: text('pdf_path').notNull(),
    /** Frozen copy of every value at render time, for reproducibility. */
    snapshot: text('snapshot'),
    byteSize: integer('byte_size'),
    engineVersion: text('engine_version'),
    renderedAt: timestamp('rendered_at', { withTimezone: true }).notNull().defaultNow(),
    renderedBy: uuid('rendered_by'),
  },
  (table) => ({
    reportIdx: index('report_versions_report_idx').on(table.reportId),
    versionUnique: unique('report_versions_report_version_unique').on(
      table.reportId,
      table.versionNo,
    ),
  }),
);

/**
 * A delivery record. Reports are never auto-sent — a row here always
 * corresponds to a human pressing send.
 */
export const deliveries = pgTable(
  'deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    reportId: uuid('report_id')
      .notNull()
      .references(() => reports.id, { onDelete: 'cascade' }),
    versionId: uuid('version_id')
      .notNull()
      .references(() => reportVersions.id, { onDelete: 'restrict' }),
    toEmail: text('to_email').notNull(),
    subject: text('subject'),
    message: text('message'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    openedAt: timestamp('opened_at', { withTimezone: true }),
    failedAt: timestamp('failed_at', { withTimezone: true }),
    failureReason: text('failure_reason'),
    providerMessageId: text('provider_message_id'),
    sentBy: uuid('sent_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    reportIdx: index('deliveries_report_idx').on(table.reportId),
    providerIdx: index('deliveries_provider_message_idx').on(table.providerMessageId),
  }),
);

export const reportVersionsRelations = relations(reportVersions, ({ one, many }) => ({
  report: one(reports, { fields: [reportVersions.reportId], references: [reports.id] }),
  deliveries: many(deliveries),
}));

export const deliveriesRelations = relations(deliveries, ({ one }) => ({
  report: one(reports, { fields: [deliveries.reportId], references: [reports.id] }),
  version: one(reportVersions, {
    fields: [deliveries.versionId],
    references: [reportVersions.id],
  }),
  organisation: one(organisations, {
    fields: [deliveries.orgId],
    references: [organisations.id],
  }),
}));

export type ReportVersion = typeof reportVersions.$inferSelect;
export type Delivery = typeof deliveries.$inferSelect;
