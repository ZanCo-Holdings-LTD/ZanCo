/**
 * Migration runner.
 *
 * Applies every .sql file in ./migrations in filename order, each in its own
 * transaction, recording what it applied in `_fieldnote_migrations`. Files are
 * hand-written rather than generated because the RLS policies are the security
 * boundary and need to be reviewed as source, not as a diff artefact.
 *
 * Uses the direct (non-pooled) connection: DDL and PgBouncer's transaction
 * pooling do not mix.
 */
import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '../../migrations');

async function main(): Promise<void> {
  const url = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.error('DIRECT_DATABASE_URL or DATABASE_URL must be set.');
    process.exit(1);
  }

  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });

  try {
    await sql`
      create table if not exists _fieldnote_migrations (
        name        text primary key,
        checksum    text not null,
        applied_at  timestamptz not null default now()
      )
    `;

    const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
    const applied = await sql<{ name: string; checksum: string }[]>`
      select name, checksum from _fieldnote_migrations
    `;
    const appliedByName = new Map(applied.map((row) => [row.name, row.checksum]));

    let ran = 0;
    for (const file of files) {
      const body = await readFile(join(migrationsDir, file), 'utf8');
      const checksum = createHash('sha256').update(body).digest('hex');
      const previous = appliedByName.get(file);

      if (previous) {
        if (previous !== checksum) {
          // An already-applied migration changed on disk. Silently ignoring
          // this is how two environments end up with different schemas.
          throw new Error(
            `Migration ${file} has been modified since it was applied. ` +
              `Add a new migration instead of editing an applied one.`,
          );
        }
        continue;
      }

      process.stdout.write(`  applying ${file} ... `);
      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`
          insert into _fieldnote_migrations (name, checksum) values (${file}, ${checksum})
        `;
      });
      process.stdout.write('ok\n');
      ran += 1;
    }

    console.log(ran === 0 ? 'Database already up to date.' : `Applied ${ran} migration(s).`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  console.error('\nMigration failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
