/**
 * Run the structuring eval against the recorded fixtures.
 *
 *   pnpm eval            # local, prints the report
 *   pnpm eval --ci       # exits non-zero on any threshold failure
 *
 * Fixtures live in ../../../evals/fixtures. Each is a real report from a design
 * partner with their original audio and the wording they actually signed. See
 * that directory's README for the format and the consent requirements — these
 * are client documents about real properties, and they are not public data.
 */
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TemplateSectionDef } from '@fieldnote/shared';
import { structureSection } from '../src/structure.js';
import {
  aggregate,
  formatReport,
  scoreField,
  sectionFor,
  type FieldOutcome,
  type Fixture,
} from './harness.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, '../../../evals/fixtures');

interface FixtureFile {
  fixture: Fixture;
  /** Template shape travels with the fixture so evals are reproducible. */
  sections: TemplateSectionDef[];
}

async function loadFixtures(): Promise<FixtureFile[]> {
  let entries: string[];
  try {
    entries = (await readdir(fixturesDir)).filter((name) => name.endsWith('.json'));
  } catch {
    return [];
  }

  const loaded: FixtureFile[] = [];
  for (const entry of entries) {
    const raw = await readFile(join(fixturesDir, entry), 'utf8');
    loaded.push(JSON.parse(raw) as FixtureFile);
  }
  return loaded;
}

async function main(): Promise<void> {
  const ci = process.argv.includes('--ci');
  const fixtures = await loadFixtures();

  if (fixtures.length === 0) {
    // An empty fixture set is not a pass. Say so clearly rather than printing
    // a green report built from nothing.
    console.error(
      `\n  No fixtures found in ${fixturesDir}.\n` +
        '  The eval harness scores against real design-partner reports; see that\n' +
        "  directory's README for the format. Add at least twenty before trusting\n" +
        '  any structuring change.\n',
    );
    process.exit(ci ? 1 : 0);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY is not set.');
    process.exit(1);
  }

  const options = {
    apiKey,
    model: process.env.ANTHROPIC_STRUCTURING_MODEL ?? 'claude-sonnet-5',
    effort: (process.env.ANTHROPIC_EFFORT ?? 'medium') as 'low' | 'medium' | 'high',
  };

  const outcomes: FieldOutcome[] = [];
  let totalCostTokens = 0;

  for (const { fixture, sections } of fixtures) {
    process.stdout.write(`  ${fixture.id} (${fixture.conditions}) ... `);

    for (const expectedSection of fixture.sections) {
      const definition = sectionFor(sections, expectedSection.sectionKey);
      if (!definition) {
        console.warn(`\n    skipping unknown section ${expectedSection.sectionKey}`);
        continue;
      }

      const result = await structureSection(
        {
          section: definition,
          transcript: fixture.transcript,
          captureId: fixture.captureId,
          photos: [],
          // Evals run without the per-user corpus so the score reflects the
          // prompt, not one partner's accumulated phrasing history.
          phraseExamples: {},
        },
        options,
      );

      totalCostTokens += result.usage.inputTokens + result.usage.outputTokens;

      const produced = new Map(result.section.fields.map((field) => [field.fieldKey, field]));
      for (const expectedField of expectedSection.fields) {
        outcomes.push(
          scoreField(
            fixture.id,
            expectedSection.sectionKey,
            expectedField,
            produced.get(expectedField.fieldKey),
          ),
        );
      }
    }
    process.stdout.write('done\n');
  }

  const report = aggregate(outcomes, fixtures.length);
  console.log(formatReport(report));
  console.log(`  Tokens consumed: ${totalCostTokens.toLocaleString()}\n`);

  if (ci && report.failures.length > 0) process.exit(1);
}

main().catch((error: unknown) => {
  console.error('Eval run failed:', error);
  process.exit(1);
});
