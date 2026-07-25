/**
 * Worker environment, validated at boot.
 *
 * Everything the worker needs is checked before it accepts a request. A missing
 * webhook secret discovered on the first inbound email is a statement lost; a
 * missing one discovered at boot is a deploy that did not happen.
 */
import { z } from 'zod';

const booleanish = z
  .string()
  .optional()
  .transform((value) => value === 'true' || value === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z
    .string()
    .default('8080')
    .transform((value) => Number(value))
    .refine((value) => Number.isInteger(value) && value > 0, 'PORT must be a positive integer'),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DATABASE_URL: z.string().min(1),
  DATABASE_SSL: booleanish,

  /**
   * Shared secret for calls from the web app. The worker holds capabilities the
   * web tier deliberately does not — it can write the canonical layer and run
   * reconciliations across organisations — so the boundary between them is
   * authenticated rather than assumed.
   */
  INTERNAL_API_TOKEN: z.string().min(32, 'INTERNAL_API_TOKEN must be at least 32 characters'),

  /** Verifies Resend's signature on inbound email. */
  INBOUND_EMAIL_SECRET: z.string().min(16).optional(),
  INBOUND_EMAIL_DOMAIN: z.string().default('in.aggregatoriq.com'),

  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_PATH: z.string().default('./.storage'),
  STORAGE_S3_BUCKET: z.string().optional(),
  STORAGE_S3_REGION: z.string().optional(),
  STORAGE_S3_ENDPOINT: z.string().optional(),

  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  MOYASAR_SECRET_KEY: z.string().optional(),
  MOYASAR_WEBHOOK_SECRET: z.string().optional(),

  /**
   * Enables the schema-guided extraction rung. Off by default: a deployment with
   * no key configured must fall back to the manual review queue rather than
   * failing documents, and turning this on is a deliberate act.
   */
  EXTRACTION_ENABLED: booleanish,
  ANTHROPIC_API_KEY: z.string().optional(),
  EXTRACTION_MODEL: z.string().default('claude-sonnet-5'),
});

export type WorkerEnv = z.infer<typeof schema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): WorkerEnv {
  const parsed = schema.safeParse(source);

  if (!parsed.success) {
    const issues = parsed.error.issues.map(
      (issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`,
    );
    throw new Error(`Invalid worker environment:\n${issues.join('\n')}`);
  }

  const env = parsed.data;

  // Cross-field checks the schema cannot express on its own.
  if (env.EXTRACTION_ENABLED && !env.ANTHROPIC_API_KEY) {
    throw new Error(
      'EXTRACTION_ENABLED is set but ANTHROPIC_API_KEY is missing. Without a key the ' +
        'extraction rung cannot run, and documents would fail rather than falling back to ' +
        'the manual review queue.',
    );
  }
  if (env.STORAGE_DRIVER === 's3' && !env.STORAGE_S3_BUCKET) {
    throw new Error('STORAGE_DRIVER is "s3" but STORAGE_S3_BUCKET is missing.');
  }
  if (env.NODE_ENV === 'production' && !env.INBOUND_EMAIL_SECRET) {
    throw new Error(
      'INBOUND_EMAIL_SECRET is required in production. The inbound email endpoint accepts ' +
        'files from anyone who knows the address, so an unverified webhook is an open door ' +
        'to poisoning a customer’s reconciliation.',
    );
  }

  return env;
}
