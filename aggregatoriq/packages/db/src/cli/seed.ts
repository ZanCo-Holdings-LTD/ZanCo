import { createDatabase, createPool } from '../client.js';
import { loadDatabaseEnv } from '../env.js';
import { seedReferenceData } from '../seed.js';

const env = loadDatabaseEnv();
const pool = createPool({ url: env.DATABASE_URL, ssl: env.DATABASE_SSL, max: 1 });

try {
  await seedReferenceData(createDatabase(pool));
  console.log('Reference data seeded.');
} finally {
  await pool.end();
}
