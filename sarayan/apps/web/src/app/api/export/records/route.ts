import { and, asc, eq, ilike, isNull, or, sql, type SQL } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { entities, holders, records, users } from "@/db/schema";
import { documentTypeName } from "@/content/taxonomy";
import { audit } from "@/lib/audit";
import { requireSession } from "@/lib/auth";
import { toCsv } from "@/lib/csv";
import { assertCan } from "@/lib/rbac";

export const runtime = "nodejs";

/**
 * CSV export.
 *
 * Deliberately complete and deliberately easy: a customer who cannot get their
 * register out is a customer who is right not to trust you with it. The column
 * order matches the import template, so an export round-trips.
 */
export async function GET(request: Request) {
  let session;
  try {
    session = await requireSession();
    assertCan(session.role, "records.export");
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Not permitted." },
      { status: 403 },
    );
  }

  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const entityId = url.searchParams.get("entity");
  const query = url.searchParams.get("q");

  const filters: SQL[] = [
    eq(records.organisationId, session.organisation.id),
    isNull(records.archivedAt),
  ];
  if (status && status !== "all") {
    filters.push(
      eq(records.status, status as "valid" | "due_soon" | "critical" | "expired" | "dormant"),
    );
  }
  if (entityId && entityId !== "all") filters.push(eq(records.entityId, entityId));
  if (query) {
    const term = `%${query.replace(/[%_]/g, "")}%`;
    const search = or(ilike(holders.name, term), ilike(records.documentNumber, term));
    if (search) filters.push(search);
  }

  const rows = await db
    .select({
      holderName: holders.name,
      holderKind: holders.kind,
      identifier: holders.identifier,
      department: holders.department,
      entityName: entities.name,
      documentTypeCode: records.documentTypeCode,
      customTypeName: records.customTypeName,
      documentNumber: records.documentNumber,
      issuedOn: records.issuedOn,
      expiresOn: records.expiresOn,
      issuingAuthority: records.issuingAuthority,
      status: records.status,
      ownerName: users.name,
      notes: records.notes,
    })
    .from(records)
    .innerJoin(holders, eq(holders.id, records.holderId))
    .innerJoin(entities, eq(entities.id, records.entityId))
    .leftJoin(users, eq(users.id, records.ownerUserId))
    .where(and(...filters))
    .orderBy(sql`${records.expiresOn} asc nulls last`, asc(holders.name));

  const csv = toCsv([
    [
      "Holder name",
      "Holder type",
      "Entity",
      "Document type",
      "Document number",
      "Issue date",
      "Expiry date",
      "Issuing authority",
      "Status",
      "Responsible",
      "Identifier",
      "Department",
      "Notes",
    ],
    ...rows.map((row) => [
      row.holderName,
      row.holderKind,
      row.entityName,
      row.documentTypeCode ? documentTypeName(row.documentTypeCode, "en") : row.customTypeName,
      row.documentNumber,
      row.issuedOn,
      row.expiresOn,
      row.issuingAuthority,
      row.status,
      row.ownerName,
      row.identifier,
      row.department,
      row.notes,
    ]),
  ]);

  await audit({
    organisationId: session.organisation.id,
    actorUserId: session.user.id,
    actorLabel: session.user.name,
    action: "records.exported",
    subjectType: "organisation",
    subjectId: session.organisation.id,
    metadata: { count: rows.length },
  });

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="sarayan-records-${stamp}.csv"`,
      "cache-control": "private, no-store",
    },
  });
}
