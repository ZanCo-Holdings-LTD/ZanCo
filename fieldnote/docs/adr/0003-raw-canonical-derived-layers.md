# 0003. Raw, canonical and derived layers, never blurred

- **Status:** accepted
- **Date:** 2026-07-25

## Context

Fieldnote turns speech into a signed professional document through several lossy
steps: audio to transcript, transcript to structured values, values to PDF. Each
step can be wrong, and each will be improved after data has already flowed
through it.

The temptation is to store only what the current step needs — the structured
values, and maybe the transcript for debugging. That is how a product ends up
unable to answer "why does this report say that", unable to re-run an improved
prompt over historical data, and unable to defend a finding in a dispute.

## Decision

Three layers, with a hard rule against blurring them.

**Raw — written once, never updated.**

`captures.local_transcript` (the on-device draft) and
`captures.cloud_transcript` (the accurate pass) are both kept, permanently.
Neither is ever overwritten by a re-run. The audio itself stays in object
storage.

**Canonical — the interpreted layer.**

`report_values.generated_value` is what the model produced from the raw layer.
It is immutable, enforced by a database trigger. `source_span` on the same row
points back into the raw transcript.

**Derived — regenerable.**

`report_values.value` (after human editing), rendered PDFs in
`report_versions`, and the phrase corpus. All of these can be rebuilt from the
layers below, except the human edits, which are themselves inputs.

Two supporting rules:

- **No value without lineage.** A non-null generated value must carry a
  `source_span` that resolves to real transcript text. Enforced in the pipeline
  (`guardrails.ts`) and asserted in the eval harness, which fails CI if any value
  survives without one.
- **Everything is version-stamped.** Every generated value records the engine,
  model and prompt versions that produced it. `recon_runs` records the same for a
  whole pass. A historical row must stay explainable after the code that made it
  has been deployed over.

## Consequences

**Good.**

A prompt improvement can be replayed over historical captures, because the raw
transcripts are still there. A regression in field recall can be attributed to
the exact prompt version that introduced it. "Why does this report say the DPC is
bridged" resolves to a timestamp in an audio file.

The immutable generated-versus-final pair does double duty: it is the liability
record, and it is the training signal for the phrase corpus. Those are the same
data viewed from two directions.

**Bad.**

Storage grows and never shrinks. A forty-minute capture is a large file, and we
keep it. This is a real cost, and it is the right one — the alternative is being
unable to answer a question that matters.

Re-running a report does not produce a clean slate. `generated_value` stays as it
was on first write while confidence and provenance refresh, which is
occasionally confusing during development and is exactly right in production.

**Watch for.** Any pull request that updates a raw or canonical column in place.
That is the failure mode this ADR exists to prevent, and it will look reasonable
in isolation every single time.
