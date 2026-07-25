import { createDatabase, createPool } from '../client.js';
import { loadDatabaseEnv } from '../env.js';
import { migrate } from '../migrate.js';
import { seedReferenceData } from '../seed.js';

const env = loadDatabaseEnv();
const pool = createPool({ url: env.DATABASE_URL, ssl: env.DATABASE_SSL, max: 1 });

try {
  const result = await migrate(pool, { log: (message) => console.log(`  ${message}`) });

  if (result.applied.length === 0) {
    console.log(`Schema up to date (${result.skipped.length} migration(s) already applied).`);
  } else {
    console.log(`Applied ${result.applied.length} migration(s): ${result.applied.join(', ')}`);
  }

  // Reference data is part of the schema's meaning, not a separate step someone
  // can forget: a database with no cause codes cannot store a variance.
  await seedReferenceData(createDatabase(pool));
  console.log('Reference data seeded.');
} finally {
  await pool.end();
}
