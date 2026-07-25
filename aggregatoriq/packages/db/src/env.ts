/**
 * Database environment, validated at boot.
 *
 * Failing at startup with "DATABASE_URL is not set" beats failing on the first
 * query with a connection error nobody can attribute.
 */
import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DATABASE_SSL: z
    .string()
    .optional()
    .transform((value) => value === 'true' || value === '1'),
  DATABASE_POOL_MAX: z
    .string()
    .optional()
    .transform((value) => (value === undefined ? 10 : Number(value)))
    .refine((value) => Number.isInteger(value) && value > 0, 'DATABASE_POOL_MAX must be a positive integer'),
});

export type DatabaseEnv = z.infer<typeof schema>;

export function loadDatabaseEnv(source: NodeJS.ProcessEnv = process.env): DatabaseEnv {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Invalid database environment:\n  ${issues.join('\n  ')}`);
  }
  return parsed.data;
}
