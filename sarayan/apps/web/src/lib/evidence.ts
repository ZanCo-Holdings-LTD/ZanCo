import "server-only";

import { buildEvidencePack, type EvidenceRecord } from "@sarayan/core-evidence";
import { and, asc, eq, isNull, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { entities, evidencePacks, holders, recordFiles, records } from "@/db/schema";
import { documentTypeName } from "@/content/taxonomy";
import { env } from "./env";
import { daysRemaining } from "./records";

/**
 * Evidence pack generation.
 *
 * Reads the register, hands it to `@sarayan/core-evidence`, and stores the hash
 * with the canonical payload so the public verify page can re-derive it. The
 * pack is regenerated on download rather than stored as a blob: the bytes are
 * deterministic, so storing them would be storing something we can always
 * reproduce.
 */

export interface PackScope {
  organisationId: string;
  entityId?: string | null;
  status?: string | null;
  generatedBy: { id: string; name: string };
  organisationName: string;
  /** Passed in so a regeneration reproduces the original bytes exactly. */
  generatedAt?: Date;
}

export async function generatePack(scope: PackScope) {
  const filters: SQL[] = [
    eq(records.organisationId, scope.organisationId),
    isNull(records.archivedAt),
  ];
  if (scope.entityId) filters.push(eq(records.entityId, scope.entityId));
  if (scope.status && scope.status !== "all") {
    filters.push(
      eq(records.status, scope.status as "valid" | "due_soon" | "critical" | "expired" | "dormant"),
    );
  }

  const rows = await db
    .select({
      id: records.id,
      documentTypeCode: records.documentTypeCode,
      customTypeName: records.customTypeName,
      documentNumber: records.documentNumber,
      issuedOn: records.issuedOn,
      expiresOn: records.expiresOn,
      issuingAuthority: records.issuingAuthority,
      status: records.status,
      holderName: holders.name,
      holderKind: holders.kind,
      entityName: entities.name,
      entityCountry: entities.country,
      fileHash: sql<string | null>`(
        select ${recordFiles.sha256}
        from ${recordFiles}
        where ${recordFiles.recordId} = ${records.id}
        order by ${recordFiles.createdAt} desc
        limit 1
      )`,
    })
    .from(records)
    .innerJoin(holders, eq(holders.id, records.holderId))
    .innerJoin(entities, eq(entities.id, records.entityId))
    .where(and(...filters))
    .orderBy(asc(holders.name));

  const entityName = scope.entityId ? rows[0]?.entityName ?? scope.organisationName : scope.organisationName;
  const entityCountry = rows[0]?.entityCountry ?? "AE";

  const evidenceRecords: EvidenceRecord[] = rows.map((row) => ({
    // A short, stable, human-quotable reference an auditor can cite.
    reference: row.id.slice(0, 8).toUpperCase(),
    documentType: row.documentTypeCode
      ? documentTypeName(row.documentTypeCode, "en")
      : row.customTypeName ?? "Document",
    holder: row.holderName,
    holderType: row.holderKind,
    number: row.documentNumber,
    issuingAuthority: row.issuingAuthority,
    issuedOn: row.issuedOn,
    expiresOn: row.expiresOn,
    status: row.status,
    daysRemaining: daysRemaining(row.expiresOn),
    fileHash: row.fileHash,
  }));

  const scopeLabel = [
    scope.entityId ? entityName : "All entities",
    scope.status && scope.status !== "all" ? `status: ${scope.status}` : "all statuses",
  ].join(" · ");

  const pack = buildEvidencePack({
    organisation: scope.organisationName,
    entity: entityName,
    entityCountry,
    generatedAt: scope.generatedAt ?? new Date(),
    generatedBy: scope.generatedBy.name,
    scope: scopeLabel,
    records: evidenceRecords,
    verifyBaseUrl: `${env.appUrl}/en`,
  });

  return { pack, entityName, scopeLabel };
}

/** Persist a generated pack so the public verify page can confirm it later. */
export async function storePack(
  scope: PackScope,
  generated: Awaited<ReturnType<typeof generatePack>>,
  generatedAt: Date,
) {
  await db
    .insert(evidencePacks)
    .values({
      organisationId: scope.organisationId,
      entityId: scope.entityId ?? null,
      hash: generated.pack.hash,
      scope: generated.scopeLabel,
      canonicalPayload: generated.pack.canonicalPayload,
      recordCount: generated.pack.summary.total,
      summary: generated.pack.summary,
      generatedBy: scope.generatedBy.id,
      generatedByName: scope.generatedBy.name,
      generatedAt,
    })
    // Regenerating an identical register produces an identical hash. That is
    // the point, so treat it as the same pack rather than a conflict.
    .onConflictDoNothing({ target: evidencePacks.hash });
}
