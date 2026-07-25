# AgentOS — work in progress, shelved

The operating system for corporate service providers and PRO agencies in the
GCC: every client entity, every document, every renewal, every PRO task and
every government fee, with automated client reminders and per-client
profitability.

## Status

**Shelved, deliberately.** The build brief ranks AgentOS third of three and
gates it on another product clearing £10k MRR. Priority moved to AggregatorIQ
(`../aggregatoriq`) before this tree was finished.

What is here is complete and tested:

- `packages/core` — the renewal engine (versioned, dated rules; escalation
  ladder expansion; idempotent generation), money in minor units, plain-date
  arithmetic, the WhatsApp/email template set with Meta's template rules
  enforced in CI, the extraction confidence policy, CSV import, pricing and
  per-client profitability. 142 unit tests, all passing.
- `packages/db` — the full schema as hand-written SQL migrations including
  row-level security policies, and column-level encryption for document numbers
  (AES-256-GCM, keys held in the worker, ciphertext bound to its org via AEAD
  associated data, HMAC blind index for lookup without decryption).

What is not here: `apps/web`, `apps/worker`, the repository layer, and the
database test suite that proves the RLS policies. Do not deploy this tree.

## M0 has not run

The brief is explicit that M0 is two weeks of conversations, not code, and that
the gate is 15 of 200 corporate service providers agreeing to talk and 8
describing a spreadsheet-plus-WhatsApp process with a missed-renewal story.
That has not happened. The seeded renewal rules in
`packages/core/src/renewals/seed-rules.ts` are marked as informed guesses to be
replaced by the interview findings, not as researched fact.

## Running what exists

```bash
pnpm install
pnpm test        # unit tests
pnpm typecheck
```
