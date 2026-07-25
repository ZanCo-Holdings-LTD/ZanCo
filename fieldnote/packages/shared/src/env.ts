import { z } from 'zod';

/**
 * Environment validation.
 *
 * Every process validates the slice of the environment it actually needs, at
 * boot, and exits non-zero on a bad value. A missing Deepgram key should stop
 * the worker starting, not surface as a 500 on someone's first survey.
 *
 * Client-side code may only ever import `clientEnvSchema`. Nothing with a
 * secret in it is reachable from a browser bundle.
 */

const url = z.string().url();
const nonEmpty = z.string().min(1);

/** Values safe to inline into the browser bundle. NEXT_PUBLIC_* only. */
export const clientEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: url,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: nonEmpty,
  NEXT_PUBLIC_SENTRY_DSN: z.string().optional(),
  NEXT_PUBLIC_POSTHOG_KEY: z.string().optional(),
  NEXT_PUBLIC_POSTHOG_HOST: url.optional(),
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().optional(),
});
export type ClientEnv = z.infer<typeof clientEnvSchema>;

const baseServerSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
  APP_URL: url,
  DATABASE_URL: nonEmpty,
  DIRECT_DATABASE_URL: nonEmpty.optional(),
  SUPABASE_SERVICE_ROLE_KEY: nonEmpty,
  SUPABASE_JWT_SECRET: nonEmpty,
  WORKER_URL: url,
  WORKER_INTERNAL_TOKEN: z.string().min(16, 'must be at least 16 characters'),
});

/** The Next.js server runtime: DB, storage, billing, enqueueing worker jobs. */
export const webEnvSchema = baseServerSchema.merge(clientEnvSchema).extend({
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_SOLO_MONTHLY: z.string().optional(),
  STRIPE_PRICE_TEAM_MONTHLY: z.string().optional(),
  STRIPE_PRICE_ANNUAL: z.string().optional(),
  STRIPE_PRICE_FOUNDING: z.string().optional(),
  SENTRY_DSN: z.string().optional(),
});
export type WebEnv = z.infer<typeof webEnvSchema>;

/** The worker. This is the only process that holds ASR and LLM keys. */
export const workerEnvSchema = baseServerSchema.extend({
  WORKER_PORT: z.coerce.number().int().positive().default(8080),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().max(32).default(4),

  DEEPGRAM_API_KEY: nonEmpty,
  DEEPGRAM_MODEL: z.string().default('nova-3'),
  DEEPGRAM_LANGUAGE: z.string().default('en-GB'),

  ANTHROPIC_API_KEY: nonEmpty,
  ANTHROPIC_STRUCTURING_MODEL: z.string().default('claude-sonnet-5'),
  ANTHROPIC_EFFORT: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).default('medium'),

  EMBEDDING_PROVIDER: z.enum(['openai', 'voyage']).default('openai'),
  EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
  EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().default(1536),
  OPENAI_API_KEY: z.string().optional(),
  VOYAGE_API_KEY: z.string().optional(),

  RESEND_API_KEY: nonEmpty,
  DELIVERY_FROM_EMAIL: z.string().email(),
  DELIVERY_FROM_NAME: z.string().default('Fieldnote'),
  RESEND_WEBHOOK_SECRET: z.string().optional(),

  SENTRY_DSN: z.string().optional(),
  INFERENCE_COST_ALERT_RATIO: z.coerce.number().min(0).max(1).default(0.12),

  NEXT_PUBLIC_SUPABASE_URL: url,
});
export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export class EnvValidationError extends Error {
  constructor(public readonly issues: z.ZodIssue[]) {
    const lines = issues.map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`);
    super(`Invalid environment:\n${lines.join('\n')}`);
    this.name = 'EnvValidationError';
  }
}

/**
 * Parse `source` against `schema`, throwing a readable aggregate error.
 * Set SKIP_ENV_VALIDATION=1 for build-time steps that never open a socket.
 */
export function parseEnv<T extends z.ZodTypeAny>(
  schema: T,
  source: Record<string, string | undefined> = process.env,
): z.infer<T> {
  if (source.SKIP_ENV_VALIDATION === '1') {
    return source as z.infer<T>;
  }
  const result = schema.safeParse(source);
  if (!result.success) {
    throw new EnvValidationError(result.error.issues);
  }
  return result.data;
}

/**
 * Provider-specific keys are optional in the schema so a deployment can pick
 * one, but the chosen provider's key is not optional. Checked at boot.
 */
export function assertEmbeddingProviderConfigured(env: WorkerEnv): void {
  const key = env.EMBEDDING_PROVIDER === 'openai' ? env.OPENAI_API_KEY : env.VOYAGE_API_KEY;
  if (!key) {
    throw new EnvValidationError([
      {
        code: z.ZodIssueCode.custom,
        path: [env.EMBEDDING_PROVIDER === 'openai' ? 'OPENAI_API_KEY' : 'VOYAGE_API_KEY'],
        message: `required when EMBEDDING_PROVIDER is "${env.EMBEDDING_PROVIDER}"`,
      },
    ]);
  }
}
