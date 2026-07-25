/**
 * Eval harness.
 *
 * Scores structuring against real reports from design partners: their original
 * audio, their transcript, and the report they actually signed. Four numbers
 * matter, and they are not equally weighted.
 *
 *  - Hallucination rate. Hard fail above zero. A value the inspector did not
 *    say is the one failure mode we do not trade off against anything.
 *  - Field recall. Target above 0.85. Missing findings cost review time.
 *  - Field precision. Wrong values that were nonetheless said — usually a
 *    mis-scoped extraction.
 *  - Mean edit distance per field. The product-health metric: it should fall
 *    over time as the phrase corpus grows, and a prompt change that raises it
 *    should be reverted whether or not recall improved.
 */
import { normalisedEditDistance } from '@fieldnote/shared';
import type { GeneratedField, TemplateSectionDef, Transcript } from '@fieldnote/shared';

export interface FixtureField {
  fieldKey: string;
  /**
   * The value on the signed report. `null` means the inspector did not state
   * it — producing a value here is a hallucination, not a near miss.
   */
  expected: string | number | boolean | string[] | null;
}

export interface FixtureSection {
  sectionKey: string;
  fields: FixtureField[];
}

export interface Fixture {
  id: string;
  description: string;
  templateName: string;
  /** Recording conditions, so failures can be attributed to audio not prompts. */
  conditions: string;
  transcript: Transcript;
  captureId: string;
  sections: FixtureSection[];
}

export interface FieldOutcome {
  fixtureId: string;
  sectionKey: string;
  fieldKey: string;
  expected: unknown;
  actual: unknown;
  /** Model produced a value where the report has none. */
  hallucinated: boolean;
  /** Report has a value the model did not produce. */
  missed: boolean;
  /** Both present. `editDistance` says how close. */
  matched: boolean;
  editDistance: number | null;
  groundedSpan: boolean;
}

export interface EvalReport {
  fixtureCount: number;
  fieldCount: number;
  hallucinationRate: number;
  recall: number;
  precision: number;
  f1: number;
  meanEditDistance: number;
  ungroundedCount: number;
  outcomes: FieldOutcome[];
  failures: string[];
}

export const THRESHOLDS = {
  /** Non-negotiable. */
  maxHallucinationRate: 0,
  minRecall: 0.85,
  minPrecision: 0.8,
  /** A tripwire, not a target: rising edit distance means a regression. */
  maxMeanEditDistance: 0.45,
};

function isEmpty(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  );
}

function asText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}

export function scoreField(
  fixtureId: string,
  sectionKey: string,
  expected: FixtureField,
  actual: GeneratedField | undefined,
): FieldOutcome {
  const expectedEmpty = isEmpty(expected.expected);
  const actualValue = actual?.value ?? null;
  const actualEmpty = isEmpty(actualValue);

  const hallucinated = expectedEmpty && !actualEmpty;
  const missed = !expectedEmpty && actualEmpty;
  const matched = !expectedEmpty && !actualEmpty;

  return {
    fixtureId,
    sectionKey,
    fieldKey: expected.fieldKey,
    expected: expected.expected,
    actual: actualValue,
    hallucinated,
    missed,
    matched,
    editDistance: matched
      ? normalisedEditDistance(asText(expected.expected), asText(actualValue))
      : null,
    // A non-null value with no resolved span should be impossible after the
    // guardrail; if one appears here the guardrail has a hole.
    groundedSpan: actualEmpty ? true : actual?.sourceSpan !== null,
  };
}

export function aggregate(outcomes: FieldOutcome[], fixtureCount: number): EvalReport {
  const hallucinated = outcomes.filter((o) => o.hallucinated);
  const missed = outcomes.filter((o) => o.missed);
  const matched = outcomes.filter((o) => o.matched);
  const ungrounded = outcomes.filter((o) => !o.groundedSpan);

  const produced = matched.length + hallucinated.length;
  const present = matched.length + missed.length;

  const recall = present === 0 ? 1 : matched.length / present;
  const precision = produced === 0 ? 1 : matched.length / produced;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  const distances = matched.map((o) => o.editDistance ?? 0);
  const meanEditDistance =
    distances.length === 0 ? 0 : distances.reduce((a, b) => a + b, 0) / distances.length;

  const hallucinationRate = outcomes.length === 0 ? 0 : hallucinated.length / outcomes.length;

  const failures: string[] = [];
  if (hallucinationRate > THRESHOLDS.maxHallucinationRate) {
    failures.push(
      `Hallucination rate ${(hallucinationRate * 100).toFixed(2)}% exceeds the hard limit of 0%. ` +
        `Offending fields: ${hallucinated.map((o) => `${o.fixtureId}/${o.fieldKey}`).join(', ')}`,
    );
  }
  if (recall < THRESHOLDS.minRecall) {
    failures.push(`Recall ${recall.toFixed(3)} is below the ${THRESHOLDS.minRecall} threshold.`);
  }
  if (precision < THRESHOLDS.minPrecision) {
    failures.push(
      `Precision ${precision.toFixed(3)} is below the ${THRESHOLDS.minPrecision} threshold.`,
    );
  }
  if (meanEditDistance > THRESHOLDS.maxMeanEditDistance) {
    failures.push(
      `Mean edit distance ${meanEditDistance.toFixed(3)} exceeds ${THRESHOLDS.maxMeanEditDistance}. ` +
        'Values are being produced but need heavy rewriting.',
    );
  }
  if (ungrounded.length > 0) {
    failures.push(
      `${ungrounded.length} value(s) survived with no resolved source span. The guardrail has a hole.`,
    );
  }

  return {
    fixtureCount,
    fieldCount: outcomes.length,
    hallucinationRate,
    recall,
    precision,
    f1,
    meanEditDistance,
    ungroundedCount: ungrounded.length,
    outcomes,
    failures,
  };
}

/** Look up a fixture's section definition by key. */
export function sectionFor(
  sections: TemplateSectionDef[],
  key: string,
): TemplateSectionDef | undefined {
  return sections.find((section) => section.key === key);
}

export function formatReport(report: EvalReport): string {
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const lines = [
    '',
    '  Fieldnote structuring eval',
    '  ' + '-'.repeat(48),
    `  Fixtures            ${report.fixtureCount}`,
    `  Fields scored       ${report.fieldCount}`,
    '',
    `  Hallucination rate  ${pct(report.hallucinationRate)}  (must be 0%)`,
    `  Recall              ${report.recall.toFixed(3)}   (target > ${THRESHOLDS.minRecall})`,
    `  Precision           ${report.precision.toFixed(3)}   (target > ${THRESHOLDS.minPrecision})`,
    `  F1                  ${report.f1.toFixed(3)}`,
    `  Mean edit distance  ${report.meanEditDistance.toFixed(3)}   (lower is better)`,
    `  Ungrounded values   ${report.ungroundedCount}`,
    '',
  ];

  if (report.failures.length > 0) {
    lines.push('  FAILED');
    for (const failure of report.failures) lines.push(`    - ${failure}`);
  } else {
    lines.push('  PASSED');
  }
  lines.push('');
  return lines.join('\n');
}
