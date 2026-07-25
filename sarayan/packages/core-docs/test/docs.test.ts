import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CONFIDENCE_THRESHOLDS,
  ManualEntryProvider,
  buildReviewPlan,
  diffCorrections,
  fieldAccuracy,
  hashFile,
  processDocument,
  validateField,
  validateUpload,
  verdictFor,
  type ExtractionResult,
  type ExtractionSchema,
  type FieldSpec,
} from "../src/index";

const EXPIRY: FieldSpec = {
  key: "expiryDate",
  label: "Expiry date",
  kind: "date",
  required: true,
  critical: true,
};

const NUMBER: FieldSpec = { key: "documentNumber", label: "Document number", kind: "text" };

const SCHEMA: ExtractionSchema = {
  documentTypeCode: "AE_TRADE_LICENCE",
  documentTypeLabel: "Trade licence",
  country: "AE",
  fields: [EXPIRY, NUMBER],
};

function extraction(overrides: Partial<ExtractionResult> = {}): ExtractionResult {
  return {
    classification: { documentTypeCode: "AE_TRADE_LICENCE", confidence: 0.97, alternatives: [] },
    fields: [
      { key: "expiryDate", value: "2026-10-31", confidence: 0.96 },
      { key: "documentNumber", value: "CN-1234567", confidence: 0.99 },
    ],
    model: "test",
    latencyMs: 10,
    warnings: [],
    ...overrides,
  };
}

describe("validateField", () => {
  it("accepts an ISO date", () => {
    assert.deepEqual(validateField({ key: "expiryDate", value: "2026-10-31", confidence: 1 }, EXPIRY), {
      invalid: false,
      reason: null,
    });
  });

  it("rejects a non-ISO date", () => {
    // A model returning 31/10/2026 has not followed the schema, and guessing
    // which half is the day is exactly the mistake that costs a fine.
    assert.equal(
      validateField({ key: "expiryDate", value: "31/10/2026", confidence: 1 }, EXPIRY).invalid,
      true,
    );
  });

  it("rejects a date that does not exist", () => {
    assert.equal(
      validateField({ key: "expiryDate", value: "2026-02-30", confidence: 1 }, EXPIRY).invalid,
      true,
    );
  });

  it("rejects an implausible year from a digit slip", () => {
    const result = validateField({ key: "expiryDate", value: "1907-10-31", confidence: 1 }, EXPIRY);
    assert.equal(result.invalid, true);
    assert.match(result.reason ?? "", /Implausible year/);
  });

  it("flags a missing required field", () => {
    assert.equal(validateField({ key: "expiryDate", value: null, confidence: 0 }, EXPIRY).invalid, true);
  });

  it("enforces a pattern when the taxonomy gives one", () => {
    const spec: FieldSpec = {
      key: "idNumber",
      label: "ID",
      kind: "text",
      pattern: "^784\\d{11}$",
    };
    // Wrong prefix, and right prefix but one digit short.
    assert.equal(validateField({ key: "idNumber", value: "999" + "1".repeat(11), confidence: 1 }, spec).invalid, true);
    assert.equal(validateField({ key: "idNumber", value: "784" + "1".repeat(10), confidence: 1 }, spec).invalid, true);
    assert.equal(validateField({ key: "idNumber", value: "784" + "1".repeat(11), confidence: 1 }, spec).invalid, false);
  });

  it("survives a malformed pattern in the taxonomy", () => {
    const spec: FieldSpec = { key: "x", label: "X", kind: "text", pattern: "([" };
    assert.equal(validateField({ key: "x", value: "anything", confidence: 1 }, spec).invalid, false);
  });
});

describe("verdictFor", () => {
  it("never auto-confirms a critical field, however confident", () => {
    assert.equal(verdictFor(1, EXPIRY, false), "review");
  });

  it("confirms a high-confidence ordinary field", () => {
    assert.equal(verdictFor(0.99, NUMBER, false), "confirmed");
  });

  it("flags a mid-confidence field for review", () => {
    assert.equal(verdictFor(0.7, NUMBER, false), "review");
  });

  it("rejects below the floor, and anything invalid", () => {
    assert.equal(verdictFor(CONFIDENCE_THRESHOLDS.reject - 0.01, NUMBER, false), "rejected");
    assert.equal(verdictFor(1, NUMBER, true), "rejected");
  });
});

describe("buildReviewPlan", () => {
  it("always demands human confirmation", () => {
    const plan = buildReviewPlan(extraction(), SCHEMA);
    assert.equal(plan.requiresHumanConfirmation, true);
  });

  it("names the expiry date as something to check", () => {
    const plan = buildReviewPlan(extraction(), SCHEMA);
    assert.ok(plan.blockingReasons.some((reason) => /Expiry date/.test(reason)));
  });

  it("includes a field the model omitted entirely", () => {
    const plan = buildReviewPlan(extraction({ fields: [] }), SCHEMA);
    assert.equal(plan.fields.length, 2);
    assert.equal(plan.fields[0].verdict, "rejected");
  });

  it("flags an uncertain classification", () => {
    const plan = buildReviewPlan(
      extraction({
        classification: { documentTypeCode: "AE_TRADE_LICENCE", confidence: 0.4, alternatives: [] },
      }),
      SCHEMA,
    );
    assert.ok(plan.blockingReasons.some((reason) => /uncertain/i.test(reason)));
  });

  it("carries provider warnings through to the reviewer", () => {
    const plan = buildReviewPlan(extraction({ warnings: ["Scan is blurred"] }), SCHEMA);
    assert.ok(plan.blockingReasons.includes("Scan is blurred"));
  });
});

describe("validateUpload", () => {
  it("accepts a reasonable PDF", () => {
    assert.equal(validateUpload({ size: 1024, type: "application/pdf", name: "a.pdf" }).ok, true);
  });

  it("rejects an empty file, an oversized file and an unsupported type", () => {
    assert.equal(validateUpload({ size: 0, type: "application/pdf", name: "a.pdf" }).ok, false);
    assert.equal(validateUpload({ size: 40 * 1024 * 1024, type: "image/png", name: "a.png" }).ok, false);
    assert.equal(validateUpload({ size: 10, type: "application/zip", name: "a.zip" }).ok, false);
  });
});

describe("processDocument", () => {
  it("returns a plan and a file hash without touching a model", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const result = await processDocument(
      { bytes, mimeType: "application/pdf", filename: "licence.pdf" },
      [SCHEMA],
      new ManualEntryProvider(),
    );

    assert.equal(result.fileHash, hashFile(bytes));
    assert.equal(result.plan.requiresHumanConfirmation, true);
    assert.ok(result.extraction.warnings.length > 0);
  });

  it("refuses to run without candidate types", async () => {
    await assert.rejects(
      processDocument(
        { bytes: new Uint8Array([1]), mimeType: "application/pdf", filename: "a.pdf" },
        [],
        new ManualEntryProvider(),
      ),
      /at least one candidate/,
    );
  });
});

describe("corrections", () => {
  it("captures every field a human changed", () => {
    const plan = buildReviewPlan(extraction(), SCHEMA);
    const corrections = diffCorrections(plan, {
      expiryDate: "2026-11-30",
      documentNumber: "CN-1234567",
    });

    assert.equal(corrections.length, 1);
    assert.equal(corrections[0].fieldKey, "expiryDate");
    assert.equal(corrections[0].extractedValue, "2026-10-31");
    assert.equal(corrections[0].confirmedValue, "2026-11-30");
  });

  it("treats blank and null as the same, so no phantom correction is logged", () => {
    const plan = buildReviewPlan(extraction({ fields: [{ key: "documentNumber", value: null, confidence: 0.2 }] }), SCHEMA);
    const corrections = diffCorrections(plan, { documentNumber: "  " });
    assert.ok(!corrections.some((correction) => correction.fieldKey === "documentNumber"));
  });
});

describe("fieldAccuracy", () => {
  it("scores against a labelled set — the week-13 kill criterion", () => {
    const result = fieldAccuracy(
      [
        { key: "expiryDate", value: "2026-10-31" },
        { key: "documentNumber", value: "CN-999" },
      ],
      [
        { key: "expiryDate", value: "2026-10-31" },
        { key: "documentNumber", value: "CN-1234567" },
      ],
    );
    assert.equal(result.correct, 1);
    assert.equal(result.total, 2);
    assert.equal(result.accuracy, 0.5);
    assert.deepEqual(result.misses, ["documentNumber"]);
  });

  it("ignores case and surrounding whitespace", () => {
    const result = fieldAccuracy(
      [{ key: "holderName", value: "  AHMED  AL   MARZOOQI " }],
      [{ key: "holderName", value: "Ahmed Al Marzooqi" }],
    );
    assert.equal(result.accuracy, 1);
  });
});
