import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { extractions, records } from "@/db/schema";
import { documentType } from "@/content/taxonomy";
import { audit } from "@/lib/audit";
import { requireSession } from "@/lib/auth";
import { assertCan } from "@/lib/rbac";
import { statusOf, syncAlerts } from "@/lib/records";

export const runtime = "nodejs";

const bodySchema = z.object({
  recordId: z.uuid(),
  fileId: z.uuid().nullable().optional(),
  extractionId: z.uuid().nullable().optional(),
  documentTypeCode: z.string().nullable().optional(),
  values: z.record(z.string(), z.string()),
});

/**
 * Commit a confirmed extraction.
 *
 * The human's values win over the model's, always. Every field they changed is
 * written to `extractions.corrections` — that is the eval set the brief asks
 * for, built from ordinary use rather than a separate labelling exercise.
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

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }
  const { recordId, extractionId, documentTypeCode, values } = parsed.data;

  const owned = await db
    .select()
    .from(records)
    .where(and(eq(records.id, recordId), eq(records.organisationId, session.organisation.id)))
    .limit(1);
  if (owned.length === 0) {
    return NextResponse.json({ error: "Record not found." }, { status: 404 });
  }
  const record = owned[0];

  const expiresOn = normaliseDate(values.expiryDate);
  const issuedOn = normaliseDate(values.issueDate);

  if (values.expiryDate && !expiresOn) {
    return NextResponse.json(
      { error: "The expiry date must be a real date in YYYY-MM-DD form." },
      { status: 400 },
    );
  }
  if (issuedOn && expiresOn && issuedOn > expiresOn) {
    return NextResponse.json(
      { error: "The expiry date cannot be before the issue date." },
      { status: 400 },
    );
  }

  const number =
    values.documentNumber ??
    values.idNumber ??
    values.iqamaNumber ??
    values.crNumber ??
    values.passportNumber ??
    values.plateNumber ??
    values.licenceNumber ??
    values.certificateNumber ??
    values.policyNumber ??
    null;

  const resolvedType = documentTypeCode ?? record.documentTypeCode;

  await db
    .update(records)
    .set({
      documentTypeCode: resolvedType,
      documentNumber: number?.trim() || record.documentNumber,
      issuedOn: issuedOn ?? record.issuedOn,
      expiresOn: expiresOn ?? record.expiresOn,
      noExpiry: expiresOn ? false : record.noExpiry,
      issuingAuthority:
        record.issuingAuthority ??
        (resolvedType ? documentType(resolvedType)?.issuingAuthority ?? null : null),
      extractedFields: values,
      status: statusOf({
        id: record.id,
        expiresOn: expiresOn ?? record.expiresOn,
        noExpiry: expiresOn ? false : record.noExpiry,
        archivedAt: record.archivedAt,
      }),
      updatedAt: new Date(),
    })
    .where(eq(records.id, record.id));

  await syncAlerts(record.id);

  if (extractionId) {
    const stored = await db
      .select()
      .from(extractions)
      .where(
        and(
          eq(extractions.id, extractionId),
          eq(extractions.organisationId, session.organisation.id),
        ),
      )
      .limit(1);

    if (stored.length > 0) {
      const modelFields = (stored[0].fields as Array<{ key: string; value: string | null; confidence: number }>) ?? [];
      const corrections = modelFields
        .filter((field) => (field.value ?? "") !== (values[field.key] ?? ""))
        .map((field) => ({
          fieldKey: field.key,
          extractedValue: field.value,
          confirmedValue: values[field.key] ?? null,
          confidence: field.confidence,
        }));

      await db
        .update(extractions)
        .set({
          status: "confirmed",
          corrections,
          confirmedBy: session.user.id,
          confirmedAt: new Date(),
        })
        .where(eq(extractions.id, extractionId));
    }
  }

  await audit({
    organisationId: session.organisation.id,
    actorUserId: session.user.id,
    actorLabel: session.user.name,
    action: "extraction.confirmed",
    subjectType: "record",
    subjectId: record.id,
    metadata: { expiresOn, documentTypeCode: resolvedType },
  });

  return NextResponse.json({ ok: true });
}

function normaliseDate(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const [year, month, day] = trimmed.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const real =
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return real ? trimmed : null;
}
