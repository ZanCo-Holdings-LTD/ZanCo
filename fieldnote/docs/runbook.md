# Runbook

What to do when something is wrong. Ordered by how likely you are to need it.

## A survey never became a report

The most common real incident, and the one a customer notices first.

```bash
curl -s https://<worker>/health | jq '.queue'
```

- **`dead` above zero.** Jobs exhausted their retries. Find out why:

  ```sql
  select kind, last_error, attempts, created_at
    from jobs
   where state = 'dead'
   order by created_at desc
   limit 20;
  ```

  Fix the cause, then requeue: `update jobs set state='queued', attempts=0, run_after=now() where id = '...';`

- **`oldestQueuedAgeSeconds` climbing, `running` at concurrency.** The runner is
  saturated. Scale out (`fly scale count 2`) — claiming is `FOR UPDATE SKIP
  LOCKED`, so extra machines are safe and need no coordination.

- **`queued` above zero, `running` at zero.** The runner is not claiming. Check
  the machine is actually up (`fly status`) and that `auto_stop_machines` is
  still false — a suspended worker is a queue that never drains.

## The model refused a section

`stop_reason: "refusal"` surfaces as a non-retryable job failure. Rare, and it
usually means the transcript tripped a safety classifier — asbestos, structural
collapse and fire damage are legitimate survey topics that read alarmingly out
of context.

The transcript is intact and nothing is lost. Re-run the structuring job. If it
refuses repeatedly, the section can be filled by hand in the review workspace —
the report is not blocked.

## A customer says a finding is wrong

This is the case the whole architecture exists to answer. Do not guess.

```sql
select rv.value,                -- what the surveyor signed
       rv.generated_value,      -- what the model produced (immutable)
       rv.confidence,
       rv.source_span,          -- character range and quote
       rv.model_version, rv.prompt_version, rv.engine_version,
       rv.edited_by_human, rv.reviewed_at
  from report_values rv
 where rv.report_id = '<report>' and rv.field_id = '<field>';
```

`source_span.quote` is the verbatim transcript text the value came from, and
`startMs`/`endMs` locate it in the audio. Play that moment.

Three possible outcomes, and they are genuinely different:

1. **The surveyor said it and the model recorded it correctly.** The finding is
   theirs. The record shows it.
2. **The surveyor said it, the model misinterpreted it, and the surveyor
   confirmed without reading.** `edited_by_human = false`, `reviewed_at` set.
   Our amber gate worked and was clicked through. Worth investigating whether the
   threshold is too low or the UI too easy to skim.
3. **The value has no source span, or the quote does not appear in the
   transcript.** That should be impossible — the guardrail rejects it and the
   eval harness fails CI on it. If you find one, stop and treat it as a Sev 1:
   the guardrail has a hole.

## Inference cost is climbing

The worker logs `inference cost exceeds target share of ARPU` when a report
crosses the threshold.

```sql
select r.id, r.property_address,
       (rc.transcription_micros_usd + rc.structuring_micros_usd) / 1000000.0 as usd,
       rc.audio_ms / 60000 as audio_minutes,
       rc.input_tokens, rc.cached_input_tokens
  from report_costs rc
  join reports r on r.id = rc.report_id
 where rc.org_id = '<org>'
 order by (rc.transcription_micros_usd + rc.structuring_micros_usd) desc
 limit 20;
```

`cached_input_tokens` far below `input_tokens` means prompt caching is not
working — usually because something volatile crept into the system prompt or the
section spec. That is the first thing to check, because it is both the cheapest
fix and the most likely cause.

If the reports are genuinely enormous, the lever is `ANTHROPIC_EFFORT`, then the
model tier. Both trade quality for cost, so check the eval harness after.

## Transcription quality has dropped

```sql
select c.id, c.duration_ms,
       (c.cloud_transcript->>'meanConfidence')::numeric as confidence
  from captures c
 where c.transcribed_at > now() - interval '7 days'
 order by confidence
 limit 20;
```

Below 0.65 means difficult site conditions, and the worker already logs it. A
sudden drop across many captures points at something else — a Deepgram model
change, or a keyword boost list that has grown past the cap and is silently
dropping terms.

## Restoring a deleted report

Reports are soft-deleted; the audio, transcripts and generated-versus-final
history are the liability record.

```sql
update reports set deleted_at = null where id = '<report>';
```

## Rotating a leaked credential

Order matters — rotate the store first, then the consumers, so there is no
window where the old value still works.

1. Rotate at the provider.
2. `fly secrets set <KEY>=<new>` — the machine restarts and drains in-flight jobs.
3. Update Vercel and redeploy.
4. For `WORKER_INTERNAL_TOKEN`, both must change together. Brief enqueue
   failures during the window are safe: the web app surfaces the error and the
   user retries.

## Escalation

| Symptom | Severity |
| --- | --- |
| A value exists with no resolvable source span | **Sev 1** — the guardrail has a hole. Stop exports. |
| A report was sent without human review | **Sev 1** — the gate has a hole. |
| Cross-org data visible | **Sev 1** — RLS. Take the app offline. |
| Queue not draining | Sev 2 |
| Transcription quality drop | Sev 3 |
| Cost alert | Sev 3 |
