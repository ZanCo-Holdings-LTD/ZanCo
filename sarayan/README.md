# Sarayan

Document and certification expiry management for Gulf businesses.

The system of record for every expiring document a company owns — trade
licences, visas, iqamas, labour cards, vehicle registrations, insurance
policies, HSE certifications — so nothing lapses because one person stopped
looking at a spreadsheet.

---

## What is here

```
sarayan/
├── apps/web/                  Next.js 16 app — marketing site, SEO engine and product
│   ├── src/app/[locale]/      Locale-scoped routes (en, ar) — `dir` is set from the segment
│   │   ├── (marketing)/       Landing, pricing, guides, calculators, legal, verification
│   │   ├── (auth)/            Sign in, sign up
│   │   └── app/               The product, behind a session
│   ├── src/app/api/           Extraction, files, export, evidence, cron, public v1 API
│   ├── src/content/taxonomy/  The curated document taxonomy — the product's real IP
│   ├── src/db/                Drizzle schema, migrations, seed
│   └── src/lib/               Auth, RBAC, plans, records, storage, notify, evidence
└── packages/
    ├── core-watch/            Observe a value → detect a state change → escalate
    ├── core-docs/             Upload → OCR → extraction → confidence → confirmation
    └── core-evidence/         Deterministic branded PDF with a verifiable hash
```

The three `packages/` are deliberately generic and dependency-free. They are the
portfolio's shared spine: the next product reuses them rather than reimplementing
watch-and-escalate, extract-and-confirm, and prove-with-a-hash.

## Running it

Requires Node 20.9+ and a Postgres database.

```bash
npm install
cp .env.example apps/web/.env.local     # set DATABASE_URL; everything else is optional
npm run db:migrate
npm run db:seed -- --demo               # taxonomy + a populated demo account
npm run dev                             # http://localhost:3000
```

The demo account is `demo@sarayan.app` / `sarayan-demo-2026`.

Or with Docker, which brings its own database:

```bash
docker compose up --build               # http://localhost:3000
```

### Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and server |
| `npm test` | 103 unit tests over the compliance logic |
| `npm run typecheck` | TypeScript, no emit |
| `npm run db:generate` | Generate a migration from schema changes |
| `npm run db:migrate` | Apply migrations |
| `npm run db:seed` | Sync the document taxonomy into the database |
| `npm run db:seed -- --demo` | Also create a demo organisation with 12 records |

## Configuration

Only `DATABASE_URL` is required. Every integration degrades to something that
still works, so the product is usable before a single third-party account
exists:

| Not configured | What happens instead |
| --- | --- |
| `ANTHROPIC_API_KEY` | Uploads are stored and fields are typed by hand |
| `RESEND_API_KEY` | Alerts appear in-app and the failure is recorded honestly |
| `WHATSAPP_*` | The ladder degrades to email |
| `S3_*` | Files are encrypted to the local filesystem |
| `STRIPE_*` | The manual invoice flow is the only billing path |

In production, `SESSION_SECRET`, `MASTER_ENCRYPTION_KEY` and `CRON_SECRET` are
required. See `.env.example`.

## The scheduled job

This is fundamentally a scheduled-job business. One endpoint drives it:

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://your-host/api/cron/alerts
```

It recomputes every record's status, then dispatches or escalates the alerts due
today. It is idempotent — running it twice in a day sends nothing the second
time — so any scheduler will do. `vercel.json` wires it to Vercel Cron at 06:00
UTC daily; `docker-compose.yml` includes a simple loop; a Kubernetes CronJob or
Inngest works equally well.

## How it fits together

**The taxonomy is the product.** `src/content/taxonomy/` holds 24 hand-written
document types across the UAE and Saudi Arabia. Each carries its typical
validity, renewal lead time, issuing authority, penalty schedule, and the
dependency edges to the documents it blocks or depends on. That one file set
drives the extraction schemas, the renewal defaults, the fine estimator, the
dependency graph, the sitemap and the SEO guide pages. It is never
user-generated.

**AI extracts; deterministic code decides.** A hosted vision model classifies a
document and extracts its fields with per-field confidence. Nothing it produces
becomes a record until a human confirms it beside the source image, and the
expiry date is always flagged for review regardless of the score. Dates, alerts,
status and compliance logic are ordinary code with tests.

**The alert ladder escalates.** 90, 60, 30, 14, 7 and 1 day before expiry, then
daily after it. An unacknowledged alert widens to managers, then to the entity
contact. Acknowledgement is the interaction the product is measured on.

**Evidence packs are verifiable.** Generating one produces a branded PDF and a
SHA-256 over a canonical projection of the register. Anyone can check that hash
at `/verify/<hash>` without an account. The hash covers the data, not the
layout, so packs stay verifiable across design changes.

**Right-to-left is architecture.** The locale is a route segment, `dir` is set
on `<html>` from it, and the component layer uses logical properties throughout
— no `ml-`, `pr-` or `left-` anywhere. The Arabic build is a genuine mirror, and
the Arabic strings are written rather than machine-translated.

## Security posture

- Per-tenant AES-256-GCM data keys; files are encrypted before they leave the process
- Session tokens stored only as SHA-256 hashes
- scrypt password hashing
- Server-side RBAC on every mutation, four roles
- Append-only audit log of every change, acknowledgement and export
- Strict CSP, HSTS, and no framing
- Metadata-only mode: track dates without storing a single document file
- A published DPA, subprocessor list and security page at `/en/security`

## Deliberate deviations from the brief

Two, both for deployability:

**Auth is self-contained rather than Clerk.** `src/lib/auth.ts` implements
sessions directly so the app runs with only a `DATABASE_URL` — no third-party
account needed to try it. The surface is intentionally Clerk-shaped
(`currentSession`, `requireSession`), so switching means rewriting that one file.

**Background jobs are an authenticated endpoint rather than Inngest or
Trigger.dev.** The scheduling logic is pure and lives in `@sarayan/core-watch`;
the endpoint is a thin caller. Pointing Inngest at it later is a configuration
change, not a rewrite.

## Not in scope

Government portal integrations, actual renewal submission, HR functions
(leave, payroll, appraisals) and document e-signature are all deliberately
absent. They will be requested. The brief is explicit: refuse every one until
£10k MRR.

## Caveat on the numbers

Penalty schedules, official fees and validity periods in the taxonomy are
estimates drawn from published schedules and are presented as such throughout
the product and the guides. They change. Verify with the issuing authority
before relying on them commercially. The legal documents in `src/content/legal.ts`
are drafted, not lawyer-reviewed.
