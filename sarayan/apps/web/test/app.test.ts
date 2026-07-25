import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DOCUMENT_TYPES,
  SEO_DOCUMENT_TYPES,
  documentType,
  downstreamImpact,
  estimatePenalty,
  upstreamDependencies,
} from "../src/content/taxonomy";
import { mapHeaders, parseCsv, parseSpreadsheetDate, toCsv } from "../src/lib/csv";
import { PLANS, agencyMonthlyPence, checkLimit } from "../src/lib/plans";
import { can } from "../src/lib/rbac";
import { en } from "../src/messages/en";
import { ar } from "../src/messages/ar";

describe("taxonomy", () => {
  it("meets the v1 scope of fifteen pre-built types across the UAE and Saudi", () => {
    assert.ok(DOCUMENT_TYPES.length >= 15, `only ${DOCUMENT_TYPES.length} types`);
    assert.ok(DOCUMENT_TYPES.some((type) => type.country === "AE"));
    assert.ok(DOCUMENT_TYPES.some((type) => type.country === "SA"));
  });

  it("has unique codes and unique SEO slugs", () => {
    const codes = new Set(DOCUMENT_TYPES.map((type) => type.code));
    assert.equal(codes.size, DOCUMENT_TYPES.length);

    const slugs = SEO_DOCUMENT_TYPES.map((type) => type.seo.slug);
    assert.equal(new Set(slugs).size, slugs.length);
  });

  it("references only document types that exist", () => {
    for (const type of DOCUMENT_TYPES) {
      for (const code of [...type.blocks, ...type.requires]) {
        assert.ok(documentType(code), `${type.code} references unknown type ${code}`);
      }
    }
  });

  it("links every SEO page to pages that exist", () => {
    const slugs = new Set(SEO_DOCUMENT_TYPES.map((type) => type.seo.slug));
    for (const type of SEO_DOCUMENT_TYPES) {
      for (const related of type.seo.related) {
        // A related slug may point at a template page rather than a document
        // guide; those are checked by the build, not here.
        if (related.includes("template") || related.includes("tracker")) continue;
        assert.ok(slugs.has(related), `${type.seo.slug} links to missing guide ${related}`);
      }
    }
  });

  it("gives every type an expiry field marked critical", () => {
    for (const type of DOCUMENT_TYPES) {
      const expiry = type.fields.find((field) => field.key === "expiryDate");
      assert.ok(expiry, `${type.code} has no expiry field`);
      assert.equal(expiry?.critical, true, `${type.code} expiry is not critical`);
    }
  });

  it("resolves the dependency chain transitively", () => {
    // Ejari blocks the trade licence, which blocks the establishment card,
    // which blocks residence visas. Missing one tenancy renewal stops hiring.
    const impact = downstreamImpact("AE_EJARI").map((type) => type.code);
    assert.ok(impact.includes("AE_TRADE_LICENCE"));
    assert.ok(impact.includes("AE_ESTABLISHMENT_CARD"));
    assert.ok(impact.includes("AE_RESIDENCE_VISA"));
  });

  it("resolves upstream dependencies", () => {
    const upstream = upstreamDependencies("AE_RESIDENCE_VISA").map((type) => type.code);
    assert.ok(upstream.includes("AE_ESTABLISHMENT_CARD"));
    assert.ok(upstream.includes("AE_TRADE_LICENCE"));
  });

  it("terminates on a dependency cycle", () => {
    // The Saudi CR and Chamber membership each gate the other; the walk must
    // not recurse forever.
    const impact = downstreamImpact("SA_COMMERCIAL_REGISTRATION");
    assert.ok(impact.length > 0);
    assert.ok(impact.length < DOCUMENT_TYPES.length * 2);
  });
});

describe("estimatePenalty", () => {
  it("returns nothing for a document that has not expired", () => {
    assert.equal(estimatePenalty("AE_TRADE_LICENCE", 0), null);
    assert.equal(estimatePenalty("AE_TRADE_LICENCE", -5), null);
  });

  it("accrues a per-day penalty per day late", () => {
    const ten = estimatePenalty("AE_RESIDENCE_VISA", 10);
    const twenty = estimatePenalty("AE_RESIDENCE_VISA", 20);
    assert.ok(ten && twenty);
    assert.equal(twenty!.amount, ten!.amount * 2);
  });

  it("accrues a per-month penalty by whole months", () => {
    const oneMonth = estimatePenalty("AE_TRADE_LICENCE", 30);
    const twoMonths = estimatePenalty("AE_TRADE_LICENCE", 31);
    assert.ok(oneMonth && twoMonths);
    assert.ok(twoMonths!.amount > oneMonth!.amount);
  });

  it("crosses into a second band on a banded schedule", () => {
    const first = estimatePenalty("SA_IQAMA", 10);
    const second = estimatePenalty("SA_IQAMA", 45);
    assert.ok(first && second);
    assert.ok(second!.amount > first!.amount);
    assert.ok(second!.breakdown.length >= 2);
  });

  it("returns nothing for an unknown code", () => {
    assert.equal(estimatePenalty("NOT_A_TYPE", 30), null);
  });
});

describe("csv", () => {
  it("parses quoted fields, embedded commas and CRLF", () => {
    const rows = parseCsv('a,b\r\n"one, two",three\r\n');
    assert.deepEqual(rows, [
      ["a", "b"],
      ["one, two", "three"],
    ]);
  });

  it("parses escaped quotes", () => {
    assert.deepEqual(parseCsv('a\n"He said ""hi"""'), [["a"], ['He said "hi"']]);
  });

  it("strips the Excel byte-order mark", () => {
    assert.deepEqual(parseCsv("﻿name\nAhmed"), [["name"], ["Ahmed"]]);
  });

  it("round-trips through toCsv", () => {
    const rows = [
      ["Holder", "Notes"],
      ['Ahmed, "the PRO"', "line one"],
    ];
    const parsed = parseCsv(toCsv(rows));
    assert.deepEqual(parsed, rows);
  });

  it("maps English and Arabic headers", () => {
    const mapping = mapHeaders(["Emp Name", "Expiry Date", "تاريخ الإصدار", "Doc Type"]);
    assert.equal(mapping[0], "holderName");
    assert.equal(mapping[1], "expiresOn");
    assert.equal(mapping[2], "issuedOn");
    assert.equal(mapping[3], "documentType");
  });
});

describe("parseSpreadsheetDate", () => {
  it("trusts an ISO date", () => {
    assert.deepEqual(parseSpreadsheetDate("2026-10-31"), {
      value: "2026-10-31",
      ambiguous: false,
      error: null,
    });
  });

  it("reads an unambiguous day-first date without guessing", () => {
    const result = parseSpreadsheetDate("31/10/2026");
    assert.equal(result.value, "2026-10-31");
    assert.equal(result.ambiguous, false);
  });

  it("reads an unambiguous month-first date", () => {
    const result = parseSpreadsheetDate("10/31/2026");
    assert.equal(result.value, "2026-10-31");
    assert.equal(result.ambiguous, false);
  });

  it("resolves a genuinely ambiguous date day-first and says so", () => {
    // 03/04/2026 is 3 April in the Gulf and 4 March in the US. Choosing
    // silently is how a month of fines happens.
    const result = parseSpreadsheetDate("03/04/2026");
    assert.equal(result.value, "2026-04-03");
    assert.equal(result.ambiguous, true);
  });

  it("expands a two-digit year sensibly for expiry dates", () => {
    assert.equal(parseSpreadsheetDate("31/10/27").value, "2027-10-31");
  });

  it("reports a date that does not exist", () => {
    assert.ok(parseSpreadsheetDate("30/02/2026").error);
  });

  it("reports something that is not a date at all", () => {
    const result = parseSpreadsheetDate("see attached");
    assert.equal(result.value, null);
    assert.ok(result.error);
  });

  it("treats a blank cell as absent, not as an error", () => {
    assert.deepEqual(parseSpreadsheetDate("   "), { value: null, ambiguous: false, error: null });
  });
});

describe("plans", () => {
  it("prices the tiers as the brief specifies", () => {
    assert.equal(PLANS.starter.monthlyPence, 3900);
    assert.equal(PLANS.business.monthlyPence, 9900);
    assert.equal(PLANS.enterprise.monthlyPence, 24900);
    assert.equal(PLANS.agency.monthlyPence, 60000);
    assert.equal(PLANS.agency.perEntityPence, 800);
  });

  it("bills annually at two months free", () => {
    for (const tier of ["starter", "business", "enterprise"] as const) {
      assert.equal(PLANS[tier].annualPence, PLANS[tier].monthlyPence * 10);
    }
  });

  it("adds the per-entity charge for agencies", () => {
    assert.equal(agencyMonthlyPence(30), 60000 + 30 * 800);
    assert.equal(agencyMonthlyPence(0), 60000);
  });

  it("enforces record limits at the boundary", () => {
    assert.equal(checkLimit("starter", "records", 24).allowed, true);
    assert.equal(checkLimit("starter", "records", 25).allowed, false);
    assert.equal(checkLimit("agency", "records", 100_000).allowed, true);
  });

  it("gates WhatsApp to the tiers that include it", () => {
    assert.ok(!PLANS.starter.channels.includes("whatsapp"));
    assert.ok(PLANS.business.channels.includes("whatsapp"));
  });
});

describe("rbac", () => {
  it("lets a viewer read and acknowledge but not change data", () => {
    assert.equal(can("viewer", "records.view"), true);
    assert.equal(can("viewer", "alerts.acknowledge"), true);
    assert.equal(can("viewer", "records.create"), false);
    assert.equal(can("viewer", "records.delete"), false);
  });

  it("lets a manager run the register but not the organisation", () => {
    assert.equal(can("manager", "records.create"), true);
    assert.equal(can("manager", "evidence.generate"), true);
    assert.equal(can("manager", "members.manage"), false);
    assert.equal(can("manager", "billing.manage"), false);
  });

  it("reserves billing and API keys for the owner", () => {
    assert.equal(can("admin", "billing.manage"), false);
    assert.equal(can("owner", "billing.manage"), true);
    assert.equal(can("admin", "apikeys.manage"), false);
    assert.equal(can("owner", "apikeys.manage"), true);
  });
});

describe("translations", () => {
  it("translates every English key into Arabic", () => {
    const missing: string[] = [];
    const walk = (source: unknown, target: unknown, path: string) => {
      if (typeof source === "string") {
        if (typeof target !== "string" || target.trim() === "") missing.push(path);
        return;
      }
      if (typeof source !== "object" || source === null) return;
      for (const key of Object.keys(source as Record<string, unknown>)) {
        walk(
          (source as Record<string, unknown>)[key],
          (target as Record<string, unknown> | undefined)?.[key],
          path ? `${path}.${key}` : key,
        );
      }
    };
    walk(en, ar, "");
    assert.deepEqual(missing, [], `untranslated keys: ${missing.join(", ")}`);
  });

  it("keeps interpolation placeholders consistent across locales", () => {
    const mismatched: string[] = [];
    const placeholders = (value: string) =>
      (value.match(/\{(\w+)\}/g) ?? []).sort().join(",");
    const walk = (source: unknown, target: unknown, path: string) => {
      if (typeof source === "string") {
        if (typeof target === "string" && placeholders(source) !== placeholders(target)) {
          mismatched.push(path);
        }
        return;
      }
      if (typeof source !== "object" || source === null) return;
      for (const key of Object.keys(source as Record<string, unknown>)) {
        walk(
          (source as Record<string, unknown>)[key],
          (target as Record<string, unknown> | undefined)?.[key],
          path ? `${path}.${key}` : key,
        );
      }
    };
    walk(en, ar, "");
    assert.deepEqual(mismatched, [], `placeholder mismatch: ${mismatched.join(", ")}`);
  });
});
