/** Shared vocabulary for the extraction pipeline. */

export type FieldKind = "text" | "date" | "number" | "authority" | "name";

export interface FieldSpec {
  key: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  /** Hint passed to the vision model, e.g. "the Emirates ID number, 15 digits". */
  hint?: string;
  /**
   * Fields where a wrong value is catastrophic rather than annoying. These
   * always demand human confirmation regardless of the model's confidence.
   */
  critical?: boolean;
  pattern?: string;
}

export interface ExtractionSchema {
  documentTypeCode: string;
  documentTypeLabel: string;
  country: string;
  fields: FieldSpec[];
}

export interface ExtractedField {
  key: string;
  value: string | null;
  /** Model self-reported confidence, 0-1. Treated as a signal, never a promise. */
  confidence: number;
  /** Verbatim text the model claims it read, shown next to the source image. */
  sourceText?: string | null;
}

export interface ClassificationResult {
  documentTypeCode: string | null;
  confidence: number;
  /** Runner-up guesses, offered in the confirmation UI as one-click corrections. */
  alternatives: Array<{ documentTypeCode: string; confidence: number }>;
}

export interface ExtractionResult {
  classification: ClassificationResult;
  fields: ExtractedField[];
  /** Provider identifier, recorded so eval sets can be split by model version. */
  model: string;
  /** Milliseconds the provider call took, for COGS tracking. */
  latencyMs: number;
  warnings: string[];
}

export interface DocumentInput {
  /** Raw file bytes. */
  bytes: Uint8Array;
  mimeType: string;
  filename: string;
}

export interface ExtractionProvider {
  readonly id: string;
  classifyAndExtract(
    input: DocumentInput,
    candidates: ExtractionSchema[],
  ): Promise<ExtractionResult>;
}
