# Eval fixtures

Real reports from design partners: their original audio, the transcript, and the
wording they actually signed and sent to a client.

**These are client documents about real properties.** They are not public data
and they do not belong in a public repository. Before a fixture goes in here:

1. Get written consent from the firm to use the report for model evaluation.
2. Redact the property address, the client's name, and anything else that
   identifies the occupier. The `propertyAddress` field is not scored.
3. Keep the audio out of git — the `.gitignore` excludes `*.wav`, `*.m4a` and
   `*.mp3` in this directory. Store it alongside, not inside.

Target: **fifty** fixtures. Below twenty the numbers move too much between runs
to tell a prompt improvement from noise.

## Format

One JSON file per fixture:

```jsonc
{
  "fixture": {
    "id": "damp-001-loft-dehumidifier",
    "description": "Terraced house, damp to rear elevation, loft inspection",
    "templateName": "Damp and Timber Survey (PCA format)",
    // Recording conditions, so a failure can be attributed to the audio rather
    // than to the prompt. Be specific — this is the M0 gate expressed per file.
    "conditions": "Loft, dehumidifier running, non-native English speaker",
    "captureId": "00000000-0000-4000-8000-000000000001",
    "transcript": {
      "text": "The north elevation shows rising damp ...",
      "words": [{ "word": "The", "startMs": 0, "endMs": 220, "confidence": 0.99 }],
      "provider": "deepgram",
      "model": "nova-3",
      "meanConfidence": 0.91,
      "durationMs": 1840000,
    },
    "sections": [
      {
        "sectionKey": "internal_damp",
        "fields": [
          {
            "fieldKey": "damp_type",
            // The value on the signed report. `null` means the inspector did
            // not state it — producing a value here counts as a hallucination,
            // which is a hard fail.
            "expected": ["Rising damp"],
          },
          { "fieldKey": "relative_humidity", "expected": null },
        ],
      },
    ],
  },
  // The template shape travels with the fixture so an eval run stays
  // reproducible after the seed template changes.
  "sections": [
    {
      "id": "...",
      "key": "internal_damp",
      "title": "Internal dampness",
      "guidance": null,
      "orderIndex": 2,
      "fields": [
        {
          "id": "...",
          "key": "damp_type",
          "label": "Type of dampness diagnosed",
          "type": "multi_enum",
          "required": true,
          "enumValues": ["Rising damp", "Penetrating damp", "Condensation"],
          "extractionHint": "...",
          "orderIndex": 1,
        },
      ],
    },
  ],
}
```

## Running

```bash
pnpm eval          # prints the report
pnpm eval --ci     # exits non-zero on any threshold failure
```

## What fails the build

| Metric             | Threshold  | Why                                                                                                                                              |
| ------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Hallucination rate | must be 0% | A value the inspector never said is a professional indemnity claim. This is the one number with no tolerance.                                    |
| Recall             | > 0.85     | Below this, review takes longer than typing the report from scratch.                                                                             |
| Precision          | > 0.80     | Wrong-but-mentioned values erode trust nearly as fast as invented ones.                                                                          |
| Mean edit distance | < 0.45     | A tripwire. It should be _falling_ over time as the phrase corpus grows; a prompt change that raises it is a regression even if recall improves. |
| Ungrounded values  | 0          | Any value surviving without a resolved source span means the guardrail has a hole.                                                               |

Include a spread of conditions, not just the easy ones. The M0 field test named
the hard cases — a loft with a dehumidifier running, a plant room, a windy roof,
and at least two strong non-native English accents. If those are not represented
here, the eval is measuring a quiet room.
