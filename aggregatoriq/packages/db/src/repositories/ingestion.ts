/**
 * The raw layer: source documents and source rows.
 *
 * Writes here are append-only and checksum-deduplicated. Re-uploading the same
 * statement — which restaurants do constantly, because forwarding the same email
 * twice costs nothing — must not double-count a month's commission.
 */
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';
import type { ParseMethod, ParseStatus, PlainDate, ReceivedVia, SourceDocumentKind } from '@aggregatoriq/core';
import type { Transaction } from '../client.js';
import { ingestionAddresses, sourceDocuments, sourceRows } from '../schema.js';

export function checksumOf(content: Buffer | string): string {
  return createHash('sha256').update(content).digest('hex');
}

export interface RegisterDocumentInput {
  orgId: string | null;
  branchId: string | null;
  aggregatorId: string | null;
  kind: SourceDocumentKind;
  storagePath: string;
  originalFilename: string | null;
  receivedVia: ReceivedVia;
  checksum: string;
  byteSize: number;
  auditToken?: string | null;
}

export interface RegisterDocumentResult {
  id: string;
  /** True when this exact file has already been ingested for this organisation. */
  duplicate: boolean;
}

/**
 * Register an uploaded or emailed document.
 *
 * Returns the existing row rather than raising when the checksum has been seen
 * before, so a duplicate forward is a no-op the UI can report plainly ("we
 * already have this statement") instead of an error the user has to interpret.
 */
export async function registerSourceDocument(
  tx: Transaction,
  input: RegisterDocumentInput,
): Promise<RegisterDocumentResult> {
  if (input.orgId !== null) {
    const [existing] = await tx
      .select({ id: sourceDocuments.id })
      .from(sourceDocuments)
      .where(
        and(eq(sourceDocuments.orgId, input.orgId), eq(sourceDocuments.checksum, input.checksum)),
      )
      .limit(1);

    if (existing) return { id: existing.id, duplicate: true };
  }

  const [created] = await tx
    .insert(sourceDocuments)
    .values({
      orgId: input.orgId,
      branchId: input.branchId,
      aggregatorId: input.aggregatorId,
      kind: input.kind,
      storagePath: input.storagePath,
      originalFilename: input.originalFilename,
      receivedVia: input.receivedVia,
      checksum: input.checksum,
      byteSize: input.byteSize,
      auditToken: input.auditToken ?? null,
    })
    .returning({ id: sourceDocuments.id });

  if (!created) throw new Error('Source document insert returned no row');
  return { id: created.id, duplicate: false };
}

/**
 * Write the raw rows exactly as they arrived.
 *
 * Inserted in one statement per batch and never updated afterwards — a database
 * trigger rejects any attempt. A parser fix is a replay into a new canonical
 * set, not an edit of what the aggregator sent.
 */
export async function insertSourceRows(
  tx: Transaction,
  input: {
    sourceDocumentId: string;
    orgId: string | null;
    rows: readonly Record<string, unknown>[];
  },
): Promise<string[]> {
  if (input.rows.length === 0) return [];

  const created = await tx
    .insert(sourceRows)
    .values(
      input.rows.map((raw, index) => ({
        sourceDocumentId: input.sourceDocumentId,
        orgId: input.orgId,
        rowIndex: index,
        raw,
      })),
    )
    .onConflictDoNothing({ target: [sourceRows.sourceDocumentId, sourceRows.rowIndex] })
    .returning({ id: sourceRows.id });

  return created.map((row) => row.id);
}

export async function listSourceRows(
  tx: Transaction,
  sourceDocumentId: string,
): Promise<{ id: string; rowIndex: number; raw: unknown }[]> {
  return tx
    .select({ id: sourceRows.id, rowIndex: sourceRows.rowIndex, raw: sourceRows.raw })
    .from(sourceRows)
    .where(eq(sourceRows.sourceDocumentId, sourceDocumentId))
    .orderBy(asc(sourceRows.rowIndex));
}

/**
 * Resolve source rows by id, for the drill-through panel.
 *
 * This is the query behind the feature the brief calls trust-building: from a
 * variance, to the exact rows of the exact document that produced it.
 */
export async function getSourceRowsByIds(
  tx: Transaction,
  ids: readonly string[],
): Promise<
  {
    id: string;
    rowIndex: number;
    raw: unknown;
    sourceDocumentId: string;
    originalFilename: string | null;
    receivedVia: ReceivedVia;
    periodStart: PlainDate | null;
    periodEnd: PlainDate | null;
  }[]
> {
  if (ids.length === 0) return [];

  return tx
    .select({
      id: sourceRows.id,
      rowIndex: sourceRows.rowIndex,
      raw: sourceRows.raw,
      sourceDocumentId: sourceRows.sourceDocumentId,
      originalFilename: sourceDocuments.originalFilename,
      receivedVia: sourceDocuments.receivedVia,
      periodStart: sourceDocuments.periodStart,
      periodEnd: sourceDocuments.periodEnd,
    })
    .from(sourceRows)
    .innerJoin(sourceDocuments, eq(sourceDocuments.id, sourceRows.sourceDocumentId))
    .where(sql`${sourceRows.id} = any(${sql.param(ids)}::uuid[])`)
    .orderBy(asc(sourceRows.sourceDocumentId), asc(sourceRows.rowIndex));
}

export async function recordParseResult(
  tx: Transaction,
  input: {
    documentId: string;
    parseStatus: ParseStatus;
    parseMethod: ParseMethod | null;
    parserKey: string | null;
    parserVersion: string | null;
    headerFingerprint: string | null;
    periodStart: PlainDate | null;
    periodEnd: PlainDate | null;
    rowCount: number;
    parseError: string | null;
    kind?: SourceDocumentKind;
  },
): Promise<void> {
  await tx
    .update(sourceDocuments)
    .set({
      parseStatus: input.parseStatus,
      parseMethod: input.parseMethod,
      parserKey: input.parserKey,
      parserVersion: input.parserVersion,
      headerFingerprint: input.headerFingerprint,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      rowCount: input.rowCount,
      parseError: input.parseError,
      parsedAt: sql`now()`,
      ...(input.kind ? { kind: input.kind } : {}),
    })
    .where(eq(sourceDocuments.id, input.documentId));
}

export interface StatementSummary {
  id: string;
  branchId: string | null;
  aggregatorId: string | null;
  kind: SourceDocumentKind;
  originalFilename: string | null;
  receivedVia: ReceivedVia;
  receivedAt: Date;
  periodStart: PlainDate | null;
  periodEnd: PlainDate | null;
  parseStatus: ParseStatus;
  parseMethod: ParseMethod | null;
  parseError: string | null;
  rowCount: number;
}

export async function listStatements(
  tx: Transaction,
  orgId: string,
  filters: { branchId?: string; aggregatorId?: string } = {},
): Promise<StatementSummary[]> {
  const conditions = [eq(sourceDocuments.orgId, orgId)];
  if (filters.branchId) conditions.push(eq(sourceDocuments.branchId, filters.branchId));
  if (filters.aggregatorId) conditions.push(eq(sourceDocuments.aggregatorId, filters.aggregatorId));

  return tx
    .select({
      id: sourceDocuments.id,
      branchId: sourceDocuments.branchId,
      aggregatorId: sourceDocuments.aggregatorId,
      kind: sourceDocuments.kind,
      originalFilename: sourceDocuments.originalFilename,
      receivedVia: sourceDocuments.receivedVia,
      receivedAt: sourceDocuments.receivedAt,
      periodStart: sourceDocuments.periodStart,
      periodEnd: sourceDocuments.periodEnd,
      parseStatus: sourceDocuments.parseStatus,
      parseMethod: sourceDocuments.parseMethod,
      parseError: sourceDocuments.parseError,
      rowCount: sourceDocuments.rowCount,
    })
    .from(sourceDocuments)
    .where(and(...conditions))
    .orderBy(desc(sourceDocuments.receivedAt));
}

// ---------------------------------------------------------------------------
// Inbound email addresses
// ---------------------------------------------------------------------------

/**
 * Generate a local part for an ingestion address.
 *
 * Random rather than derived: this is an unauthenticated endpoint that accepts
 * files, and a guessable address is an invitation to poison a customer's data.
 * Base32-ish alphabet with no vowels, so a generated address cannot spell
 * anything and is easy to read aloud on the phone.
 */
export function generateLocalPart(): string {
  const alphabet = '23456789bcdfghjkmnpqrstvwxz';
  const bytes = randomBytes(10);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}

export async function ensureIngestionAddress(
  tx: Transaction,
  input: { orgId: string; branchId: string; aggregatorId: string },
): Promise<string> {
  const [existing] = await tx
    .select({ localPart: ingestionAddresses.localPart })
    .from(ingestionAddresses)
    .where(
      and(
        eq(ingestionAddresses.branchId, input.branchId),
        eq(ingestionAddresses.aggregatorId, input.aggregatorId),
      ),
    )
    .limit(1);

  if (existing) return existing.localPart;

  const localPart = generateLocalPart();
  await tx.insert(ingestionAddresses).values({
    orgId: input.orgId,
    branchId: input.branchId,
    aggregatorId: input.aggregatorId,
    localPart,
  });
  return localPart;
}

export async function resolveIngestionAddress(
  tx: Transaction,
  localPart: string,
): Promise<{ orgId: string; branchId: string; aggregatorId: string } | null> {
  const [row] = await tx
    .select({
      orgId: ingestionAddresses.orgId,
      branchId: ingestionAddresses.branchId,
      aggregatorId: ingestionAddresses.aggregatorId,
    })
    .from(ingestionAddresses)
    .where(
      and(eq(ingestionAddresses.localPart, localPart), eq(ingestionAddresses.isActive, true)),
    )
    .limit(1);

  return row ?? null;
}

export async function recordIngestionReceipt(
  tx: Transaction,
  localPart: string,
): Promise<void> {
  await tx
    .update(ingestionAddresses)
    .set({
      lastReceivedAt: sql`now()`,
      receivedCount: sql`${ingestionAddresses.receivedCount} + 1`,
    })
    .where(eq(ingestionAddresses.localPart, localPart));
}

export async function listIngestionAddresses(
  tx: Transaction,
  orgId: string,
): Promise<
  { branchId: string; aggregatorId: string; localPart: string; receivedCount: number }[]
> {
  return tx
    .select({
      branchId: ingestionAddresses.branchId,
      aggregatorId: ingestionAddresses.aggregatorId,
      localPart: ingestionAddresses.localPart,
      receivedCount: ingestionAddresses.receivedCount,
    })
    .from(ingestionAddresses)
    .where(eq(ingestionAddresses.orgId, orgId));
}
