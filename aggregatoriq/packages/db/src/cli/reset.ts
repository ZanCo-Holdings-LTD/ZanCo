import { createDatabase, createPool } from '../client.js';
import { loadDatabaseEnv } from '../env.js';
import { migrate, resetSchema } from '../migrate.js';
import { seedReferenceData } from '../seed.js';

/**
 * Drop everything and rebuild. Development only.
 *
 * Guarded by an explicit argument rather than a NODE_ENV check, because a
 * NODE_ENV check is exactly the thing that is wrong on the day it matters.
 */
if (process.argv[2] !== '--yes-destroy-all-data') {
  console.error('Refusing to reset. Re-run with --yes-destroy-all-data if you mean it.');
  process.exit(1);
}

const env = loadDatabaseEnv();
const pool = createPool({ url: env.DATABASE_URL, ssl: env.DATABASE_SSL, max: 1 });

try {
  await resetSchema(pool, 'yes-destroy-all-data');
  await migrate(pool, { log: (message) => console.log(`  ${message}`) });
  await seedReferenceData(createDatabase(pool));
  console.log('Database reset, migrated and seeded.');
} finally {
  await pool.end();
}
