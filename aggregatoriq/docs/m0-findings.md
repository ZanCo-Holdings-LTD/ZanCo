# M0 findings — manual reconciliation

> **This file is empty of findings because M0 has not been run.**
>
> M0 contains no software. It is a manual reconciliation exercise in SQL and a
> spreadsheet, and it is the go or no-go decision for the entire product. The
> code in this repository was written before it, against the brief's own
> specification, which means **the gate has not been passed and nothing here is
> validated against a real statement.**
>
> Do not treat the parser column names, the assumed commission rates in the free
> audit, or the seeded cause-code set as researched fact. They are a starting
> position derived from published partner documentation.

## The gate

Recruit ten restaurants across at least two aggregators each, in Saudi **or**
the UAE — not both. Collect three months of statements per aggregator plus their
order exports. Reconcile by hand: load into Postgres, match orders to payout
lines, quantify every discrepancy, classify the cause. Produce one written report
per restaurant.

**Proceed if:** the median identified recoverable amount is above roughly £500
per branch per month, **and** at least four of the ten ask what happens next
without being prompted.

**If the median lands between £200 and £500:** the product is real and the price
is wrong. Reprice to a share of recovery and re-test. The recovery-share tier is
already implemented (`apps/worker/src/payments.ts`, capped at £499) so this can
be offered without new engineering.

**Below £200:** stop. No amount of engineering changes the arithmetic of a £99
subscription against a £150 problem.

## Why this file matters beyond the gate

The discrepancies found by hand become two things:

1. **The cause code taxonomy.** The twelve codes in
   `packages/core/src/cause-codes.ts` are the brief's starting set. Every real
   dispute that reveals a shape the taxonomy has no code for is an addition, and
   the taxonomy is the product's actual intellectual property — a competitor can
   read the code names off a screenshot and still not have the detection rule,
   the evidence it cites, or the dispute wording behind it.

2. **The first eval fixture set.** Every statement reconciled by hand is a case
   the engine must reproduce within materiality. M4 is not done until the engine
   matches the manual numbers on all ten restaurants.

**Do not throw the manual work away.** The spreadsheets are the only ground truth
this product will ever have that was not produced by its own code.

## Recording template

One section per restaurant. Copy this per branch and fill it in as you go rather
than at the end, because the reasoning behind a classification is much harder to
reconstruct a week later.

### Restaurant N — <name>, <city>

| | |
|---|---|
| Aggregators | |
| Months reconciled | |
| Total gross revenue in period | |
| Total identified recoverable | |
| Per branch per month | |
| Asked what happens next, unprompted? | |

**Discrepancies found**

| Cause | Amount | How it was spotted | Would the engine catch it? | Notes |
|---|---|---|---|---|
| | | | | |

**New cause codes this restaurant revealed**

| Proposed code | What it is | Recoverable? | Why the existing codes do not cover it |
|---|---|---|---|

**Statement format notes**

Anything about how this aggregator's export is laid out that the parsers need to
know: column names, date formats, whether deductions are signed, how cancelled
orders appear, whether promotions are itemised or netted into a single figure.

**What the operator said**

Verbatim where possible, especially about whether they had suspected the problem
and what they had tried. This is what the free-audit and dispute-pack copy should
be written from.

## Running tally

| # | Restaurant | Aggregators | Months | Recoverable / branch / month | Asked what's next |
|---|---|---|---|---|---|
| 1 | | | | | |
| 2 | | | | | |
| 3 | | | | | |
| 4 | | | | | |
| 5 | | | | | |
| 6 | | | | | |
| 7 | | | | | |
| 8 | | | | | |
| 9 | | | | | |
| 10 | | | | | |

**Median:** _not yet computed_
**Asked what's next:** _0 of 10_
**Gate:** **not passed**
