# Deployment

Two processes and a Postgres. The web tier on Vercel, the worker on Fly.io, the
database on Supabase or any managed Postgres 16.

## The split, and why it exists

The worker holds capabilities the web tier deliberately does not: writing the
canonical layer, reconciling across organisations, and receiving inbound email
from the internet. They are separate processes so that a compromise of the
public-facing tier does not carry those capabilities with it, and so a
forty-second reconciliation is not a request someone is watching.

## 1. Database

```bash
createdb aggregatoriq
DATABASE_URL=postgres://postgres@localhost:5432/aggregatoriq pnpm db:migrate
```

`db:migrate` applies the SQL migrations and seeds the reference data
(aggregators, cause codes) in one step. Reference data is part of the schema's
meaning rather than a separate task someone can forget: a database with no cause
codes cannot store a variance.

Migrations are checksummed. Editing one that has already run fails at the next
deploy rather than leaving two environments with the same version number and
different schemas.

### Roles

The migrations create three roles and grant them appropriately:

| Role | Used by | RLS |
|---|---|---|
| `aggregatoriq_app` | the web tier | applies in full |
| `aggregatoriq_worker` | the worker | bypasses — it must see every organisation |
| (owner) | migrations only | bypasses, as owners do |

Set passwords out of band and give the web tier a `DATABASE_URL` for
`aggregatoriq_app`. **Do not run the app as the owner.** An owner bypasses every
policy in `0002_rls.sql`, which would silently remove the tenant boundary while
every test continued to pass.

### Behind a pooler

Supabase's pooled port and PgBouncer in transaction mode cannot honour named
prepared statements. The web tier already passes `prepare: false`; if you put the
worker behind a pooler too, do the same there.

## 2. Worker (Fly.io)

```bash
fly launch --no-deploy
fly secrets set \
  DATABASE_URL=... \
  INTERNAL_API_TOKEN=$(openssl rand -hex 32) \
  INBOUND_EMAIL_SECRET=... \
  STORAGE_DRIVER=s3 STORAGE_S3_BUCKET=...
fly deploy
```

The worker validates its whole environment at boot and refuses to start on a
missing secret. That is intentional: a missing webhook secret discovered on the
first inbound email is a customer's statement lost, and discovered at boot it is
a deploy that did not happen.

`STORAGE_DRIVER=local` throws on Fly rather than falling back, because a local
disk there is ephemeral and losing original statements loses the evidence behind
every dispute already submitted.

## 3. Web (Vercel)

Set the environment variables from `.env.example`. The build itself needs no real
secrets — CI proves this by building with placeholders — but the running app
does, and `src/env.ts` validates them at boot.

`src/env.ts` starts with `import 'server-only'`, which makes importing it from a
client component a build error. That is what stops the database URL and the
internal token reaching a browser bundle by way of someone adding `'use client'`
to a file that already imported it.

## 4. Inbound email

Point a Resend inbound route at `POST /webhooks/inbound-email` on the worker and
set `INBOUND_EMAIL_SECRET` to the signing secret.

Addresses are generated per branch per aggregator with an unguessable local part
(`b7k2m9@in.aggregatoriq.com`). This is an unauthenticated endpoint that accepts
files, so both the signature check and the unguessable address are load-bearing —
a guessable address is an invitation to poison a customer's reconciliation.

Signatures are verified against the **raw** request body. Verifying a
re-serialised object verifies a different document from the one that was signed.

## 5. Verifying a deploy

```bash
curl https://worker.example/health          # {"status":"ok","extraction":"disabled"}
curl https://app.example/en/audit           # the free audit, no account needed
curl -s https://app.example/ar/audit | grep '<html'   # dir="rtl"
```

Then run one reconciliation end to end on a test organisation and check that a
variance's drill-through resolves to real source rows. If it does, the lineage
chain — raw row to canonical row to variance to screen — is intact, and that is
the thing worth checking on every deploy.

## Backups and retention

Original statements in object storage are the evidence behind every submitted
dispute and must outlive the derived data. The derived layer is recomputable and
does not need its own backup; the raw layer does.

Customers are the data controllers for their own statements. Account deletion
cascades from `organisations` all the way to `source_rows` — verified by a test —
so "delete my data" is a promise the schema can actually keep.
