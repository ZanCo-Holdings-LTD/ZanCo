import Anthropic from '@anthropic-ai/sdk';
import { AppError } from '@fieldnote/shared';
import type {
  SectionStructuringInput,
  SectionStructuringResult,
  StructuringUsage,
} from '@fieldnote/shared';
import { buildSectionSchema, type RawSectionOutput } from './schema.js';
import { discardUngrounded, groundSection } from './guardrails.js';
import { groundingRetryInstruction, SYSTEM_PROMPT } from './prompts/system.js';
import { renderSectionInput, renderSectionSpec } from './prompts/section.js';
import { PROMPT_VERSION } from './prompts/version.js';

/**
 * Stage 2: structuring.
 *
 * One call per report section, never one for the whole report. Sections are
 * independent, so per-section calls keep each prompt small enough that the
 * model attends to every field, let a failure be retried in isolation, and cost
 * roughly the same because the expensive shared prefix is cached either way.
 */

export interface StructuringClientOptions {
  apiKey: string;
  model: string;
  effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  maxTokens?: number;
  /** Injectable for tests and the eval harness. */
  client?: Anthropic;
}

/**
 * The parts of the request the SDK's published types do not yet cover.
 * `output_config` carries both the effort level and the JSON schema.
 */
interface OutputConfig {
  effort: string;
  format: { type: 'json_schema'; schema: Record<string, unknown> };
}

export function createClient(options: StructuringClientOptions): Anthropic {
  return options.client ?? new Anthropic({ apiKey: options.apiKey, maxRetries: 3 });
}

export async function structureSection(
  input: SectionStructuringInput,
  options: StructuringClientOptions,
): Promise<SectionStructuringResult> {
  const client = createClient(options);
  const schema = buildSectionSchema(input.section);
  const sectionSpec = renderSectionSpec(input.section);
  const sectionInput = renderSectionInput({
    section: input.section,
    transcript: input.transcript,
    photos: input.photos,
    phraseExamples: input.phraseExamples,
  });

  const usage: StructuringUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    model: options.model,
  };

  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: sectionInput }];

  const first = await callModel(client, options, sectionSpec, schema, messages, usage);
  let result = groundSection(input.section, first.fields, input.transcript, input.captureId);
  let retried = false;

  // One retry, and only one. If the model cannot cite its own claim twice, the
  // claim is not worth keeping — a second retry would mostly buy latency.
  if (result.failedFieldKeys.length > 0) {
    retried = true;
    messages.push(
      { role: 'assistant', content: JSON.stringify(first) },
      { role: 'user', content: groundingRetryInstruction(result.failedFieldKeys) },
    );

    const second = await callModel(client, options, sectionSpec, schema, messages, usage);
    const retryResult = groundSection(
      input.section,
      second.fields,
      input.transcript,
      input.captureId,
    );

    // Keep whatever the retry grounded; anything still failing is discarded.
    result = {
      grounded: mergeGrounded(result.grounded, retryResult.grounded),
      failedFieldKeys: retryResult.failedFieldKeys,
    };
  }

  const fields = discardUngrounded(result.grounded, result.failedFieldKeys);

  return {
    section: { sectionKey: input.section.key, fields },
    usage,
    promptVersion: PROMPT_VERSION,
    retried,
    ungroundedFieldKeys: result.failedFieldKeys,
  };
}

/** Retry results win: they are the model's corrected answer for those fields. */
function mergeGrounded(
  first: SectionStructuringResult['section']['fields'],
  second: SectionStructuringResult['section']['fields'],
): SectionStructuringResult['section']['fields'] {
  const merged = new Map(first.map((field) => [field.fieldKey, field]));
  for (const field of second) merged.set(field.fieldKey, field);
  return [...merged.values()];
}

async function callModel(
  client: Anthropic,
  options: StructuringClientOptions,
  sectionSpec: string,
  schema: Record<string, unknown>,
  messages: Anthropic.MessageParam[],
  usage: StructuringUsage,
): Promise<RawSectionOutput> {
  const outputConfig: OutputConfig = {
    effort: options.effort,
    format: { type: 'json_schema', schema },
  };

  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: options.model,
      max_tokens: options.maxTokens ?? 8192,
      // Adaptive thinking: the model decides how much reasoning a section needs.
      // A one-field section should not pay for the deliberation a twelve-field
      // section deserves.
      thinking: { type: 'adaptive' },
      system: [
        // Byte-identical across every call in the product.
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
        // Identical for every report on this template.
        {
          type: 'text',
          text: sectionSpec,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages,
      ...({ output_config: outputConfig } as unknown as Record<string, never>),
    });
  } catch (error: unknown) {
    if (error instanceof Anthropic.APIError) {
      throw new AppError('upstream_failed', `Structuring call failed: ${error.message}`, {
        retryable: error.status === undefined || error.status >= 500 || error.status === 429,
        details: { status: error.status },
        cause: error,
      });
    }
    throw error;
  }

  accumulateUsage(usage, response);

  // Safety classifiers can decline a request. This arrives as a 200 with an
  // empty content array, so reading content[0] first would throw a confusing
  // TypeError instead of surfacing what actually happened.
  if (response.stop_reason === 'refusal') {
    throw new AppError('upstream_failed', 'The model declined to process this section', {
      retryable: false,
      details: { stopReason: response.stop_reason },
    });
  }

  if (response.stop_reason === 'max_tokens') {
    throw new AppError('upstream_failed', 'Structuring output was truncated', {
      retryable: true,
      details: { stopReason: response.stop_reason },
    });
  }

  const text = response.content.find((block) => block.type === 'text');
  if (!text || text.type !== 'text') {
    throw new AppError('upstream_failed', 'Structuring response contained no text block', {
      retryable: true,
    });
  }

  return parseSectionOutput(text.text);
}

/**
 * Parse the constrained JSON response.
 *
 * `output_config.format` guarantees the shape, so a parse failure here means
 * something upstream changed — worth a loud error rather than a silent empty
 * section that would look like "the inspector mentioned nothing".
 */
export function parseSectionOutput(text: string): RawSectionOutput {
  try {
    const parsed = JSON.parse(text) as RawSectionOutput;
    if (!parsed || !Array.isArray(parsed.fields)) {
      throw new Error('missing fields array');
    }
    return parsed;
  } catch (error: unknown) {
    throw new AppError('upstream_failed', 'Structuring response was not valid JSON', {
      retryable: true,
      details: { sample: text.slice(0, 200) },
      cause: error,
    });
  }
}

function accumulateUsage(usage: StructuringUsage, response: Anthropic.Message): void {
  usage.inputTokens += response.usage.input_tokens ?? 0;
  usage.outputTokens += response.usage.output_tokens ?? 0;
  usage.cacheReadInputTokens += response.usage.cache_read_input_tokens ?? 0;
  usage.cacheCreationInputTokens += response.usage.cache_creation_input_tokens ?? 0;
}
