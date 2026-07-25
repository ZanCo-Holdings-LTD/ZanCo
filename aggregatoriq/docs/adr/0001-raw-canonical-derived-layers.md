# ADR 0001 — Raw, canonical and derived layers, and why raw rows are immutable

**Status:** accepted
**Date:** 2025-03

## Context

AggregatorIQ tells a restaurant that a delivery aggregator kept money it should
not have, and hands them a document to argue it with. The product's entire value
rests on the operator being able to believe that number, and on it surviving
contact with a partner manager who has every incentive to find a hole in it.

Three failure modes would each destroy that, and all three are about data
provenance rather than arithmetic:

1. A figure that cannot be traced to a source document. The claim is dismissed
   in one sentence and the operator stops trusting the rest.
2. A figure that changes between two runs over the same inputs. If March said
   4,312.50 in April and 4,480.00 in June, nobody can defend either number.
3. A parser bug found in month six that cannot be applied to months one to five,
   because the original data was overwritten by the buggy interpretation.

## Decision

Three layers, never blurred.

### Raw — `source_documents`, `source_rows`

The statement exactly as the aggregator sent it. Written once, never updated.

- A trigger rejects every `UPDATE` on `source_rows`, so even a migration or a
  well-meant script cannot rewrite history.
- The application database role holds no `UPDATE` or `DELETE` grant on the table
  at all, so the guarantee is enforced twice, in two mechanisms.
- Rows are stored positionally (`column_1`, `column_2`, …) rather than keyed by
  header, because a statement's preamble rows are narrower than its header and
  keying by header silently discards their cells. A raw layer that loses data is
  not a raw layer.
- `DELETE` is deliberately *not* blocked by the trigger. An organisation
  deleting its account must take its statements with it, and a cascade has to be
  able to reach these rows. `orders.source_row_id` is `on delete restrict`, so a
  raw row still cannot vanish while something derived from it survives.

### Canonical — `orders`, `payouts`, `payout_lines`

Our interpretation of the raw layer: an order is an order, a commission is a
negative number, a date is a calendar date in the branch's own timezone.

Every canonical row carries `source_row_id` as a `not null` foreign key. This is
not a convention that code is asked to respect — a canonical row that cannot
name the raw row it came from cannot be inserted.

The sign convention (deductions negative, sales positive) is a check constraint
rather than a coding standard, so a parser regression that flips a sign fails at
the database rather than becoming a plausible wrong number further downstream.

### Derived — `recon_runs`, `matches`, `variances`, `disputes`

Recomputable from raw plus configuration, and therefore safe to throw away and
rebuild. Every run records `engine_version` and `rule_set_version`, so a figure
from six months ago stays explainable when the rules change.

Variance ids are deterministic, derived from the variance's own content. A re-run
over unchanged inputs produces the same ids, which is what makes the idempotency
test meaningful and what lets a re-run upsert rather than duplicate. That
primary-key collision is also the mechanism that carries a human's judgement
forward: a variance somebody dismissed stays dismissed instead of reappearing
every time a statement arrives.

The one thing that does *not* survive a rebuild is deliberately narrow: the
findings themselves are regenerated, but their `status` and `dismissed_reason`
are read back and re-applied.

## Consequences

**Replay works.** `replay(source_document_id)` rebuilds the delimited text from
stored raw rows and re-parses it. A parser fix reaches every document already
ingested, and comparing before and after flags a replay that reads *less* than
the stored version — a regression, not an improvement, and worth a human's
attention before it overwrites anything.

**Storage grows.** Every statement is kept three times over: the original file in
object storage, the raw rows, and the canonical interpretation. For a restaurant
statement this is kilobytes, and it is the cheapest insurance in the product.

**A parser change is never destructive.** Re-parsing upserts canonical rows keyed
on the aggregator's own identifiers, so a corrected reading replaces the previous
one rather than creating a second copy of every order.

**Discipline is required at exactly one place.** The canonical mapper in
`apps/worker/src/services/ingest.ts` is where a parsed record's row index becomes
a real source-row id. It refuses to guess if the counts do not line up, because a
variance citing the wrong evidence is worse than no variance at all.

## Alternatives considered

**Parse on read.** Keep only the original files and interpret them per query.
Rejected: reconciliation over a quarter would re-parse hundreds of documents on
every page load, and a parser change would silently alter historical results with
no record that anything had changed.

**Canonical only.** Skip the raw layer and store the interpretation. Rejected on
the replay argument alone — the first parser bug would be unfixable for existing
customers, which is exactly the customers who matter.

**Mutable raw rows with an audit trail.** Allow correction, log the change.
Rejected: it makes "what did the aggregator actually send us" a question with a
history rather than an answer, and that question is the foundation of every
dispute the product exists to support.
