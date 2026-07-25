import { addDays, today } from "@sarayan/core-watch";
import { sql } from "drizzle-orm";
import { db } from "./index";
import { documentTypes, entities, holders, memberships, organisations, records, users } from "./schema";
import { DOCUMENT_TYPES } from "../content/taxonomy";
import { hashPassword } from "../lib/password";
import { createWrappedDataKey } from "../lib/storage";
import { statusOf, syncAlerts } from "../lib/records";

/**
 * Seed the database.
 *
 * Two parts. The taxonomy sync is idempotent and runs on every deploy — it is
 * how the curated document types reach the database. The demo organisation only
 * appears with `--demo`, and never in production.
 *
 *   npm run db:seed            # taxonomy only
 *   npm run db:seed -- --demo  # taxonomy plus a populated demo account
 */

async function syncTaxonomy(): Promise<number> {
  for (const type of DOCUMENT_TYPES) {
    await db
      .insert(documentTypes)
      .values({
        code: type.code,
        country: type.country,
        jurisdiction: type.jurisdiction,
        category: type.category,
        holderKind: type.holderKind,
        nameEn: type.nameEn,
        nameAr: type.nameAr,
        aliases: type.aliases,
        issuingAuthority: type.issuingAuthority,
        issuingAuthorityAr: type.issuingAuthorityAr,
        typicalValidityMonths: type.typicalValidityMonths,
        renewalLeadDays: type.renewalLeadDays,
        typicalRenewalCost: type.typicalRenewalCost ? String(type.typicalRenewalCost.amount) : null,
        renewalCostCurrency: type.typicalRenewalCost?.currency ?? null,
        penalties: type.penalties,
        blocks: type.blocks,
        requires: type.requires,
        consequences: type.consequences,
        fields: type.fields,
        seoSlug: type.seo?.slug ?? null,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: documentTypes.code,
        set: {
          country: sql`excluded.country`,
          jurisdiction: sql`excluded.jurisdiction`,
          category: sql`excluded.category`,
          holderKind: sql`excluded.holder_kind`,
          nameEn: sql`excluded.name_en`,
          nameAr: sql`excluded.name_ar`,
          aliases: sql`excluded.aliases`,
          issuingAuthority: sql`excluded.issuing_authority`,
          issuingAuthorityAr: sql`excluded.issuing_authority_ar`,
          typicalValidityMonths: sql`excluded.typical_validity_months`,
          renewalLeadDays: sql`excluded.renewal_lead_days`,
          typicalRenewalCost: sql`excluded.typical_renewal_cost`,
          renewalCostCurrency: sql`excluded.renewal_cost_currency`,
          penalties: sql`excluded.penalties`,
          blocks: sql`excluded.blocks`,
          requires: sql`excluded.requires`,
          consequences: sql`excluded.consequences`,
          fields: sql`excluded.fields`,
          seoSlug: sql`excluded.seo_slug`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  }
  return DOCUMENT_TYPES.length;
}

async function seedDemo(): Promise<void> {
  const email = "demo@sarayan.app";
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`)
    .limit(1);

  if (existing.length > 0) {
    console.log("Demo account already exists — skipping.");
    return;
  }

  const [user] = await db
    .insert(users)
    .values({
      email,
      name: "Demo Admin",
      passwordHash: await hashPassword("sarayan-demo-2026"),
      locale: "en",
    })
    .returning({ id: users.id });

  const [organisation] = await db
    .insert(organisations)
    .values({
      name: "Gulf Contracting LLC",
      slug: "gulf-contracting-demo",
      country: "AE",
      tier: "business",
      billingStatus: "active",
      wrappedDataKey: createWrappedDataKey(),
    })
    .returning({ id: organisations.id });

  await db.insert(memberships).values({
    organisationId: organisation.id,
    userId: user.id,
    role: "owner",
  });

  const [entity] = await db
    .insert(entities)
    .values({
      organisationId: organisation.id,
      name: "Gulf Contracting LLC",
      legalName: "Gulf Contracting Limited Liability Company",
      country: "AE",
      jurisdiction: "Dubai",
      registrationNumber: "CN-1234567",
      contactName: "Demo Admin",
      contactEmail: email,
    })
    .returning({ id: entities.id });

  const holderSeeds = [
    { kind: "entity" as const, name: "Gulf Contracting LLC" },
    { kind: "person" as const, name: "Ahmed Al Marzooqi", nationality: "UAE", department: "Operations" },
    { kind: "person" as const, name: "Priya Nair", nationality: "India", department: "Finance" },
    { kind: "person" as const, name: "Mohammed Rahman", nationality: "Bangladesh", department: "Site" },
    { kind: "vehicle" as const, name: "Toyota Hilux — A 45892", identifier: "A-45892" },
    { kind: "asset" as const, name: "Al Quoz Warehouse", identifier: "Al Quoz Industrial 3" },
  ];

  const holderIds: Record<string, string> = {};
  for (const seed of holderSeeds) {
    const [created] = await db
      .insert(holders)
      .values({ ...seed, organisationId: organisation.id, entityId: entity.id })
      .returning({ id: holders.id });
    holderIds[seed.name] = created.id;
  }

  // A spread of expiry dates so the dashboard shows every status on first load.
  const base = today();
  const recordSeeds: Array<{ holder: string; code: string; expires: string; number?: string }> = [
    { holder: "Gulf Contracting LLC", code: "AE_TRADE_LICENCE", expires: addDays(base, 24), number: "CN-1234567" },
    { holder: "Gulf Contracting LLC", code: "AE_ESTABLISHMENT_CARD", expires: addDays(base, 61), number: "20394857" },
    { holder: "Gulf Contracting LLC", code: "AE_EJARI", expires: addDays(base, -9), number: "EJ-889912" },
    { holder: "Ahmed Al Marzooqi", code: "AE_RESIDENCE_VISA", expires: addDays(base, 78), number: "784-1990-1234567-1" },
    { holder: "Ahmed Al Marzooqi", code: "AE_EMIRATES_ID", expires: addDays(base, 80), number: "784-1990-1234567-1" },
    { holder: "Priya Nair", code: "AE_RESIDENCE_VISA", expires: addDays(base, 12), number: "784-1988-7654321-9" },
    { holder: "Priya Nair", code: "AE_PASSPORT", expires: addDays(base, 210), number: "Z4829183" },
    { holder: "Mohammed Rahman", code: "AE_LABOUR_CARD", expires: addDays(base, -32), number: "MB-4482910" },
    { holder: "Mohammed Rahman", code: "AE_HSE_TRAINING", expires: addDays(base, 420), number: "NEB-99201" },
    { holder: "Toyota Hilux — A 45892", code: "AE_VEHICLE_REGISTRATION", expires: addDays(base, 41), number: "A-45892" },
    { holder: "Toyota Hilux — A 45892", code: "AE_VEHICLE_INSURANCE", expires: addDays(base, 55), number: "POL-2299184" },
    { holder: "Al Quoz Warehouse", code: "AE_CIVIL_DEFENCE_CERT", expires: addDays(base, 130), number: "CD-77120" },
  ];

  const created: string[] = [];
  for (const seed of recordSeeds) {
    const type = DOCUMENT_TYPES.find((candidate) => candidate.code === seed.code);
    const [record] = await db
      .insert(records)
      .values({
        organisationId: organisation.id,
        entityId: entity.id,
        holderId: holderIds[seed.holder],
        documentTypeCode: seed.code,
        documentNumber: seed.number ?? null,
        issuedOn: type?.typicalValidityMonths
          ? addDays(seed.expires, -type.typicalValidityMonths * 30)
          : null,
        expiresOn: seed.expires,
        issuingAuthority: type?.issuingAuthority ?? null,
        ownerUserId: user.id,
        createdBy: user.id,
        status: statusOf({ id: "seed", expiresOn: seed.expires, noExpiry: false, archivedAt: null }),
      })
      .returning({ id: records.id });
    created.push(record.id);
  }

  for (const recordId of created) await syncAlerts(recordId);

  console.log(`Demo account ready — sign in as ${email} / sarayan-demo-2026`);
}

async function main() {
  const count = await syncTaxonomy();
  console.log(`Synced ${count} document types.`);

  if (process.argv.includes("--demo")) {
    if (process.env.NODE_ENV === "production") {
      console.error("Refusing to seed demo data in production.");
      process.exit(1);
    }
    await seedDemo();
  }

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
