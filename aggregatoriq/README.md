# AggregatorIQ

Reconciliation for Gulf restaurants selling through delivery aggregators.

A restaurant sells through Talabat, HungerStation, Jahez, Deliveroo, Careem and
Noon. Each has its own commission structure, promotional cost-sharing rules,
cancellation policy, chargeback treatment and payout cycle. Nobody can reconcile
order-level revenue against actual payouts across six platforms, so errors go
undetected and undisputed.

AggregatorIQ ingests each aggregator's statements, matches orders to payouts,
classifies every variance by cause, and produces a dispute pack the operator can
actually submit.

**The product is a reconciliation engine, not a dashboard.** The dashboard is
what people look at. The engine is what they pay for.

---

## Status: M0 has not been run

Read `docs/m0-findings.md` before reading anything else.

M0 is a manual reconciliation exercise across ten restaurants, and it is the go
or no-go decision for the entire product. It has not happened. This code was
written against the brief's specification rather than against real statements,
which means:

- The parser column names in `packages/parsers/src/aggregators/` are
  reconstructed from published partner documentation, not from real exports.
  Expect them to be wrong. The drift detector exists precisely so that being
  wrong produces an alert and a review queue rather than a silent zero.
- The commission rates the free audit assumes are each aggregator's standard
  published terms.
- The twelve cause codes are the brief's starting set, not findings.

Everything else — the engine, the tenant boundary, the lineage guarantees — is
built, tested, and does not depend on M0 having run.

---

## What is here

```
packages/core       money, calendar dates, the cause code taxonomy
packages/engine     the reconciliation engine: matching, rules, variances
packages/parsers    the parsing ladder: fingerprinting, drift, replay, extraction
packages/db         schema, RLS policies, migrations, repositories
apps/web            Next.js 15, App Router, en/ar with RTL
apps/worker         Fastify: ingestion, reconciliation, dispute packs, webhooks
```

### The properties worth knowing about

**Deterministic core, model only at the boundary.** A model may locate which cell
of an unrecognised layout means what. It may never compute, total or judge a
number. `assertGrounded` checks that every extracted value appears verbatim in
the row it cites — which catches the dangerous case, a real citation with an
altered number: plausible, well-cited, and wrong.

**No variance without lineage.** Every finding carries the source rows it was
computed from. Enforced in `createVariance`, asserted in the engine tests, and
constrained in the database — three times, because it is the invariant the
product dies without.

**Idempotent.** Re-running a period over unchanged inputs produces byte-identical
results, including variance ids. A number an operator took to their aggregator
last week is still the same number today, and `engine_version` on every run says
what produced it.

**Materiality.** Variance noise destroys trust faster than missed variances. The
threshold is per-organisation and defaults to one unit of currency. Missing
payouts are deliberately exempt: fifty unpaid 1.50 orders is a pattern, not
noise.

**Honest totals.** The headline recovery figure counts only positive deltas on
cause codes marked recoverable. Late payouts, coverage gaps and unexplained
adjustments appear in the list and never in the total — an inflated number
collapses the first time someone checks it.

---

## Running it locally

Requires Node 22, pnpm 10 and Postgres 16.

```bash
pnpm install
cp .env.example .env

createdb aggregatoriq
DATABASE_URL=postgres://postgres@localhost:5432/aggregatoriq pnpm db:migrate

pnpm dev          # web on :3000, worker on :8080
```

The free audit at `http://localhost:3000/en/audit` needs no account and no
database — drop in a statement and it runs the real engine in memory.

### Tests

```bash
pnpm test         # 169 unit tests, no database needed
pnpm test:db      # 41 RLS and constraint tests, needs TEST_DATABASE_URL
pnpm test:all
pnpm typecheck
pnpm lint
```

The database tests drop and recreate the public schema. Point
`TEST_DATABASE_URL` at something disposable.

They run as `aggregatoriq_app`, a role that owns nothing, because a table owner
bypasses row-level security and a test that passed as the owner would pass
equally against a database with every policy dropped. The first test in
`rls.pg.test.ts` asserts that property so the rest cannot be quietly invalidated.

### Useful commands

```bash
pnpm db:migrate                      # apply migrations and seed reference data
pnpm db:reset --yes-destroy-all-data # drop everything and rebuild
pnpm --filter @aggregatoriq/web build
pnpm --filter @aggregatoriq/worker dev
```

---

## Reading order for someone new

1. `docs/m0-findings.md` — why the gate matters and where it stands
2. `docs/adr/0001-raw-canonical-derived-layers.md` — the data model and why raw
   rows are immutable
3. `packages/core/src/cause-codes.ts` — the taxonomy, which is the actual IP
4. `packages/engine/src/rules/` — one file per rule, each a pure function
5. `packages/db/migrations/0002_rls.sql` — the tenant boundary
6. `packages/parsers/src/registry.ts` — the parsing ladder and why there is no
   "closest parser" fallback

---

## Things this deliberately does not do

**Never scrape an aggregator portal.** It breaks their terms, breaks on every UI
change, and makes the company uninvestable and unpartnerable. AggregatorIQ only
processes data the customer already holds and forwards, and the customer stays
the data controller.

**No order aggregation, menu sync, POS replacement, inventory or delivery
management.** If a feature does not move a restaurant from "I suspect I'm being
shortchanged" to "here is the evidence and here is my claim", it is not in v1.

See `docs/deployment.md` for putting it in production.
