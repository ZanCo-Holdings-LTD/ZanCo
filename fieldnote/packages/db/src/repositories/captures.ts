import { and, asc, eq } from 'drizzle-orm';
import type { Transcript, UploadState } from '@fieldnote/shared';
import type { Database } from '../client.js';
import { captures, mediaAssets } from '../schema/captures.js';

export interface RegisterCaptureInput {
  orgId: string;
  reportId: string;
  /** Client-generated id. Makes a retried upload idempotent. */
  clientId: string;
  storagePath: string;
  durationMs: number;
  sectionKey?: string | null;
  localTranscript?: string | null;
}

/**
 * Record an uploaded capture.
 *
 * The phone retries uploads across app restarts and network changes, so this
 * has to be safe to call repeatedly with the same clientId.
 */
export async function register(db: Database, input: RegisterCaptureInput): Promise<string> {
  const [row] = await db
    .insert(captures)
    .values({
      orgId: input.orgId,
      reportId: input.reportId,
      clientId: input.clientId,
      storagePath: input.storagePath,
      durationMs: input.durationMs,
      sectionKey: input.sectionKey ?? null,
      localTranscript: input.localTranscript ?? null,
      uploadState: 'uploaded',
    })
    .onConflictDoUpdate({
      target: [captures.reportId, captures.clientId],
      set: {
        storagePath: input.storagePath,
        durationMs: input.durationMs,
        uploadState: 'uploaded',
      },
    })
    .returning({ id: captures.id });

  if (!row) throw new Error('Failed to register capture');
  return row.id;
}

export async function listForReport(db: Database, reportId: string) {
  return db
    .select()
    .from(captures)
    .where(eq(captures.reportId, reportId))
    .orderBy(asc(captures.createdAt));
}

export async function findById(db: Database, captureId: string) {
  const [row] = await db.select().from(captures).where(eq(captures.id, captureId)).limit(1);
  return row ?? null;
}

export async function setUploadState(
  db: Database,
  captureId: string,
  state: UploadState,
): Promise<void> {
  await db.update(captures).set({ uploadState: state }).where(eq(captures.id, captureId));
}

/**
 * Store the cloud transcript. The on-device draft is left untouched — both are
 * kept, because the raw transcript is the provenance source.
 */
export async function attachTranscript(
  db: Database,
  captureId: string,
  transcript: Transcript,
): Promise<void> {
  await db
    .update(captures)
    .set({
      cloudTranscript: transcript,
      asrProvider: transcript.provider,
      asrModel: transcript.model,
      transcribedAt: new Date(),
      durationMs: transcript.durationMs,
    })
    .where(eq(captures.id, captureId));
}

/** True once every capture on the report has a cloud transcript. */
export async function allTranscribed(db: Database, reportId: string): Promise<boolean> {
  const rows = await db
    .select({ transcribedAt: captures.transcribedAt })
    .from(captures)
    .where(eq(captures.reportId, reportId));
  return rows.length > 0 && rows.every((row) => row.transcribedAt !== null);
}

export interface AttachPhotoInput {
  orgId: string;
  reportId: string;
  clientId: string;
  storagePath: string;
  captureId?: string | null;
  sectionKey?: string | null;
  caption?: string | null;
  capturedAt?: Date | null;
  captureOffsetMs?: number | null;
  exif?: Record<string, unknown> | null;
  orderIndex?: number;
}

export async function attachPhoto(db: Database, input: AttachPhotoInput): Promise<string> {
  const [row] = await db
    .insert(mediaAssets)
    .values({
      orgId: input.orgId,
      reportId: input.reportId,
      clientId: input.clientId,
      storagePath: input.storagePath,
      captureId: input.captureId ?? null,
      sectionKey: input.sectionKey ?? null,
      caption: input.caption ?? null,
      capturedAt: input.capturedAt ?? null,
      captureOffsetMs: input.captureOffsetMs ?? null,
      exif: input.exif ?? null,
      orderIndex: input.orderIndex ?? 0,
    })
    .onConflictDoUpdate({
      target: [mediaAssets.reportId, mediaAssets.clientId],
      set: { storagePath: input.storagePath, caption: input.caption ?? null },
    })
    .returning({ id: mediaAssets.id });

  if (!row) throw new Error('Failed to attach photo');
  return row.id;
}

export async function listPhotos(db: Database, reportId: string, sectionKey?: string) {
  const where = sectionKey
    ? and(eq(mediaAssets.reportId, reportId), eq(mediaAssets.sectionKey, sectionKey))
    : eq(mediaAssets.reportId, reportId);

  return db
    .select()
    .from(mediaAssets)
    .where(where)
    .orderBy(asc(mediaAssets.orderIndex), asc(mediaAssets.capturedAt));
}

export async function updateCaption(
  db: Database,
  orgId: string,
  assetId: string,
  caption: string,
): Promise<void> {
  await db
    .update(mediaAssets)
    .set({ caption })
    .where(and(eq(mediaAssets.id, assetId), eq(mediaAssets.orgId, orgId)));
}

export async function deletePhoto(db: Database, orgId: string, assetId: string): Promise<void> {
  await db
    .delete(mediaAssets)
    .where(and(eq(mediaAssets.id, assetId), eq(mediaAssets.orgId, orgId)));
}
