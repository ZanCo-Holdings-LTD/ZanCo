/**
 * Drop and recreate the public schema, then re-run migrations.
 *
 * Refuses to run against anything that looks like production. Local and CI
 * only — this is a destructive operation with no undo.
 */
import { execFileSync } from 'node:child_process';
import postgres from 'postgres';

async function main(): Promise<void> {
  const url = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.error('DIRECT_DATABASE_URL or DATABASE_URL must be set.');
    process.exit(1);
  }

  if (process.env.NODE_ENV === 'production' || process.env.ALLOW_DB_RESET === undefined) {
    const looksLocal = /localhost|127\.0\.0\.1|_test\b/.test(url);
    if (!looksLocal) {
      console.error(
        'Refusing to reset a non-local database.\n' +
          'Set ALLOW_DB_RESET=1 if you are certain this is what you want.',
      );
      process.exit(1);
    }
  }

  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  try {
    console.log('Dropping public schema...');
    await sql.unsafe('drop schema public cascade; create schema public;');
    await sql.unsafe('grant all on schema public to public;');
  } finally {
    await sql.end({ timeout: 5 });
  }

  console.log('Re-applying migrations...');
  execFileSync(process.execPath, ['--import', 'tsx', 'src/scripts/migrate.ts'], {
    stdio: 'inherit',
  });
}

main().catch((error: unknown) => {
  console.error('Reset failed:', error);
  process.exit(1);
});
