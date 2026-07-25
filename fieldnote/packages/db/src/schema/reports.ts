import { relations } from 'drizzle-orm';
import { index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { reportStatusEnum } from './enums.js';
import { organisations } from './orgs.js';
import { templates } from './templates.js';

export const reports = pgTable(
  'reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    ownerId: uuid('owner_id').notNull(),
    templateId: uuid('template_id')
      .notNull()
      .references(() => templates.id, { onDelete: 'restrict' }),
    /** Pinned at creation so a template revision never rewrites a live report. */
    templateVersion: integer('template_version').notNull(),
    status: reportStatusEnum('status').notNull().default('draft'),
    propertyAddress: text('property_address').notNull(),
    clientName: text('client_name'),
    clientEmail: text('client_email'),
    reference: text('reference'),
    inspectedAt: timestamp('inspected_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    orgIdx: index('reports_org_idx').on(table.orgId),
    // The dashboard's default query: this org, newest first, not deleted.
    orgCreatedIdx: index('reports_org_created_idx').on(table.orgId, table.createdAt),
    statusIdx: index('reports_org_status_idx').on(table.orgId, table.status),
    ownerIdx: index('reports_owner_idx').on(table.ownerId),
  }),
);

export const reportsRelations = relations(reports, ({ one }) => ({
  organisation: one(organisations, {
    fields: [reports.orgId],
    references: [organisations.id],
  }),
  template: one(templates, {
    fields: [reports.templateId],
    references: [templates.id],
  }),
}));

export type Report = typeof reports.$inferSelect;
export type NewReport = typeof reports.$inferInsert;
