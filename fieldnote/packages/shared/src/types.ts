import { z } from 'zod';
import { FIELD_TYPES, ORG_ROLES, REPORT_STATUSES, VERTICALS } from './constants.js';

/**
 * Wire types shared between the worker (which produces them), the web app
 * (which renders them) and the eval harness (which scores them).
 *
 * These are zod schemas rather than bare interfaces because the worker parses
 * untrusted model output against them before anything reaches the database.
 */

/**
 * Where a generated value came from in the raw transcript.
 *
 * This is the provenance record. Stage 3 of the pipeline refuses to persist a
 * field whose source span does not resolve to real transcript text — a missing
 * field is recoverable, a fabricated finding is a PI claim.
 */
export const sourceSpanSchema = z.object({
  captureId: z.string().uuid(),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  charRange: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]),
  /** Verbatim transcript slice. Stored so the reviewer sees exactly what was said. */
  quote: z.string(),
});
export type SourceSpan = z.infer<typeof sourceSpanSchema>;

/** A single value produced by the structuring stage for one template field. */
export const generatedFieldSchema = z.object({
  fieldKey: z.string().min(1),
  /** `null` means "not stated". Never a guess. */
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.null()]),
  confidence: z.number().min(0).max(1),
  sourceSpan: sourceSpanSchema.nullable(),
});
export type GeneratedField = z.infer<typeof generatedFieldSchema>;

export const structuredSectionSchema = z.object({
  sectionKey: z.string().min(1),
  fields: z.array(generatedFieldSchema),
});
export type StructuredSection = z.infer<typeof structuredSectionSchema>;

/** A transcript word with timing, as returned by the cloud ASR pass. */
export const transcriptWordSchema = z.object({
  word: z.string(),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  confidence: z.number().min(0).max(1),
});
export type TranscriptWord = z.infer<typeof transcriptWordSchema>;

export const transcriptSchema = z.object({
  text: z.string(),
  words: z.array(transcriptWordSchema),
  provider: z.string(),
  model: z.string(),
  /** Mean word confidence, used to flag captures recorded in poor conditions. */
  meanConfidence: z.number().min(0).max(1),
  durationMs: z.number().int().nonnegative(),
});
export type Transcript = z.infer<typeof transcriptSchema>;

export const fieldTypeSchema = z.enum(FIELD_TYPES);
export const orgRoleSchema = z.enum(ORG_ROLES);
export const reportStatusSchema = z.enum(REPORT_STATUSES);
export const verticalSchema = z.enum(VERTICALS);

/** Template field definition as the structuring prompt sees it. */
export const templateFieldDefSchema = z.object({
  id: z.string().uuid(),
  key: z.string().min(1),
  label: z.string().min(1),
  type: fieldTypeSchema,
  required: z.boolean(),
  enumValues: z.array(z.string()).nullable(),
  extractionHint: z.string().nullable(),
  orderIndex: z.number().int(),
});
export type TemplateFieldDef = z.infer<typeof templateFieldDefSchema>;

export const templateSectionDefSchema = z.object({
  id: z.string().uuid(),
  key: z.string().min(1),
  title: z.string().min(1),
  guidance: z.string().nullable(),
  orderIndex: z.number().int(),
  fields: z.array(templateFieldDefSchema),
});
export type TemplateSectionDef = z.infer<typeof templateSectionDefSchema>;

/** One nearest-neighbour example fed back into the structuring prompt. */
export const phraseExampleSchema = z.object({
  generatedText: z.string(),
  finalText: z.string(),
});
export type PhraseExample = z.infer<typeof phraseExampleSchema>;

/** Photo caption context supplied alongside the transcript span. */
export const photoContextSchema = z.object({
  id: z.string().uuid(),
  caption: z.string().nullable(),
  captureOffsetMs: z.number().int().nonnegative().nullable(),
});
export type PhotoContext = z.infer<typeof photoContextSchema>;

/** Everything one structuring call needs. One call per section, never per report. */
export interface SectionStructuringInput {
  section: TemplateSectionDef;
  transcript: Transcript;
  captureId: string;
  photos: PhotoContext[];
  phraseExamples: Record<string, PhraseExample[]>;
}

export interface StructuringUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  model: string;
}

export interface SectionStructuringResult {
  section: StructuredSection;
  usage: StructuringUsage;
  promptVersion: string;
  /** True when the first attempt failed grounding and a retry was issued. */
  retried: boolean;
  /** Fields dropped to null because they could not be grounded after retry. */
  ungroundedFieldKeys: string[];
}
