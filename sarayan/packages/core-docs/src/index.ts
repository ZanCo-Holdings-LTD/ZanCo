/**
 * @sarayan/core-docs
 *
 * Upload, OCR, extraction, confidence, confirmation.
 *
 * The pipeline is: validate the upload → hash and store → classify and extract
 * with a hosted vision model → build a review plan → a human confirms → only
 * then does a record exist. The model never writes a record on its own.
 */

export * from "./types";
export * from "./confidence";
export * from "./providers";

import { createHash } from "node:crypto";
import { buildReviewPlan, type ReviewPlan } from "./confidence";
import type { DocumentInput, ExtractionProvider, ExtractionResult, ExtractionSchema } from "./types";

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export const ACCEPTED_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
] as const;

export interface UploadValidation {
  ok: boolean;
  error: string | null;
}

export function validateUpload(file: { size: number; type: string; name: string }): UploadValidation {
  if (file.size === 0) return { ok: false, error: "The file is empty." };
  if (file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, error: `Files must be under ${Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.` };
  }
  if (!(ACCEPTED_MIME_TYPES as readonly string[]).includes(file.type)) {
    return { ok: false, error: "Upload a PDF, JPEG, PNG, WebP or HEIC file." };
  }
  return { ok: true, error: null };
}

/** Content hash of a stored file — printed in evidence packs as proof of what was held. */
export function hashFile(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export interface ProcessResult {
  extraction: ExtractionResult;
  plan: ReviewPlan;
  fileHash: string;
}

/**
 * Run a document through classification, extraction and the confidence policy.
 *
 * Returns a review plan, never a record. Committing is a separate, human-driven
 * step by design.
 */
export async function processDocument(
  input: DocumentInput,
  candidates: ExtractionSchema[],
  provider: ExtractionProvider,
): Promise<ProcessResult> {
  if (candidates.length === 0) {
    throw new Error("processDocument requires at least one candidate document type");
  }

  const extraction = await provider.classifyAndExtract(input, candidates);
  const schema =
    candidates.find((candidate) => candidate.documentTypeCode === extraction.classification.documentTypeCode) ??
    candidates[0];

  return {
    extraction,
    plan: buildReviewPlan(extraction, schema),
    fileHash: hashFile(input.bytes),
  };
}

/**
 * Corrections are the training signal. Every field a human changes is captured
 * so misclassifications feed the eval set rather than evaporating.
 */
export interface Correction {
  fieldKey: string;
  extractedValue: string | null;
  confirmedValue: string | null;
  confidence: number;
}

export function diffCorrections(
  plan: ReviewPlan,
  confirmed: Record<string, string | null>,
): Correction[] {
  const corrections: Correction[] = [];
  for (const field of plan.fields) {
    const confirmedValue = confirmed[field.key] ?? null;
    const extractedValue = field.value ?? null;
    if (normalise(confirmedValue) !== normalise(extractedValue)) {
      corrections.push({
        fieldKey: field.key,
        extractedValue,
        confirmedValue,
        confidence: field.confidence,
      });
    }
  }
  return corrections;
}

function normalise(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}
