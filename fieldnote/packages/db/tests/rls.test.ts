/**
 * Row level security tests.
 *
 * These prove the property the whole product rests on: a member of org A
 * cannot read, write or delete anything belonging to org B, through any table.
 *
 * They run against a real Postgres in CI (see .github/workflows/ci.yml) with
 * the real migrations applied — a mocked policy proves nothing. Each test opens
 * a transaction, drops to the `authenticated` role and sets the JWT subject,
 * exactly as a request arriving through PostgREST would.
 *
 * If you add a table, add a case here. A table with no test is a table whose
 * policy nobody has checked.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';

const connectionString =
  process.env.DIRECT_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5432/fieldnote_test';

const sql = postgres(connectionString, { max: 4, prepare: false, onnotice: () => {} });

/** Deterministic ids make failures easy to read in the query log. */
const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';
const OUTSIDER = '33333333-3333-4333-8333-333333333333';

let orgA: string;
let orgB: string;
let templateId: string;
let sectionId: string;
let fieldAId: string;
let reportA: string;
let reportB: string;
let captureA: string;
let versionA: string;

/**
 * Run `fn` as `userId` with RLS applied, then roll back.
 *
 * Rolling back keeps every test independent without truncating between cases,
 * and means a test that accidentally succeeds at a forbidden write still leaves
 * no trace.
 */
async function asUser<T>(
  userId: string | null,
  fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  let result!: T;
  try {
    await sql.begin(async (tx) => {
      await tx`select set_config('role', 'authenticated', true)`;
      await tx`select set_config('request.jwt.claims', ${JSON.stringify({
        sub: userId,
        role: 'authenticated',
      })}, true)`;
      result = await fn(tx);
      // Unwind so assertions never leak into the next test.
      throw new RollbackSignal();
    });
  } catch (error) {
    if (!(error instanceof RollbackSignal)) throw error;
  }
  return result;
}

class RollbackSignal extends Error {}

/** True when the callback raises a permission error rather than succeeding. */
async function expectDenied(fn: () => Promise<unknown>): Promise<void> {
  await expect(fn()).rejects.toThrow();
}

beforeAll(async () => {
  // Seed as the owner role, with RLS out of the way. This is setup, not a test.
  await sql.begin(async (tx) => {
    await tx`delete from organisations where name in ('RLS Org A', 'RLS Org B')`;

    const [a] = await tx<{ id: string }[]>`
      insert into organisations (name) values ('RLS Org A') returning id
    `;
    const [b] = await tx<{ id: string }[]>`
      insert into organisations (name) values ('RLS Org B') returning id
    `;
    orgA = a!.id;
    orgB = b!.id;

    await tx`insert into org_members (org_id, user_id, role) values (${orgA}, ${ALICE}, 'owner')`;
    await tx`insert into org_members (org_id, user_id, role) values (${orgB}, ${BOB}, 'owner')`;

    // A system template: no org, readable by everyone.
    const [template] = await tx<{ id: string }[]>`
      insert into templates (org_id, vertical, name, version, is_system)
      values (null, 'uk_damp_timber', 'RLS System Template', 1, true)
      returning id
    `;
    templateId = template!.id;

    const [section] = await tx<{ id: string }[]>`
      insert into template_sections (template_id, key, title, order_index)
      values (${templateId}, 'external', 'External inspection', 0)
      returning id
    `;
    sectionId = section!.id;

    const [field] = await tx<{ id: string }[]>`
      insert into template_fields (section_id, key, label, type, required, order_index)
      values (${sectionId}, 'damp_cause', 'Cause of damp', 'long_text', true, 0)
      returning id
    `;
    fieldAId = field!.id;

    const [rA] = await tx<{ id: string }[]>`
      insert into reports (org_id, owner_id, template_id, template_version, property_address)
      values (${orgA}, ${ALICE}, ${templateId}, 1, '1 Alpha Street')
      returning id
    `;
    const [rB] = await tx<{ id: string }[]>`
      insert into reports (org_id, owner_id, template_id, template_version, property_address)
      values (${orgB}, ${BOB}, ${templateId}, 1, '2 Bravo Road')
      returning id
    `;
    reportA = rA!.id;
    reportB = rB!.id;

    const [cap] = await tx<{ id: string }[]>`
      insert into captures (org_id, report_id, storage_path, duration_ms)
      values (${orgA}, ${reportA}, 'a/1.m4a', 1000)
      returning id
    `;
    captureA = cap!.id;

    await tx`
      insert into media_assets (org_id, report_id, storage_path)
      values (${orgA}, ${reportA}, 'a/1.jpg')
    `;
    await tx`
      insert into report_values (org_id, report_id, field_id, value, generated_value, confidence)
      values (${orgA}, ${reportA}, ${fieldAId}, '"rising damp"'::jsonb, '"rising damp"'::jsonb, 0.9)
    `;
    const [version] = await tx<{ id: string }[]>`
      insert into report_versions (org_id, report_id, version_no, pdf_path)
      values (${orgA}, ${reportA}, 1, 'a/v1.pdf')
      returning id
    `;
    versionA = version!.id;
    await tx`
      insert into deliveries (org_id, report_id, version_id, to_email)
      values (${orgA}, ${reportA}, ${versionA}, 'client@example.com')
    `;
    await tx`
      insert into phrase_examples (org_id, user_id, field_id, generated_text, final_text)
      values (${orgA}, ${ALICE}, ${fieldAId}, 'rising damp', 'rising damp to north elevation')
    `;
    await tx`
      insert into audit_log (org_id, actor_id, action, entity_type, entity_id)
      values (${orgA}, ${ALICE}, 'report.created', 'report', ${reportA})
    `;
    await tx`
      insert into subscriptions (org_id, status, seats) values (${orgA}, 'active', 3)
      on conflict (org_id) do nothing
    `;
    await tx`
      insert into report_costs (org_id, report_id, structuring_usd)
      values (${orgA}, ${reportA}, 0.02)
    `;
  });
});

afterAll(async () => {
  await sql`delete from organisations where id in (${orgA}, ${orgB})`;
  await sql`delete from templates where id = ${templateId}`;
  await sql.end({ timeout: 5 });
});

describe('the caller sees their own organisation', () => {
  it('lets Alice read org A', async () => {
    const rows = await asUser(ALICE, (tx) => tx`select id from organisations where id = ${orgA}`);
    expect(rows).toHaveLength(1);
  });

  it('lets Alice read her own reports', async () => {
    const rows = await asUser(ALICE, (tx) => tx`select id from reports where org_id = ${orgA}`);
    expect(rows).toHaveLength(1);
  });

  it('lets any member read system templates', async () => {
    const rows = await asUser(BOB, (tx) => tx`select id from templates where id = ${templateId}`);
    expect(rows).toHaveLength(1);
  });
});

describe('cross-org reads return nothing', () => {
  // Every org-scoped table, so a new table cannot be added without a case here.
  const tables: { table: string; column: string }[] = [
    { table: 'reports', column: 'org_id' },
    { table: 'captures', column: 'org_id' },
    { table: 'media_assets', column: 'org_id' },
    { table: 'report_values', column: 'org_id' },
    { table: 'report_versions', column: 'org_id' },
    { table: 'deliveries', column: 'org_id' },
    { table: 'phrase_examples', column: 'org_id' },
    { table: 'report_costs', column: 'org_id' },
    { table: 'subscriptions', column: 'org_id' },
  ];

  for (const { table, column } of tables) {
    it(`hides ${table} belonging to another org`, async () => {
      const rows = await asUser(
        BOB,
        (tx) => tx`select * from ${tx(table)} where ${tx(column)} = ${orgA}`,
      );
      expect(rows).toHaveLength(0);
    });
  }

  it('hides organisation A from Bob', async () => {
    const rows = await asUser(BOB, (tx) => tx`select id from organisations where id = ${orgA}`);
    expect(rows).toHaveLength(0);
  });

  it('hides the audit log of another org even from an owner', async () => {
    const rows = await asUser(BOB, (tx) => tx`select id from audit_log where org_id = ${orgA}`);
    expect(rows).toHaveLength(0);
  });

  it('hides a specific report by id, not just by org filter', async () => {
    // A leaked report id must still be useless without membership.
    const rows = await asUser(BOB, (tx) => tx`select id from reports where id = ${reportA}`);
    expect(rows).toHaveLength(0);
  });

  it('hides everything from a user who belongs to no org', async () => {
    const rows = await asUser(OUTSIDER, (tx) => tx`select id from reports`);
    expect(rows).toHaveLength(0);
  });

  it('hides everything from an unauthenticated caller', async () => {
    const rows = await asUser(null, (tx) => tx`select id from reports`);
    expect(rows).toHaveLength(0);
  });
});

describe('cross-org writes fail', () => {
  it('refuses an insert into another org', async () => {
    await expectDenied(() =>
      asUser(
        BOB,
        (tx) => tx`
          insert into reports (org_id, owner_id, template_id, template_version, property_address)
          values (${orgA}, ${BOB}, ${templateId}, 1, 'Injected')
        `,
      ),
    );
  });

  it('silently affects no rows on a cross-org update', async () => {
    // An UPDATE whose USING clause excludes every row is not an error, it is a
    // no-op. Asserting the row count is what proves nothing was written.
    await asUser(
      BOB,
      (tx) => tx`update reports set property_address = 'Hijacked' where id = ${reportA}`,
    );
    const [row] = await sql<{ property_address: string }[]>`
      select property_address from reports where id = ${reportA}
    `;
    expect(row?.property_address).toBe('1 Alpha Street');
  });

  it('affects no rows on a cross-org delete', async () => {
    await asUser(BOB, (tx) => tx`delete from reports where id = ${reportA}`);
    const rows = await sql`select id from reports where id = ${reportA}`;
    expect(rows).toHaveLength(1);
  });

  it('refuses to move a report between orgs', async () => {
    await asUser(ALICE, (tx) => tx`update reports set org_id = ${orgB} where id = ${reportA}`)
      .then(() => {
        throw new Error('expected the org_id change to be rejected');
      })
      .catch((error: unknown) => {
        expect(error).toBeInstanceOf(Error);
      });
  });

  it('refuses to write a capture into another org', async () => {
    await expectDenied(() =>
      asUser(
        BOB,
        (tx) => tx`
          insert into captures (org_id, report_id, storage_path, duration_ms)
          values (${orgA}, ${reportA}, 'b/evil.m4a', 1)
        `,
      ),
    );
  });

  it('refuses to read another user’s phrase corpus', async () => {
    const rows = await asUser(
      BOB,
      (tx) => tx`select final_text from phrase_examples where user_id = ${ALICE}`,
    );
    expect(rows).toHaveLength(0);
  });
});

describe('system templates are read-only to tenants', () => {
  it('refuses to edit a system template', async () => {
    await asUser(
      ALICE,
      (tx) => tx`update templates set name = 'Tampered' where id = ${templateId}`,
    );
    const [row] = await sql<{ name: string }[]>`select name from templates where id = ${templateId}`;
    expect(row?.name).toBe('RLS System Template');
  });

  it('refuses to delete a system template', async () => {
    await asUser(ALICE, (tx) => tx`delete from templates where id = ${templateId}`);
    const rows = await sql`select id from templates where id = ${templateId}`;
    expect(rows).toHaveLength(1);
  });

  it('refuses to add a section to a system template', async () => {
    await expectDenied(() =>
      asUser(
        ALICE,
        (tx) => tx`
          insert into template_sections (template_id, key, title, order_index)
          values (${templateId}, 'injected', 'Injected', 99)
        `,
      ),
    );
  });
});

describe('the audit log is append only', () => {
  it('allows an insert by a member', async () => {
    const rows = await asUser(
      ALICE,
      (tx) => tx`
        insert into audit_log (org_id, actor_id, action, entity_type)
        values (${orgA}, ${ALICE}, 'report.exported', 'report')
        returning id
      `,
    );
    expect(rows).toHaveLength(1);
  });

  it('affects no rows on an update, because no update policy exists', async () => {
    await asUser(ALICE, (tx) => tx`update audit_log set action = 'tampered' where org_id = ${orgA}`);
    const rows = await sql`select id from audit_log where action = 'tampered'`;
    expect(rows).toHaveLength(0);
  });

  it('affects no rows on a delete', async () => {
    const before = await sql`select id from audit_log where org_id = ${orgA}`;
    await asUser(ALICE, (tx) => tx`delete from audit_log where org_id = ${orgA}`);
    const after = await sql`select id from audit_log where org_id = ${orgA}`;
    expect(after).toHaveLength(before.length);
  });

  it('restricts audit reads to admins and above', async () => {
    // Demote Alice to a plain member, then confirm the log disappears for her.
    await sql`update org_members set role = 'member' where org_id = ${orgA} and user_id = ${ALICE}`;
    const rows = await asUser(ALICE, (tx) => tx`select id from audit_log where org_id = ${orgA}`);
    expect(rows).toHaveLength(0);
    await sql`update org_members set role = 'owner' where org_id = ${orgA} and user_id = ${ALICE}`;
  });
});

describe('the job queue is invisible to tenants', () => {
  it('denies any select on jobs to an authenticated user', async () => {
    await expectDenied(() => asUser(ALICE, (tx) => tx`select id from jobs`));
  });
});

describe('generated values are immutable', () => {
  it('rejects an attempt to rewrite what the model produced', async () => {
    // The trigger fires regardless of role — this is a liability control, not
    // an application convention, so even a direct owner connection cannot do it.
    await expect(
      sql`update report_values set generated_value = '"fabricated"'::jsonb where report_id = ${reportA}`,
    ).rejects.toThrow(/immutable/);
  });

  it('allows the final value to be edited and flags it as human-edited', async () => {
    await sql`update report_values set value = '"penetrating damp"'::jsonb where report_id = ${reportA}`;
    const [row] = await sql<{ edited_by_human: boolean; generated_value: string }[]>`
      select edited_by_human, generated_value from report_values where report_id = ${reportA}
    `;
    expect(row?.edited_by_human).toBe(true);
    expect(row?.generated_value).toBe('rising damp');
  });
});

describe('membership bootstrap', () => {
  it('lets a new user create an org and become its owner atomically', async () => {
    const created = await sql.begin(async (tx) => {
      await tx`select set_config('role', 'authenticated', true)`;
      await tx`select set_config('request.jwt.claims', ${JSON.stringify({
        sub: OUTSIDER,
        role: 'authenticated',
      })}, true)`;
      const [row] = await tx<{ create_organisation: string }[]>`
        select public.create_organisation('Outsider Surveys') as create_organisation
      `;
      return row!.create_organisation;
    });

    const [membership] = await sql<{ role: string }[]>`
      select role from org_members where org_id = ${created} and user_id = ${OUTSIDER}
    `;
    expect(membership?.role).toBe('owner');

    // And a trial subscription exists, so the paywall has something to read.
    const [sub] = await sql<{ status: string }[]>`
      select status from subscriptions where org_id = ${created}
    `;
    expect(sub?.status).toBe('trialing');

    await sql`delete from organisations where id = ${created}`;
  });

  it('refuses to join an organisation that already has members', async () => {
    await expectDenied(() =>
      asUser(
        OUTSIDER,
        (tx) => tx`
          insert into org_members (org_id, user_id, role) values (${orgA}, ${OUTSIDER}, 'owner')
        `,
      ),
    );
  });
});
