import 'server-only';
import { z } from 'zod';

/**
 * Server environment, validated at boot.
 *
 * `server-only` at the top is the load-bearing line. It makes importing this
 * module from a client component a build error, so the database URL and the
 * internal API token cannot reach a browser bundle by way of someone adding
 * `'use client'` to a file that already imported it.
 *
 * Public configuration lives in `publicEnv` below and is deliberately a separate
 * object with a separate schema, so the split is visible rather than a
 * convention about prefixes.
 */
const serverSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DATABASE_SSL: z
    .string()
    .optional()
    .transform((value) => value === 'true' || value === '1'),

  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),

  /** Authenticates calls to the worker, which holds capabilities this tier does not. */
  WORKER_URL: z.string().url().default('http://localhost:8080'),
  INTERNAL_API_TOKEN: z.string().min(32, 'INTERNAL_API_TOKEN must be at least 32 characters'),
});

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
  NEXT_PUBLIC_INBOUND_EMAIL_DOMAIN: z.string().default('in.aggregatoriq.com'),
});

export type ServerEnv = z.infer<typeof serverSchema>;
export type PublicEnv = z.infer<typeof publicSchema>;

function fail(label: string, error: z.ZodError): never {
  const issues = error.issues.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`);
  throw new Error(`Invalid ${label} environment:\n${issues.join('\n')}`);
}

let cachedServerEnv: ServerEnv | null = null;

export function serverEnv(): ServerEnv {
  if (cachedServerEnv !== null) return cachedServerEnv;

  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) fail('server', parsed.error);

  cachedServerEnv = parsed.data;
  return cachedServerEnv;
}

/**
 * Public configuration.
 *
 * Read through explicit `process.env.NEXT_PUBLIC_*` references rather than a
 * loop, because Next inlines these at build time by literal match and a
 * dynamically-built key would come back undefined in the browser.
 */
export function publicEnv(): PublicEnv {
  const parsed = publicSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_INBOUND_EMAIL_DOMAIN: process.env.NEXT_PUBLIC_INBOUND_EMAIL_DOMAIN,
  });

  if (!parsed.success) fail('public', parsed.error);
  return parsed.data;
}
