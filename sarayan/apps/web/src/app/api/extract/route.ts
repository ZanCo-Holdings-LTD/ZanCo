import {
  AnthropicVisionProvider,
  ManualEntryProvider,
  processDocument,
  validateUpload,
  type ExtractionProvider,
} from "@sarayan/core-docs";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { extractions, recordFiles, records } from "@/db/schema";
import { DOCUMENT_TYPES, documentTypesFor, toExtractionSchema, type CountryCode } from "@/content/taxonomy";
import { requireSession } from "@/lib/auth";
import { env, features } from "@/lib/env";
import { assertCan } from "@/lib/rbac";
import { putObject, storageKeyFor } from "@/lib/storage";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Upload a document, store it encrypted, and return a review plan.
 *
 * This route never writes to the record. It produces a *proposal* — classified
 * type, extracted fields, per-field confidence — which the confirm route
 * commits only after a human has approved it.
 */
export async function POST(request: Request) {
  let session;
  try {
    session = await requireSession();
    assertCan(session.role, "records.edit");
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Not permitted." },
      { status: 403 },
    );
  }

  if (session.organisation.metadataOnlyMode) {
    return NextResponse.json(
      { error: "This organisation is in metadata-only mode. Files are not stored." },
      { status: 400 },
    );
  }

  const form = await request.formData();
  const file = form.get("file");
  const recordId = String(form.get("recordId") ?? "");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file supplied." }, { status: 400 });
  }

  const validation = validateUpload({ size: file.size, type: file.type, name: file.name });
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const owned = await db
    .select({ id: records.id, documentTypeCode: records.documentTypeCode, entityId: records.entityId })
    .from(records)
    .where(and(eq(records.id, recordId), eq(records.organisationId, session.organisation.id)))
    .limit(1);
  if (owned.length === 0) {
    return NextResponse.json({ error: "Record not found." }, { status: 404 });
  }

  if (!session.organisation.wrappedDataKey) {
    return NextResponse.json(
      { error: "This organisation has no encryption key configured. Contact support." },
      { status: 500 },
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  // Candidates: the record's own type first when it has one, so a re-upload of
  // a known document is not re-classified against 25 alternatives.
  const country = session.organisation.country as CountryCode;
  const candidates = owned[0].documentTypeCode
    ? [
        DOCUMENT_TYPES.find((type) => type.code === owned[0].documentTypeCode)!,
        ...documentTypesFor(country).filter((type) => type.code !== owned[0].documentTypeCode),
      ].filter(Boolean)
    : documentTypesFor(country);

  const provider: ExtractionProvider = features.extraction
    ? new AnthropicVisionProvider({ apiKey: env.anthropicApiKey!, model: env.extractionModel })
    : new ManualEntryProvider();

  const result = await processDocument(
    { bytes, mimeType: file.type, filename: file.name },
    candidates.map(toExtractionSchema),
    provider,
  );

  const storageKey = storageKeyFor(session.organisation.id, recordId, file.name);
  await putObject(storageKey, bytes, session.organisation.wrappedDataKey);

  const [stored] = await db
    .insert(recordFiles)
    .values({
      organisationId: session.organisation.id,
      recordId,
      storageKey,
      filename: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      sha256: result.fileHash,
      uploadedBy: session.user.id,
    })
    .returning({ id: recordFiles.id });

  const [extraction] = await db
    .insert(extractions)
    .values({
      organisationId: session.organisation.id,
      recordId,
      fileId: stored.id,
      model: result.extraction.model,
      latencyMs: result.extraction.latencyMs,
      classifiedTypeCode: result.plan.documentTypeCode,
      classificationConfidence: String(result.extraction.classification.confidence),
      fields: result.extraction.fields,
      warnings: result.extraction.warnings,
      status: "pending",
    })
    .returning({ id: extractions.id });

  return NextResponse.json({
    fileId: stored.id,
    extractionId: extraction.id,
    documentTypeCode: result.plan.documentTypeCode,
    classificationConfidence: result.extraction.classification.confidence,
    alternatives: result.extraction.classification.alternatives,
    fields: result.plan.fields.map((field) => ({
      key: field.key,
      label: field.spec.label,
      value: field.value,
      confidence: field.confidence,
      verdict: field.verdict,
      reason: field.reason,
      sourceText: field.sourceText ?? null,
      kind: field.spec.kind,
      critical: Boolean(field.spec.critical),
    })),
    blockingReasons: result.plan.blockingReasons,
    warnings: result.extraction.warnings,
    extractionAvailable: features.extraction,
  });
}
