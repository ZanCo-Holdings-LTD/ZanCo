import { and, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import type { ReportStatus } from '@fieldnote/shared';
import type { Database } from '../client.js';
import { reports } from '../schema/reports.js';
import { templates } from '../schema/templates.js';

export interface ListReportsOptions {
  status?: ReportStatus;
  /** Matches address, client name or reference. */
  search?: string;
  limit?: number;
  offset?: number;
}

const notDeleted = isNull(reports.deletedAt);

export async function list(db: Database, orgId: string, options: ListReportsOptions = {}) {
  const { status, search, limit = 25, offset = 0 } = options;

  const filters = [eq(reports.orgId, orgId), notDeleted];
  if (status) filters.push(eq(reports.status, status));
  if (search?.trim()) {
    const pattern = `%${search.trim()}%`;
    const matches = or(
      ilike(reports.propertyAddress, pattern),
      ilike(reports.clientName, pattern),
      ilike(reports.reference, pattern),
    );
    if (matches) filters.push(matches);
  }

  return db
    .select({
      id: reports.id,
      status: reports.status,
      propertyAddress: reports.propertyAddress,
      clientName: reports.clientName,
      clientEmail: reports.clientEmail,
      reference: reports.reference,
      inspectedAt: reports.inspectedAt,
      createdAt: reports.createdAt,
      updatedAt: reports.updatedAt,
      ownerId: reports.ownerId,
      templateName: templates.name,
    })
    .from(reports)
    .innerJoin(templates, eq(templates.id, reports.templateId))
    .where(and(...filters))
    .orderBy(desc(reports.createdAt))
    .limit(Math.min(limit, 100))
    .offset(offset);
}

/** Counts per status for the dashboard chips, in one round trip. */
export async function statusCounts(
  db: Database,
  orgId: string,
): Promise<Record<ReportStatus, number>> {
  const rows = await db.execute<{ status: ReportStatus; count: string }>(
    sql`select status, count from public.report_status_counts(${orgId})`,
  );
  const counts = {
    draft: 0,
    processing: 0,
    needs_review: 0,
    ready: 0,
    sent: 0,
  } as Record<ReportStatus, number>;
  for (const row of rows) counts[row.status] = Number(row.count);
  return counts;
}

export async function findById(db: Database, orgId: string, reportId: string) {
  const [row] = await db
    .select()
    .from(reports)
    .where(and(eq(reports.id, reportId), eq(reports.orgId, orgId), notDeleted))
    .limit(1);
  return row ?? null;
}

export interface CreateReportInput {
  orgId: string;
  ownerId: string;
  templateId: string;
  propertyAddress: string;
  clientName?: string | null;
  clientEmail?: string | null;
  reference?: string | null;
  inspectedAt?: Date | null;
}

export async function create(db: Database, input: CreateReportInput): Promise<string> {
  const [template] = await db
    .select({ version: templates.version })
    .from(templates)
    .where(eq(templates.id, input.templateId))
    .limit(1);
  if (!template) throw new Error(`Template ${input.templateId} not found`);

  const [row] = await db
    .insert(reports)
    .values({
      orgId: input.orgId,
      ownerId: input.ownerId,
      templateId: input.templateId,
      // Pinned so a later template revision cannot reshape a live report.
      templateVersion: template.version,
      propertyAddress: input.propertyAddress,
      clientName: input.clientName ?? null,
      clientEmail: input.clientEmail ?? null,
      reference: input.reference ?? null,
      inspectedAt: input.inspectedAt ?? null,
    })
    .returning({ id: reports.id });

  if (!row) throw new Error('Failed to create report');
  return row.id;
}

export async function updateMetadata(
  db: Database,
  orgId: string,
  reportId: string,
  patch: Partial<Pick<CreateReportInput, 'propertyAddress' | 'clientName' | 'clientEmail' | 'reference' | 'inspectedAt'>>,
): Promise<void> {
  await db
    .update(reports)
    .set(patch)
    .where(and(eq(reports.id, reportId), eq(reports.orgId, orgId)));
}

/**
 * Status transitions.
 *
 * Reports only move forward. Attempting to move a sent report back to draft is
 * a bug in the caller, so it throws rather than silently doing nothing.
 */
const ALLOWED_TRANSITIONS: Record<ReportStatus, ReportStatus[]> = {
  draft: ['processing', 'needs_review'],
  processing: ['needs_review', 'draft'],
  needs_review: ['ready', 'processing'],
  ready: ['sent', 'needs_review'],
  sent: ['needs_review'],
};

export async function setStatus(
  db: Database,
  orgId: string,
  reportId: string,
  next: ReportStatus,
): Promise<void> {
  const current = await findById(db, orgId, reportId);
  if (!current) throw new Error(`Report ${reportId} not found`);
  if (current.status === next) return;

  if (!ALLOWED_TRANSITIONS[current.status].includes(next)) {
    throw new Error(`Cannot move report from ${current.status} to ${next}`);
  }

  await db
    .update(reports)
    .set({ status: next })
    .where(and(eq(reports.id, reportId), eq(reports.orgId, orgId)));
}

/**
 * Soft delete. The audio, transcripts and generated-versus-final history are
 * the liability record, so a delete hides the report rather than destroying
 * evidence. Hard deletion happens only through account deletion.
 */
export async function softDelete(db: Database, orgId: string, reportId: string): Promise<void> {
  await db
    .update(reports)
    .set({ deletedAt: new Date() })
    .where(and(eq(reports.id, reportId), eq(reports.orgId, orgId)));
}

/** Reports delivered within 48 hours of a user's first sign-in. */
export async function activationWindowCount(
  db: Database,
  orgId: string,
  since: Date,
): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(reports)
    .where(
      and(
        eq(reports.orgId, orgId),
        eq(reports.status, 'sent'),
        sql`${reports.createdAt} >= ${since}`,
      ),
    );
  return row?.count ?? 0;
}
