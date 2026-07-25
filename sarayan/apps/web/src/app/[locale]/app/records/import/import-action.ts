"use server";

import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { entities, holders, records } from "@/db/schema";
import { DOCUMENT_TYPES, documentTypesFor, type CountryCode } from "@/content/taxonomy";
import { audit } from "@/lib/audit";
import { requireSession } from "@/lib/auth";
import { mapHeaders, parseCsv, parseSpreadsheetDate } from "@/lib/csv";
import { checkLimit } from "@/lib/plans";
import { assertCan } from "@/lib/rbac";
import { statusOf, syncAlerts } from "@/lib/records";

/**
 * Spreadsheet import.
 *
 * This is the onboarding path: "you import their spreadsheet yourself" in v0,
 * and self-serve from v1. It is built to be forgiving — unmatched headers,
 * mixed date formats, unknown document types and missing holders are all
 * handled by importing what can be imported and reporting the rest, line by
 * line. An importer that rejects the file is an importer nobody uses twice.
 */

import { emptyImportState, type ImportState } from "./import-state";

export async function importCsvAction(
  _previous: ImportState,
  formData: FormData,
): Promise<ImportState> {
  const session = await requireSession();
  try {
    assertCan(session.role, "records.import");
  } catch (error) {
    return { ...emptyImportState, error: error instanceof Error ? error.message : "Not permitted." };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ...emptyImportState, error: "Choose a CSV file." };
  }
  if (file.size > 8 * 1024 * 1024) {
    return { ...emptyImportState, error: "That file is larger than 8 MB. Split it and try again." };
  }

  const text = await file.text();
  const rows = parseCsv(text);
  if (rows.length < 2) {
    return { ...emptyImportState, error: "The file has no data rows." };
  }

  const headerMap = mapHeaders(rows[0]);
  const columns = Object.values(headerMap);
  if (!columns.includes("holderName") || !columns.includes("expiresOn")) {
    return {
      ...emptyImportState,
      error:
        "The file needs at least a holder name column and an expiry date column. Rename the headers and try again.",
    };
  }

  const organisationId = session.organisation.id;

  const [entityRows, holderRows, [{ used }]] = await Promise.all([
    db
      .select({ id: entities.id, name: entities.name, country: entities.country })
      .from(entities)
      .where(eq(entities.organisationId, organisationId)),
    db
      .select({ id: holders.id, name: holders.name, entityId: holders.entityId })
      .from(holders)
      .where(eq(holders.organisationId, organisationId)),
    db.select({ used: sql<number>`count(*)::int` }).from(records).where(eq(records.organisationId, organisationId)),
  ]);

  if (entityRows.length === 0) {
    return { ...emptyImportState, error: "Create an entity before importing." };
  }

  const defaultEntity = entityRows[0];
  const entityByName = new Map(entityRows.map((entity) => [entity.name.toLowerCase(), entity]));
  const holderByKey = new Map(
    holderRows.map((holder) => [`${holder.entityId}|${holder.name.toLowerCase()}`, holder.id]),
  );

  const country = session.organisation.country as CountryCode;
  const typeLookup = buildTypeLookup(country);

  const state: ImportState = { ...emptyImportState, done: true };
  let remaining = Math.max(
    0,
    (checkLimit(session.organisation.tier, "records", used).limit ?? 0) - used,
  );

  const touched: string[] = [];

  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index];
    const line = index + 1;
    const get = (field: string): string => {
      for (const [position, name] of Object.entries(headerMap)) {
        if (name === field) return (row[Number(position)] ?? "").trim();
      }
      return "";
    };

    const holderName = get("holderName");
    if (!holderName) {
      state.skipped += 1;
      state.problems.push({ row: line, message: "No holder name." });
      continue;
    }

    if (remaining <= 0) {
      state.skipped += 1;
      state.problems.push({ row: line, message: "Plan record limit reached." });
      continue;
    }

    const entityName = get("entity");
    const entity =
      (entityName ? entityByName.get(entityName.toLowerCase()) : undefined) ?? defaultEntity;

    const expiryRaw = get("expiresOn");
    const expiry = parseSpreadsheetDate(expiryRaw);
    if (expiry.error) {
      state.skipped += 1;
      state.problems.push({ row: line, message: `${holderName}: ${expiry.error}` });
      continue;
    }
    if (!expiry.value) {
      state.skipped += 1;
      state.problems.push({ row: line, message: `${holderName}: no expiry date.` });
      continue;
    }
    if (expiry.ambiguous) {
      state.ambiguousDates.push({
        row: line,
        holder: holderName,
        raw: expiryRaw,
        resolved: expiry.value,
      });
    }

    const issued = parseSpreadsheetDate(get("issuedOn"));

    // Find or create the holder. Auto-creating is the difference between an
    // import that works and one that requires an afternoon of prep.
    const holderKey = `${entity.id}|${holderName.toLowerCase()}`;
    let holderId = holderByKey.get(holderKey);
    if (!holderId) {
      const kindRaw = get("holderKind").toLowerCase();
      const identifier = get("identifier");
      const kind =
        kindRaw === "vehicle" || identifier.match(/^[A-Z]?[-\s]?\d{3,6}$/i)
          ? "vehicle"
          : kindRaw === "asset" || kindRaw === "entity"
            ? (kindRaw as "asset" | "entity")
            : "person";

      const [created] = await db
        .insert(holders)
        .values({
          organisationId,
          entityId: entity.id,
          kind,
          name: holderName,
          nationality: get("nationality") || null,
          department: get("department") || null,
          email: get("email") || null,
          phone: get("phone") || null,
          identifier: identifier || null,
        })
        .returning({ id: holders.id });
      holderId = created.id;
      holderByKey.set(holderKey, holderId);
      state.createdHolders += 1;
    }

    const typeLabel = get("documentType");
    const matchedType = matchDocumentType(typeLabel, typeLookup);

    const [record] = await db
      .insert(records)
      .values({
        organisationId,
        entityId: entity.id,
        holderId,
        documentTypeCode: matchedType,
        customTypeName: matchedType ? null : typeLabel || "Imported document",
        documentNumber: get("documentNumber") || null,
        issuedOn: issued.value,
        expiresOn: expiry.value,
        noExpiry: false,
        issuingAuthority: get("issuingAuthority") || null,
        notes: get("notes") || null,
        createdBy: session.user.id,
        status: statusOf({
          id: "new",
          expiresOn: expiry.value,
          noExpiry: false,
          archivedAt: null,
        }),
      })
      .returning({ id: records.id });

    touched.push(record.id);
    state.imported += 1;
    remaining -= 1;

    if (!matchedType && typeLabel) {
      state.problems.push({
        row: line,
        message: `"${typeLabel}" is not a known document type — imported as a custom type.`,
      });
    }
  }

  // Alerts are scheduled after the rows land, so a 400-row import is one pass
  // over the data rather than 400 interleaved round trips.
  for (const recordId of touched) {
    await syncAlerts(recordId);
  }

  await audit({
    organisationId,
    actorUserId: session.user.id,
    actorLabel: session.user.name,
    action: "records.imported",
    subjectType: "organisation",
    subjectId: organisationId,
    metadata: {
      imported: state.imported,
      skipped: state.skipped,
      createdHolders: state.createdHolders,
    },
  });

  revalidatePath("/", "layout");
  return state;
}

function buildTypeLookup(country: CountryCode): Map<string, string> {
  const lookup = new Map<string, string>();
  const preferred = documentTypesFor(country);
  const ordered = [...preferred, ...DOCUMENT_TYPES.filter((type) => type.country !== country)];

  for (const type of ordered) {
    for (const key of [type.code, type.nameEn, type.nameAr, ...type.aliases]) {
      const normalised = key.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
      // First writer wins, so the organisation's own country takes precedence
      // when the UAE and Saudi share a name like "vehicle registration".
      if (normalised && !lookup.has(normalised)) lookup.set(normalised, type.code);
    }
  }
  return lookup;
}

function matchDocumentType(label: string, lookup: Map<string, string>): string | null {
  if (!label) return null;
  const normalised = label.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const exact = lookup.get(normalised);
  if (exact) return exact;

  for (const [key, code] of lookup) {
    if (key.length > 4 && (normalised.includes(key) || key.includes(normalised))) return code;
  }
  return null;
}
