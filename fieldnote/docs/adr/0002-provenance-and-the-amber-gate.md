# 0002. Provenance on every value, and the amber gate

- **Status:** accepted
- **Date:** 2026-07-25

## Context

Fieldnote produces documents that a chartered professional signs and sends to a
client, and on which that client may act. A damp report recommends works costing
thousands of pounds. An EICR determines whether an installation is safe.

A language model that invents a plausible finding in that context is not a
quality problem. It is a professional indemnity claim against our customer, and
the end of the company's credibility in a small and vocal profession.

The failure mode is specific and well understood: given a transcript that
mentions damp in three rooms, a model asked to fill a "cause of damp" field will
produce a fluent, professional-sounding, entirely invented diagnosis rather than
return nothing. It does this most readily exactly where we most need it not to —
on the fields a surveyor would otherwise have to think hardest about.

## Decision

Three mechanisms, layered, each of which must hold independently.

**1. Every generated value cites its source, mechanically checked.**

The model returns a character range into the transcript plus the exact quoted
substring. After the response, code resolves that span against the real
transcript. If the offsets are wrong but the quoted words genuinely appear, the
offsets are repaired. If the quoted words appear nowhere, the value is rejected.

One retry is issued, naming the fields that failed. Anything still ungrounded is
discarded and returned as an explicit null with confidence zero — not dropped,
so the reviewer still sees an empty row where a finding might belong.

**2. Photographs are context, never evidence.**

A value supported only by an image is rejected. A photograph of a crack does not
license a finding about a crack, because the surveyor did not say it.

**3. Low-confidence values cannot reach a client untouched.**

A value below 0.75 confidence renders amber, and export is blocked until a human
either edits it or explicitly confirms it. The gate is evaluated in three
places: the browser (so the reviewer can see what is blocking them), the API
route (before a job is queued), and the worker (before a browser is launched).
Only the last two are controls.

Editing and confirming are recorded separately. Collapsing them into one
"acknowledge" action would be simpler and would destroy the edit-distance
metric, which is how we know whether the product is improving.

Alongside these, `report_values.generated_value` is immutable, enforced by a
database trigger rather than by convention. What the model produced is kept
verbatim, forever, next to what the human signed.

## Alternatives considered

**Trust the model and review normally.** Rejected. The whole value proposition
is that review is fast, and fast review is skimming. Skimming past a fabricated
finding is exactly what would happen.

**Ask the model to self-report confidence and gate on that alone.** Rejected as
insufficient on its own. Self-reported confidence is useful — it is what drives
the amber threshold — but a model that fabricates a finding will frequently be
confident about it. The mechanical span check is what catches that case.

**Post-hoc verification with a second model call.** Rejected. It doubles cost and
latency on every field, and it replaces a deterministic check with a
probabilistic one. A string comparison against the transcript cannot be talked
out of its answer.

## Consequences

**Good.** A fabricated finding requires the model to quote words that exist in
the transcript and mean something else — a much narrower failure mode than free
generation, and one the eval harness can measure. The immutable
generated-versus-final pair is the record that answers a liability allegation.

**Bad.** Recall suffers. A value the inspector genuinely stated but phrased
across two sentences may fail grounding and be discarded. We accept this
deliberately: the eval harness hard-fails on any hallucination and targets
recall above 0.85, in that order of priority.

The amber gate adds friction to every report, and some of it will feel
unnecessary to an experienced surveyor confirming a value they know is right.
That friction is the product working.

**Watch for.** Reviewers learning to click "looks right" reflexively without
reading. If confirmation rates approach 100% with near-zero edits, the gate has
become theatre and the thresholds need revisiting.
