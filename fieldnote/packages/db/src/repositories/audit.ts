import { and, desc, eq, sql } from 'drizzle-orm';
import type { Database } from '../client.js';
import { auditLog } from '../schema/audit.js';

export type AuditAction =
  | 'org.created'
  | 'member.invited'
  | 'member.removed'
  | 'member.role_changed'
  | 'report.created'
  | 'report.deleted'
  | 'value.edited'
  | 'value.confirmed'
  | 'report.exported'
  | 'delivery.sent'
  | 'template.forked'
  | 'account.deleted';

export interface RecordInput {
  orgId: string;
  actorId: string | null;
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Append to the audit log.
 *
 * The table has no update or delete policy, so entries are permanent. Failing
 * to write an audit entry must not fail the action it describes, but it must
 * be loud — callers pass this through `void record(...)` only where the action
 * has already been committed.
 */
export async function record(db: Database, input: RecordInput): Promise<void> {
  await db.insert(auditLog).values({
    orgId: input.orgId,
    actorId: input.actorId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    metadata: input.metadata ?? null,
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
  });
}

export async function listForEntity(db: Database, entityType: string, entityId: string) {
  return db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.entityType, entityType), eq(auditLog.entityId, entityId)))
    .orderBy(desc(auditLog.createdAt))
    .limit(200);
}

export async function listForOrg(db: Database, orgId: string, limit = 100) {
  return db
    .select()
    .from(auditLog)
    .where(eq(auditLog.orgId, orgId))
    .orderBy(desc(auditLog.createdAt))
    .limit(Math.min(limit, 500));
}

/** Retention sweep. Run from a scheduled job; entries older than the window go. */
export async function pruneOlderThan(db: Database, days: number): Promise<number> {
  const result = await db.execute<{ count: string }>(sql`
    with deleted as (
      delete from audit_log
       where created_at < now() - make_interval(days => ${days})
      returning 1
    )
    select count(*) as count from deleted
  `);
  return Number(result[0]?.count ?? 0);
}
