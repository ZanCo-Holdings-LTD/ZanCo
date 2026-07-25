/**
 * Reference data.
 *
 * Aggregators and cause codes are the product's own data, not a tenant's. They
 * are seeded from `@aggregatoriq/core` so that the taxonomy in the database and
 * the taxonomy the engine emits are the same list by construction — a mismatch
 * would mean a rule producing a code no dispute template exists for.
 *
 * Idempotent: safe to run on every deploy.
 */
import { AGGREGATOR_CODES, AGGREGATOR_COUNTRIES, AGGREGATOR_NAMES, CAUSE_CODES } from '@aggregatoriq/core';
import { sql } from 'drizzle-orm';
import type { Database } from './client.js';
import { aggregators, causeCodes } from './schema.js';

export async function seedReferenceData(db: Database): Promise<void> {
  await db
    .insert(aggregators)
    .values(
      AGGREGATOR_CODES.map((code) => ({
        code,
        name: AGGREGATOR_NAMES[code],
        countries: [...AGGREGATOR_COUNTRIES[code]],
      })),
    )
    .onConflictDoUpdate({
      target: aggregators.code,
      set: { name: sql`excluded.name`, countries: sql`excluded.countries` },
    });

  await db
    .insert(causeCodes)
    .values(
      CAUSE_CODES.map((cause) => ({
        code: cause.code,
        label: cause.label,
        labelAr: cause.labelAr,
        description: cause.description,
        disputeTemplateKey: cause.disputeTemplateKey,
        recoverability: cause.recoverability,
        countsTowardsRecovery: cause.countsTowardsRecovery,
      })),
    )
    .onConflictDoUpdate({
      target: causeCodes.code,
      set: {
        label: sql`excluded.label`,
        labelAr: sql`excluded.label_ar`,
        description: sql`excluded.description`,
        disputeTemplateKey: sql`excluded.dispute_template_key`,
        recoverability: sql`excluded.recoverability`,
        countsTowardsRecovery: sql`excluded.counts_towards_recovery`,
      },
    });
}
