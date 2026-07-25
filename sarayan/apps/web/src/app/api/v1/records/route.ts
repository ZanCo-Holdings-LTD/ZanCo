import { and, asc, count, eq, gte, isNull, lte, sql, type SQL } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { entities, holders, records } from "@/db/schema";
import { documentType } from "@/content/taxonomy";
import { audit } from "@/lib/audit";
import { authenticateApiRequest } from "@/lib/api-auth";
import { checkLimit } from "@/lib/plans";
import { statusOf, syncAlerts } from "@/lib/records";

export const runtime = "nodejs";

/**
 * GET /api/v1/records — list the register.
 * POST /api/v1/records — create a record.
 *
 * A small, honest API: the resources a customer actually integrates against
 * (their HR system pushing new joiners, their fleet system pushing vehicles).
 * Deliberately not a mirror of every internal table.
 */
export async function GET(request: Request) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const url = new URL(request.url);
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? 50) || 50));
  const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0) || 0);
  const status = url.searchParams.get("status");
  const expiringBefore = url.searchParams.get("expiring_before");
  const expiringAfter = url.searchParams.get("expiring_after");

  const filters: SQL[] = [
    eq(records.organisationId, auth.context.organisation.id),
    isNull(records.archivedAt),
  ];
  if (status) {
    filters.push(
      eq(records.status, status as "valid" | "due_soon" | "critical" | "expired" | "dormant"),
    );
  }
  if (expiringBefore && /^\d{4}-\d{2}-\d{2}$/.test(expiringBefore)) {
    filters.push(lte(records.expiresOn, expiringBefore));
  }
  if (expiringAfter && /^\d{4}-\d{2}-\d{2}$/.test(expiringAfter)) {
    filters.push(gte(records.expiresOn, expiringAfter));
  }

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: records.id,
        documentTypeCode: records.documentTypeCode,
        customTypeName: records.customTypeName,
        documentNumber: records.documentNumber,
        issuedOn: records.issuedOn,
        expiresOn: records.expiresOn,
        noExpiry: records.noExpiry,
        issuingAuthority: records.issuingAuthority,
        status: records.status,
        updatedAt: records.updatedAt,
        holderId: holders.id,
        holderName: holders.name,
        holderKind: holders.kind,
        entityId: entities.id,
        entityName: entities.name,
      })
      .from(records)
      .innerJoin(holders, eq(holders.id, records.holderId))
      .innerJoin(entities, eq(entities.id, records.entityId))
      .where(and(...filters))
      .orderBy(sql`${records.expiresOn} asc nulls last`, asc(records.id))
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(records).where(and(...filters)),
  ]);

  return NextResponse.json({
    data: rows.map((row) => ({
      id: row.id,
      document_type: row.documentTypeCode,
      document_type_name: row.documentTypeCode
        ? documentType(row.documentTypeCode)?.nameEn
        : row.customTypeName,
      document_number: row.documentNumber,
      issued_on: row.issuedOn,
      expires_on: row.expiresOn,
      no_expiry: row.noExpiry,
      issuing_authority: row.issuingAuthority,
      status: row.status,
      updated_at: row.updatedAt,
      holder: { id: row.holderId, name: row.holderName, kind: row.holderKind },
      entity: { id: row.entityId, name: row.entityName },
    })),
    pagination: { total: Number(total), limit, offset },
  });
}

const createSchema = z.object({
  entity_id: z.uuid(),
  holder_id: z.uuid(),
  document_type: z.string().min(1).nullable().optional(),
  custom_type_name: z.string().max(160).nullable().optional(),
  document_number: z.string().max(120).nullable().optional(),
  issued_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  expires_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  no_expiry: z.boolean().optional().default(false),
  issuing_authority: z.string().max(200).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export async function POST(request: Request) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body.", details: parsed.error.issues },
      { status: 422 },
    );
  }
  const input = parsed.data;

  if (!input.no_expiry && !input.expires_on) {
    return NextResponse.json(
      { error: "Supply expires_on, or set no_expiry to true." },
      { status: 422 },
    );
  }
  if (!input.document_type && !input.custom_type_name) {
    return NextResponse.json(
      { error: "Supply document_type or custom_type_name." },
      { status: 422 },
    );
  }
  if (input.document_type && !documentType(input.document_type)) {
    return NextResponse.json(
      { error: `Unknown document_type "${input.document_type}".` },
      { status: 422 },
    );
  }

  const organisationId = auth.context.organisation.id;

  const [{ used }] = await db
    .select({ used: count() })
    .from(records)
    .where(eq(records.organisationId, organisationId));
  const limit = checkLimit(auth.context.organisation.tier, "records", used);
  if (!limit.allowed) return NextResponse.json({ error: limit.message }, { status: 402 });

  const owned = await db
    .select({ id: holders.id })
    .from(holders)
    .where(
      and(
        eq(holders.id, input.holder_id),
        eq(holders.entityId, input.entity_id),
        eq(holders.organisationId, organisationId),
      ),
    )
    .limit(1);
  if (owned.length === 0) {
    return NextResponse.json(
      { error: "That holder and entity combination does not exist in this organisation." },
      { status: 404 },
    );
  }

  const expiresOn = input.no_expiry ? null : (input.expires_on ?? null);

  const [created] = await db
    .insert(records)
    .values({
      organisationId,
      entityId: input.entity_id,
      holderId: input.holder_id,
      documentTypeCode: input.document_type ?? null,
      customTypeName: input.custom_type_name ?? null,
      documentNumber: input.document_number ?? null,
      issuedOn: input.issued_on ?? null,
      expiresOn,
      noExpiry: input.no_expiry ?? false,
      issuingAuthority:
        input.issuing_authority ??
        (input.document_type ? documentType(input.document_type)?.issuingAuthority ?? null : null),
      notes: input.notes ?? null,
      status: statusOf({
        id: "new",
        expiresOn,
        noExpiry: input.no_expiry ?? false,
        archivedAt: null,
      }),
    })
    .returning({ id: records.id });

  await syncAlerts(created.id);

  await audit({
    organisationId,
    actorUserId: null,
    actorLabel: `api-key:${auth.context.keyId.slice(0, 8)}`,
    action: "record.created",
    subjectType: "record",
    subjectId: created.id,
    metadata: { via: "api" },
  });

  return NextResponse.json({ data: { id: created.id } }, { status: 201 });
}
