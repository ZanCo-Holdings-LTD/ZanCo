import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { organisations } from './orgs.js';

/**
 * Append-only audit log.
 *
 * Insert-only by policy — there is no update or delete grant on this table for
 * any application role. If a fabricated finding is ever alleged, this plus the
 * immutable `generated_value` column is the record that answers it.
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    actorId: uuid('actor_id'),
    /** e.g. report.exported, value.edited, delivery.sent, member.removed */
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    orgCreatedIdx: index('audit_log_org_created_idx').on(table.orgId, table.createdAt),
    entityIdx: index('audit_log_entity_idx').on(table.entityType, table.entityId),
  }),
);

export type AuditLogEntry = typeof auditLog.$inferSelect;
export type NewAuditLogEntry = typeof auditLog.$inferInsert;
