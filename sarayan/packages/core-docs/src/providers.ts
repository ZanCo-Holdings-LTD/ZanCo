/**
 * Extraction providers.
 *
 * Two implementations ship: a hosted vision model (Anthropic), and a manual
 * provider used when no key is configured. The manual provider is not a stub —
 * it is the documented fallback that keeps upload working with human entry, and
 * it is what runs in CI.
 */

import type {
  ClassificationResult,
  DocumentInput,
  ExtractedField,
  ExtractionProvider,
  ExtractionResult,
  ExtractionSchema,
} from "./types";

/** Used when no model is configured: capture the file, let a human type the fields. */
export class ManualEntryProvider implements ExtractionProvider {
  readonly id = "manual";

  async classifyAndExtract(
    _input: DocumentInput,
    candidates: ExtractionSchema[],
  ): Promise<ExtractionResult> {
    const schema = candidates[0];
    return {
      classification: { documentTypeCode: schema?.documentTypeCode ?? null, confidence: 0, alternatives: [] },
      fields: (schema?.fields ?? []).map((spec) => ({ key: spec.key, value: null, confidence: 0 })),
      model: this.id,
      latencyMs: 0,
      warnings: ["Automatic extraction is not configured — enter the fields manually."],
    };
  }
}

export interface VisionProviderOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  /** Abort slow calls rather than holding an upload request open. */
  timeoutMs?: number;
}

const SUPPORTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

/**
 * Hosted vision model with a structured output schema per document type.
 *
 * Classification and extraction happen in one call, as the brief specifies:
 * the model picks the document type from the supplied candidates, then fills
 * that type's fields. Per-field confidence is requested explicitly.
 */
export class AnthropicVisionProvider implements ExtractionProvider {
  readonly id: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options: VisionProviderOptions) {
    this.apiKey = options.apiKey;
    this.id = options.model ?? "claude-opus-5";
    this.baseUrl = options.baseUrl ?? "https://api.anthropic.com";
    this.timeoutMs = options.timeoutMs ?? 60_000;
  }

  async classifyAndExtract(
    input: DocumentInput,
    candidates: ExtractionSchema[],
  ): Promise<ExtractionResult> {
    const startedAt = Date.now();
    const isPdf = input.mimeType === "application/pdf";
    if (!isPdf && !SUPPORTED_IMAGE_TYPES.has(input.mimeType)) {
      return {
        classification: { documentTypeCode: null, confidence: 0, alternatives: [] },
        fields: [],
        model: this.id,
        latencyMs: 0,
        warnings: [`Cannot read ${input.mimeType}. Upload a PDF or an image, or enter fields manually.`],
      };
    }

    const source = {
      type: "base64" as const,
      media_type: input.mimeType,
      data: Buffer.from(input.bytes).toString("base64"),
    };

    const body = {
      model: this.id,
      max_tokens: 2048,
      temperature: 0,
      tools: [
        {
          name: "record_document",
          description: "Record the classification and extracted fields for this document.",
          input_schema: toolSchema(candidates),
        },
      ],
      tool_choice: { type: "tool" as const, name: "record_document" },
      messages: [
        {
          role: "user" as const,
          content: [
            isPdf
              ? { type: "document" as const, source }
              : { type: "image" as const, source },
            { type: "text" as const, text: buildPrompt(candidates) },
          ],
        },
      ],
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        return failure(this.id, Date.now() - startedAt, `Extraction service returned ${response.status}. ${detail.slice(0, 200)}`);
      }

      const payload = (await response.json()) as {
        content?: Array<{ type: string; name?: string; input?: unknown }>;
      };
      const toolUse = payload.content?.find((block) => block.type === "tool_use");
      if (!toolUse?.input) {
        return failure(this.id, Date.now() - startedAt, "Extraction returned no structured output.");
      }

      return {
        ...parseToolOutput(toolUse.input, candidates),
        model: this.id,
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      const message =
        error instanceof Error && error.name === "AbortError"
          ? "Extraction timed out. Enter the fields manually or try a smaller file."
          : `Extraction failed: ${error instanceof Error ? error.message : "unknown error"}`;
      return failure(this.id, Date.now() - startedAt, message);
    } finally {
      clearTimeout(timer);
    }
  }
}

function failure(model: string, latencyMs: number, warning: string): ExtractionResult {
  return {
    classification: { documentTypeCode: null, confidence: 0, alternatives: [] },
    fields: [],
    model,
    latencyMs,
    warnings: [warning],
  };
}

function buildPrompt(candidates: ExtractionSchema[]): string {
  const list = candidates
    .map((schema) => {
      const fields = schema.fields
        .map((field) => `      - ${field.key} (${field.kind})${field.hint ? `: ${field.hint}` : ""}`)
        .join("\n");
      return `  ${schema.documentTypeCode} — ${schema.documentTypeLabel} (${schema.country})\n${fields}`;
    })
    .join("\n");

  return [
    "You are reading a scanned government or corporate document from the Gulf region.",
    "The document may be in Arabic, English, or both.",
    "",
    "Step 1: classify it as exactly one of these document types:",
    list,
    "",
    "Step 2: extract that type's fields.",
    "",
    "Rules:",
    "- Dates must be returned as YYYY-MM-DD. Gulf documents commonly print DD/MM/YYYY; do not",
    "  swap day and month. If a document shows both Hijri and Gregorian dates, return the Gregorian one.",
    "- Report confidence per field, honestly. A low score costs a human ten seconds; a confident",
    "  wrong expiry date costs the customer a fine. Score low when the scan is unclear, when a digit",
    "  is ambiguous, or when you are inferring rather than reading.",
    "- For every field, copy the exact text you read into source_text so a human can compare it",
    "  against the image.",
    "- If a field is genuinely absent, return null rather than guessing.",
    "- Never infer an expiry date from an issue date plus a typical validity period. Read it or return null.",
  ].join("\n");
}

function toolSchema(candidates: ExtractionSchema[]) {
  const allKeys = new Set<string>();
  for (const schema of candidates) for (const field of schema.fields) allKeys.add(field.key);

  return {
    type: "object" as const,
    properties: {
      document_type_code: {
        type: "string",
        enum: candidates.map((schema) => schema.documentTypeCode),
        description: "The single best matching document type code.",
      },
      document_type_confidence: { type: "number", minimum: 0, maximum: 1 },
      alternatives: {
        type: "array",
        items: {
          type: "object",
          properties: {
            document_type_code: { type: "string" },
            confidence: { type: "number", minimum: 0, maximum: 1 },
          },
          required: ["document_type_code", "confidence"],
        },
      },
      fields: {
        type: "array",
        description: "One entry per field belonging to the chosen document type.",
        items: {
          type: "object",
          properties: {
            key: { type: "string", enum: [...allKeys] },
            value: { type: ["string", "null"] },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            source_text: { type: ["string", "null"] },
          },
          required: ["key", "value", "confidence"],
        },
      },
      notes: { type: "array", items: { type: "string" } },
    },
    required: ["document_type_code", "document_type_confidence", "fields"],
  };
}

function parseToolOutput(
  raw: unknown,
  candidates: ExtractionSchema[],
): Pick<ExtractionResult, "classification" | "fields" | "warnings"> {
  const input = raw as {
    document_type_code?: unknown;
    document_type_confidence?: unknown;
    alternatives?: unknown;
    fields?: unknown;
    notes?: unknown;
  };

  const validCodes = new Set(candidates.map((schema) => schema.documentTypeCode));
  const code = typeof input.document_type_code === "string" && validCodes.has(input.document_type_code)
    ? input.document_type_code
    : null;

  const classification: ClassificationResult = {
    documentTypeCode: code,
    confidence: code ? clamp01(input.document_type_confidence) : 0,
    alternatives: Array.isArray(input.alternatives)
      ? input.alternatives
          .map((entry) => entry as { document_type_code?: unknown; confidence?: unknown })
          .filter((entry) => typeof entry.document_type_code === "string" && validCodes.has(entry.document_type_code))
          .map((entry) => ({
            documentTypeCode: entry.document_type_code as string,
            confidence: clamp01(entry.confidence),
          }))
          .slice(0, 3)
      : [],
  };

  const schema = candidates.find((candidate) => candidate.documentTypeCode === code);
  const allowedKeys = new Set((schema ?? candidates[0])?.fields.map((field) => field.key) ?? []);

  const fields: ExtractedField[] = Array.isArray(input.fields)
    ? input.fields
        .map((entry) => entry as { key?: unknown; value?: unknown; confidence?: unknown; source_text?: unknown })
        .filter((entry) => typeof entry.key === "string" && allowedKeys.has(entry.key))
        .map((entry) => ({
          key: entry.key as string,
          value: typeof entry.value === "string" && entry.value.trim() !== "" ? entry.value.trim() : null,
          confidence: clamp01(entry.confidence),
          sourceText: typeof entry.source_text === "string" ? entry.source_text : null,
        }))
    : [];

  const warnings = Array.isArray(input.notes)
    ? input.notes.filter((note): note is string => typeof note === "string").slice(0, 5)
    : [];
  if (!code) warnings.push("The document type could not be determined — choose it manually.");

  return { classification, fields, warnings };
}

function clamp01(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.min(1, Math.max(0, numeric));
}
