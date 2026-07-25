# Fieldnote

Voice-first site inspection reporting. Walk the property talking, with
photographs attached as you go; review a near-finished report on a laptop that
evening in fifteen minutes instead of three hours.

**The phone captures. The web reviews.** That split is deliberate and load
bearing — see [ADR 0001](docs/adr/0001-web-review-mobile-capture.md).

---

> ## Read this first
>
> **Milestone M0 is a two-week field test with about £300 and no software.** It
> is the go/no-go decision for the entire product: if speech recognition does not
> survive a loft with a dehumidifier running, a plant room, a windy roof and two
> strong non-native accents, then nothing in this repository matters.
>
> **That gate has not been run.** See [`docs/m0-asr-findings.md`](docs/m0-asr-findings.md).
> The code here was built ahead of it on explicit instruction. Run the test
> before onboarding a design partner, and record the numbers in that file.

---

## What is here

```
apps/
  web/        Next.js 15, App Router. Dashboard, review workspace, export, delivery.
  worker/     Fastify on Fly.io. The only process holding ASR and LLM keys.
  mobile/     Expo. Six screens. Offline-first capture.
packages/
  shared/     Domain types and rules: amber gating, pricing, cost instrumentation.
  db/         Drizzle schema, RLS policies, repositories, migrations, seeds.
  ai/         Transcription, structuring, grounding guardrail, eval harness.
  pdf/        Handlebars to Chromium. Branded, letterheaded output.
evals/        Design-partner fixtures. Hallucination rate must be zero.
docs/         ADRs, M0 record, deployment, runbook.
```

## Running it locally

```bash
pnpm install
cp .env.example .env          # fill in the values you need

# Postgres with pgvector
docker run -d --name fieldnote-db -p 5432:5432 \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=fieldnote \
  pgvector/pgvector:pg16

pnpm db:migrate               # schema, RLS policies, functions
pnpm db:seed                  # vertical-one templates

pnpm build                    # workspace packages first
pnpm dev                      # web on :3000, worker on :8080
pnpm dev:mobile               # Expo, separately
```

Verify the worker came up:

```bash
curl -s localhost:8080/health | jq
```

## Checks

```bash
pnpm check        # typecheck, lint, unit tests
pnpm test:rls     # cross-org isolation, against a real Postgres
pnpm eval         # structuring accuracy against design-partner fixtures
```

`pnpm test:rls` is not optional. It proves that a member of one organisation
cannot read, write or delete another's data through any table, and it runs in CI
on every pull request.

## The pipeline

1. **Capture.** The phone writes audio and photographs straight to disk in a
   `pending` state. Recording never waits on the network.
2. **Transcription.** Deepgram Nova, per capture, with a per-vertical keyword
   boost list from the template. Both the on-device draft and the cloud pass are
   kept, permanently.
3. **Structuring.** One LLM call per report section, never one for the whole
   report. Every value must cite a character range that resolves against the real
   transcript.
4. **Grounding.** A value whose citation does not resolve is rejected and
   re-requested once; anything still ungrounded becomes an explicit null rather
   than a kept guess.
5. **Review.** Amber fields must be edited or explicitly confirmed before export
   unlocks. Enforced server-side, twice.
6. **Delivery.** Branded PDF, attached to an email, with a delivery record.
7. **Learning.** Each human edit writes a (generated, final) pair to that user's
   phrase corpus, which is retrieved by similarity into future prompts.

## Things that are non-negotiable

- A report is **never** auto-sent.
- Export is **never** possible while an amber field is untouched.
- A finding is **never** generated from a photograph alone.
- `report_values.generated_value` is immutable, enforced by a database trigger
  rather than by convention. What the model produced is kept verbatim next to
  what the human signed — that pairing is the answer to a liability allegation.
- The eval harness **hard-fails on any hallucination**. Not a threshold to tune;
  zero.

## Metrics that matter

| Metric | Target |
| --- | --- |
| Trial users delivering a real client report within 48 hours | 45% |
| Reports per user per week | 5 (below 2 means testing, not using) |
| Mean human edit distance per field | Falling |
| Trial to paid | 25% |
| Net revenue retention | Above 100% |
| Inference cost per report, as a share of ARPU | Below 12%, alerted |

Mean edit distance is the product's actual health. It should fall as the phrase
corpus grows; a prompt change that raises it is a regression even if recall
improved.

## Pricing

£69 per seat monthly solo, £59 per seat for teams of three or more, £690 annual.
Founding rate £39 for the first fifty seats, locked.

£100k MRR is roughly 350 firm accounts at £290, not 1,450 individuals. Sell to
firms.

## Documentation

- [ADR 0001 — the phone captures, the web reviews](docs/adr/0001-web-review-mobile-capture.md)
- [ADR 0002 — provenance and the amber gate](docs/adr/0002-provenance-and-the-amber-gate.md)
- [ADR 0003 — raw, canonical and derived layers](docs/adr/0003-raw-canonical-derived-layers.md)
- [M0 ASR field test](docs/m0-asr-findings.md)
- [Deployment](docs/deployment.md)
- [Runbook](docs/runbook.md)
