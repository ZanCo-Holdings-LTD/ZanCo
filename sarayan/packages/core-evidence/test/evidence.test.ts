import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildEvidencePack,
  canonicalise,
  hashPayload,
  measure,
  sanitise,
  summarise,
  verifyPayload,
  wrap,
  type EvidencePackInput,
  type EvidenceRecord,
} from "../src/index";

const RECORDS: EvidenceRecord[] = [
  {
    reference: "B2222222",
    documentType: "Residence visa",
    holder: "Priya Nair",
    holderType: "person",
    number: "784-1988-7654321-9",
    issuingAuthority: "GDRFA",
    issuedOn: "2024-07-01",
    expiresOn: "2026-07-01",
    status: "critical",
    daysRemaining: 4,
  },
  {
    reference: "A1111111",
    documentType: "Trade licence",
    holder: "Gulf Contracting LLC",
    holderType: "entity",
    number: "CN-1234567",
    issuingAuthority: "Dubai DET",
    issuedOn: "2025-11-01",
    expiresOn: "2026-10-31",
    status: "valid",
    daysRemaining: 128,
    fileHash: "abc123",
  },
];

const INPUT: EvidencePackInput = {
  organisation: "Gulf Contracting LLC",
  entity: "Gulf Contracting LLC",
  entityCountry: "AE",
  generatedAt: new Date("2026-06-27T10:30:00.000Z"),
  generatedBy: "Demo Admin",
  scope: "All entities · all statuses",
  records: RECORDS,
  verifyBaseUrl: "https://sarayan.app/en",
};

describe("canonicalise", () => {
  it("is stable regardless of input order", () => {
    const forwards = canonicalise(INPUT);
    const backwards = canonicalise({ ...INPUT, records: [...RECORDS].reverse() });
    assert.equal(forwards, backwards);
  });

  it("changes when any record field changes", () => {
    const original = hashPayload(canonicalise(INPUT));
    const tampered = hashPayload(
      canonicalise({
        ...INPUT,
        records: [{ ...RECORDS[0], expiresOn: "2027-07-01" }, RECORDS[1]],
      }),
    );
    assert.notEqual(original, tampered);
  });

  it("excludes derived values that could drift", () => {
    // `daysRemaining` is computed from the clock, so including it would make an
    // otherwise unchanged register hash differently tomorrow.
    assert.ok(!canonicalise(INPUT).includes("daysRemaining"));
  });
});

describe("buildEvidencePack", () => {
  it("produces byte-identical output for identical input", () => {
    const first = buildEvidencePack(INPUT);
    const second = buildEvidencePack(INPUT);
    assert.equal(first.hash, second.hash);
    assert.deepEqual(Buffer.from(first.pdf), Buffer.from(second.pdf));
  });

  it("emits a well-formed PDF", () => {
    const { pdf } = buildEvidencePack(INPUT);
    const text = Buffer.from(pdf).toString("latin1");
    assert.ok(text.startsWith("%PDF-1.7"));
    assert.ok(text.includes("/Type /Catalog"));
    assert.ok(text.trimEnd().endsWith("%%EOF"));
    // The xref offset must point at the actual xref table.
    const startxref = Number(/startxref\s+(\d+)/.exec(text)?.[1]);
    assert.ok(Number.isFinite(startxref));
    assert.equal(text.slice(startxref, startxref + 4), "xref");
  });

  it("prints the hash and a verify URL on the document", () => {
    const pack = buildEvidencePack(INPUT);
    const text = Buffer.from(pack.pdf).toString("latin1");
    assert.ok(text.includes(pack.hash));
    assert.equal(pack.verifyUrl, `https://sarayan.app/en/verify/${pack.hash}`);
  });

  it("verifies its own payload and rejects a tampered one", () => {
    const pack = buildEvidencePack(INPUT);
    assert.equal(verifyPayload(pack.canonicalPayload, pack.hash), true);
    assert.equal(verifyPayload(pack.canonicalPayload.replace("Priya", "Priyaa"), pack.hash), false);
    assert.equal(verifyPayload(pack.canonicalPayload, "0".repeat(64)), false);
  });

  it("handles an empty register without failing", () => {
    const pack = buildEvidencePack({ ...INPUT, records: [] });
    assert.equal(pack.summary.total, 0);
    assert.ok(Buffer.from(pack.pdf).toString("latin1").includes("No records in scope"));
  });

  it("paginates a long register", () => {
    const many = Array.from({ length: 120 }, (_, index) => ({
      ...RECORDS[0],
      reference: `R${String(index).padStart(7, "0")}`,
      holder: `Employee ${index}`,
    }));
    const text = Buffer.from(buildEvidencePack({ ...INPUT, records: many }).pdf).toString("latin1");
    const pageCount = Number(/\/Count (\d+)/.exec(text)?.[1]);
    assert.ok(pageCount > 1, `expected more than one page, got ${pageCount}`);
  });
});

describe("summarise", () => {
  it("counts each status", () => {
    const summary = summarise(RECORDS);
    assert.equal(summary.total, 2);
    assert.equal(summary.valid, 1);
    assert.equal(summary.critical, 1);
    assert.equal(summary.expired, 0);
  });
});

describe("pdf text handling", () => {
  it("escapes characters that would corrupt a PDF string", () => {
    const pack = buildEvidencePack({
      ...INPUT,
      entity: "Gulf (Contracting) \\ Co",
    });
    const text = Buffer.from(pack.pdf).toString("latin1");
    assert.ok(text.includes("Gulf \\(Contracting\\) \\\\ Co"));
  });

  it("folds unrenderable script to a marker rather than mojibake", () => {
    // Arabic cannot be drawn with the standard 14 fonts; the canonical payload
    // keeps the original, so nothing is lost from the record of truth.
    const folded = sanitise("شركة Gulf");
    assert.ok(!/[؀-ۿ]/.test(folded));
    assert.ok(folded.includes("Gulf"));

    const pack = buildEvidencePack({ ...INPUT, entity: "شركة الخليج" });
    assert.ok(pack.canonicalPayload.includes("Gulf Contracting LLC"));
  });

  it("measures and wraps text to a width", () => {
    assert.ok(measure("Trade licence", "Helvetica", 10) > 0);
    assert.ok(measure("W", "Helvetica-Bold", 10) > measure("i", "Helvetica-Bold", 10));

    const lines = wrap("one two three four five six seven eight", 60, "Helvetica", 10);
    assert.ok(lines.length > 1);
    assert.ok(lines.every((line) => measure(line, "Helvetica", 10) <= 60 || !line.includes(" ")));
  });
});
