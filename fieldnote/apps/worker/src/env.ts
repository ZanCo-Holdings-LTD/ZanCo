import {
  assertEmbeddingProviderConfigured,
  parseEnv,
  workerEnvSchema,
} from '@fieldnote/shared/env';
import type { WorkerEnv } from '@fieldnote/shared/env';

/**
 * Validated once at boot.
 *
 * A missing Deepgram key should stop the process starting, not surface as a
 * failed job three hours into someone's first survey.
 */
export const env: WorkerEnv = parseEnv(workerEnvSchema);

assertEmbeddingProviderConfigured(env);

export const embeddingApiKey =
  (env.EMBEDDING_PROVIDER === 'openai' ? env.OPENAI_API_KEY : env.VOYAGE_API_KEY) ?? '';
