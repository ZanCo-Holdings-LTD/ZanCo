# Deployment

Three deployable units: a Postgres database (Supabase), a Next.js app (Vercel),
and a worker container (Fly.io). The mobile app ships through EAS.

## 0. Prerequisites

```bash
node -v          # 22 or later
pnpm -v          # 9.12 or later
```

Accounts: Supabase, Vercel, Fly.io, Deepgram, Anthropic, Resend, Stripe,
plus OpenAI or Voyage for embeddings.

## 1. Database

Create a Supabase project, then enable the extension the phrase corpus needs:

```sql
create extension if not exists vector;
```

Apply migrations against the **direct** connection (port 5432, not the pooler —
DDL and transaction-mode PgBouncer do not mix):

```bash
export DIRECT_DATABASE_URL='postgresql://postgres:...@db.<ref>.supabase.co:5432/postgres'
pnpm db:migrate
pnpm db:seed
```

`db:seed` installs the system templates. It is idempotent — run it on every
deploy.

### Storage buckets

Create four buckets, **all private**:

| Bucket     | Contents                       |
| ---------- | ------------------------------ |
| `captures` | Site audio                     |
| `media`    | Site photographs               |
| `branding` | Logos, letterheads, signatures |
| `reports`  | Rendered PDFs                  |

Nothing is ever served from a public URL. Access is by short-lived signed URL
only — audio, photographs and reports are all client material about real
properties, and a guessable path is a breach waiting for a crawler.

### Verifying RLS

The policies are the security boundary. Confirm they are live before any real
data lands:

```bash
pnpm test:rls
```

This runs against a real Postgres and asserts that cross-org reads, writes and
deletes all fail. It runs in CI on every pull request. **Do not deploy with this
failing or skipped.**

## 2. Worker (Fly.io)

```bash
fly launch --config apps/worker/fly.toml --no-deploy

fly secrets set \
  DATABASE_URL='postgresql://...pooler...:6543/postgres' \
  DIRECT_DATABASE_URL='postgresql://...:5432/postgres' \
  SUPABASE_SERVICE_ROLE_KEY='...' \
  SUPABASE_JWT_SECRET='...' \
  NEXT_PUBLIC_SUPABASE_URL='https://<ref>.supabase.co' \
  APP_URL='https://app.fieldnote.example' \
  WORKER_URL='https://fieldnote-worker.fly.dev' \
  WORKER_INTERNAL_TOKEN="$(openssl rand -hex 32)" \
  DEEPGRAM_API_KEY='...' \
  ANTHROPIC_API_KEY='...' \
  OPENAI_API_KEY='...' \
  RESEND_API_KEY='...' \
  DELIVERY_FROM_EMAIL='reports@fieldnote.example' \
  RESEND_WEBHOOK_SECRET='...'

fly deploy --config apps/worker/fly.toml --dockerfile apps/worker/Dockerfile .
```

Note `WORKER_INTERNAL_TOKEN` — the same value goes into the web app. It is the
only credential the web app uses to enqueue work, and it is compared in constant
time.

**`auto_stop_machines` is false, deliberately.** The runner polls continuously;
a machine suspended because HTTP traffic went quiet is a queue that never
drains, which means a survey that never becomes a report.

Check it came up:

```bash
curl https://fieldnote-worker.fly.dev/health | jq
```

`queue.dead` above zero means jobs have exhausted their retries and someone
needs to look. `queue.oldestQueuedAgeSeconds` climbing means the runner is not
keeping up.

## 3. Web app (Vercel)

```bash
vercel link
vercel env add NEXT_PUBLIC_SUPABASE_URL production
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY production
vercel env add SUPABASE_SERVICE_ROLE_KEY production
vercel env add SUPABASE_JWT_SECRET production
vercel env add DATABASE_URL production          # pooled, port 6543
vercel env add APP_URL production
vercel env add WORKER_URL production
vercel env add WORKER_INTERNAL_TOKEN production # same value as the worker
vercel env add STRIPE_SECRET_KEY production
vercel env add STRIPE_WEBHOOK_SECRET production

vercel deploy --prod
```

Use the **pooled** connection string here (port 6543). Serverless functions open
many short-lived connections and will exhaust a direct Postgres otherwise.

Only `NEXT_PUBLIC_*` variables reach the browser bundle. Everything else is read
through `src/lib/env.ts`, which imports `server-only` — importing it from a
client component is a build error rather than a leak.

## 4. Webhooks

| Provider | Endpoint                            | Notes                                                                                               |
| -------- | ----------------------------------- | --------------------------------------------------------------------------------------------------- |
| Resend   | `https://<worker>/webhooks/resend`  | Subscribe to `email.opened`. Signature-verified; without that anyone could mark a report delivered. |
| Stripe   | `https://<app>/api/webhooks/stripe` | Subscription lifecycle.                                                                             |

## 5. Mobile

```bash
cd apps/mobile
eas build --platform all --profile production
eas submit --platform all
```

Android matters as much as iOS: GCC field crews are predominantly Android.

## Environment reference

See `.env.example`. Every process validates its own slice with zod at boot and
exits non-zero on a bad value — a missing Deepgram key stops the worker starting
rather than surfacing as a failed job three hours into someone's first survey.

## Rollback

```bash
fly releases --config apps/worker/fly.toml
fly deploy --image <previous-image-ref>
```

Vercel: promote the previous deployment from the dashboard.

**Migrations do not roll back automatically.** Write them additively — add a
column, backfill, switch reads, drop later — so a rollback of application code
against a newer schema is always safe. The migration runner refuses to re-apply a
file whose checksum has changed, which catches the most common way two
environments silently diverge.
