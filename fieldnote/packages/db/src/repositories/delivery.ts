import { and, desc, eq, isNull } from 'drizzle-orm';
import type { Database } from '../client.js';
import { deliveries, reportVersions } from '../schema/delivery.js';

export interface RecordVersionInput {
  orgId: string;
  reportId: string;
  pdfPath: string;
  snapshot: string;
  byteSize: number;
  /** Release that rendered it, so an old PDF stays attributable. */
  engineVersion: string;
  renderedBy: string | null;
}

/**
 * Record a rendered PDF. The version number is assigned by a database trigger
 * under a unique constraint, so two concurrent exports cannot both claim v3.
 */
export async function recordVersion(
  db: Database,
  input: RecordVersionInput,
): Promise<{ id: string; versionNo: number }> {
  const [row] = await db
    .insert(reportVersions)
    .values({
      orgId: input.orgId,
      reportId: input.reportId,
      // Overwritten by assign_report_version_no().
      versionNo: 0,
      pdfPath: input.pdfPath,
      snapshot: input.snapshot,
      byteSize: input.byteSize,
      engineVersion: input.engineVersion,
      renderedBy: input.renderedBy,
    })
    .returning({ id: reportVersions.id, versionNo: reportVersions.versionNo });

  if (!row) throw new Error('Failed to record report version');
  return row;
}

export async function listVersions(db: Database, reportId: string) {
  return db
    .select()
    .from(reportVersions)
    .where(eq(reportVersions.reportId, reportId))
    .orderBy(desc(reportVersions.versionNo));
}

export async function latestVersion(db: Database, reportId: string) {
  const [row] = await db
    .select()
    .from(reportVersions)
    .where(eq(reportVersions.reportId, reportId))
    .orderBy(desc(reportVersions.versionNo))
    .limit(1);
  return row ?? null;
}

export interface CreateDeliveryInput {
  orgId: string;
  reportId: string;
  versionId: string;
  toEmail: string;
  subject: string;
  message: string | null;
  sentBy: string;
}

/**
 * Create a delivery record in the pending state.
 *
 * The row exists before the send is attempted so that a provider failure is
 * still visible in the report's history rather than vanishing.
 */
export async function createPending(db: Database, input: CreateDeliveryInput): Promise<string> {
  const [row] = await db
    .insert(deliveries)
    .values({
      orgId: input.orgId,
      reportId: input.reportId,
      versionId: input.versionId,
      toEmail: input.toEmail,
      subject: input.subject,
      message: input.message,
      sentBy: input.sentBy,
    })
    .returning({ id: deliveries.id });

  if (!row) throw new Error('Failed to create delivery');
  return row.id;
}

export async function markSent(
  db: Database,
  deliveryId: string,
  providerMessageId: string,
): Promise<void> {
  await db
    .update(deliveries)
    .set({ sentAt: new Date(), providerMessageId })
    .where(eq(deliveries.id, deliveryId));
}

export async function markFailed(db: Database, deliveryId: string, reason: string): Promise<void> {
  await db
    .update(deliveries)
    .set({ failedAt: new Date(), failureReason: reason.slice(0, 500) })
    .where(eq(deliveries.id, deliveryId));
}

/** Called from the Resend webhook. Idempotent: first open wins. */
export async function markOpened(db: Database, providerMessageId: string): Promise<void> {
  await db
    .update(deliveries)
    .set({ openedAt: new Date() })
    .where(and(eq(deliveries.providerMessageId, providerMessageId), isNull(deliveries.openedAt)));
}

export async function listForReport(db: Database, reportId: string) {
  return db
    .select()
    .from(deliveries)
    .where(eq(deliveries.reportId, reportId))
    .orderBy(desc(deliveries.createdAt));
}
