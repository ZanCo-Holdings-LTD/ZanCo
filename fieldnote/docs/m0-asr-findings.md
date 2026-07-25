# M0: ASR field test findings

> **Status: NOT YET RUN.**
>
> This file is a template, not a result. The gate below has not been tested, and
> no result has been recorded here or communicated to the engineering work in
> this repository.
>
> The code in this repo was built ahead of the gate on explicit instruction. That
> does not change what the gate is for: **if speech recognition does not survive
> real site conditions, none of the software matters.** Run the test. Record the
> numbers here. If it fails, the correct action is to stop and put the time into
> the other product, not to tune the prompt.

---

## What the test is

Two weeks, about £300, no software beyond a throwaway script.

Five inspectors, recording in the conditions that actually break ASR:

| Condition                                     | Why it is on the list                                                                      |
| --------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Loft with a dehumidifier running              | Broadband mechanical noise at close range. The single most common damp-survey environment. |
| Plant room                                    | Reverberant, hard surfaces, intermittent loud machinery.                                   |
| Windy roof                                    | Wind noise directly across the microphone; the hardest case for any ASR.                   |
| Strong non-native English accent (×2 minimum) | The GCC vertical and much of the UK trade workforce. Accent robustness is not optional.    |

Push each recording through Deepgram Nova, then through a structuring prompt
against a real report template.

## The gate

Both must hold:

1. **Word error rate under roughly 15% in the worst condition.** Not on average —
   the average is dominated by the easy recordings and tells you nothing.
2. **An inspector says the structured output takes less time to correct than to
   write from scratch.** Ask them to time both. Do not accept an impression;
   impressions are generous to new technology and unreliable a fortnight later.

If it fails, abandon Fieldnote and put the time into AggregatorIQ.

If WER is marginal (15–20%) but the time comparison is decisively favourable, the
product may still be real — but the keyword boost list and the amber threshold
both need retuning before a beta, and that should be recorded here as an explicit
decision rather than assumed.

## Results

Fill this in. Do not summarise; record the numbers.

### Word error rate by condition

| Inspector | Condition | Recording length | WER | Notes |
| --------- | --------- | ---------------- | --- | ----- |
|           |           |                  |     |       |

Compute WER against a human transcript of the same audio, not against the
inspector's memory of what they said.

### Time comparison

| Inspector | Report | Time to write from scratch | Time to correct structured output | Verdict |
| --------- | ------ | -------------------------- | --------------------------------- | ------- |
|           |        |                            |                                   |         |

### Domain vocabulary the model got wrong

Every mishearing here becomes an entry in the template's `asr_keywords` boost
list (`packages/db/src/seed/templates/`). This table is the most directly useful
output of the whole exercise.

| Said | Transcribed as | Frequency | Added to boost list |
| ---- | -------------- | --------- | ------------------- |
|      |                |           |                     |

### Structuring quality

Which fields did the model get right, get wrong, and invent? An invented finding
here is the single most important observation in the test — record the exact
transcript and the exact fabricated output, and turn it into an eval fixture.

| Field | Correct | Missed | Fabricated | Notes |
| ----- | ------- | ------ | ---------- | ----- |
|       |         |        |            |       |

## Gate decision

- **Date:**
- **Worst-condition WER:**
- **Time comparison verdict:**
- **Decision:** PASS / FAIL
- **Decided by:**

## What to do with the recordings

Do not throw them away. With written consent from each inspector, and with
addresses and occupier details redacted, they become the first entries in
`evals/fixtures/` — which is what stops a future prompt change silently
regressing. See that directory's README for the format and the consent
requirements.
