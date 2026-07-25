import { and, eq, sql } from 'drizzle-orm';
import { MAX_PHRASE_EXAMPLES_PER_FIELD, normalisedEditDistance } from '@fieldnote/shared';
import type { PhraseExample } from '@fieldnote/shared';
import type { Database } from '../client.js';
import { phraseExamples } from '../schema/learning.js';

export interface RecordEditInput {
  orgId: string;
  userId: string;
  fieldId: string;
  generatedText: string;
  finalText: string;
}

/**
 * Capture a (generated, final) pair after a human edit.
 *
 * Called on every edit where the model actually produced something — a field
 * the human filled from scratch teaches nothing about how they rephrase. The
 * embedding is written later by a job, so the review workspace never waits on
 * an embedding API call.
 */
export async function recordEdit(db: Database, input: RecordEditInput): Promise<string | null> {
  const generated = input.generatedText.trim();
  const final = input.finalText.trim();

  // No signal in a no-op edit, and none in an empty final value.
  if (!generated || !final || generated === final) return null;

  const [row] = await db
    .insert(phraseExamples)
    .values({
      orgId: input.orgId,
      userId: input.userId,
      fieldId: input.fieldId,
      generatedText: generated,
      finalText: final,
      editDistance: normalisedEditDistance(generated, final).toFixed(4),
    })
    .returning({ id: phraseExamples.id });

  return row?.id ?? null;
}

export async function attachEmbedding(
  db: Database,
  exampleId: string,
  embedding: number[],
): Promise<void> {
  await db
    .update(phraseExamples)
    .set({ embedding })
    .where(eq(phraseExamples.id, exampleId));
}

export async function listPendingEmbedding(db: Database, limit = 100) {
  return db
    .select({
      id: phraseExamples.id,
      generatedText: phraseExamples.generatedText,
      finalText: phraseExamples.finalText,
    })
    .from(phraseExamples)
    .where(sql`${phraseExamples.embedding} is null`)
    .limit(limit);
}

/**
 * Nearest-neighbour phrase examples for one user and one field.
 *
 * Pre-filtered to (user, field) before the vector scan — the corpus is
 * per-user by design, and a surveyor's phrasing for "damp cause" tells us
 * nothing about their phrasing for "consumer unit rating".
 */
export async function nearestExamples(
  db: Database,
  userId: string,
  fieldId: string,
  queryEmbedding: number[],
  limit = MAX_PHRASE_EXAMPLES_PER_FIELD,
): Promise<PhraseExample[]> {
  const literal = `[${queryEmbedding.join(',')}]`;
  const rows = await db.execute<{ generated_text: string; final_text: string }>(sql`
    select generated_text, final_text
      from phrase_examples
     where user_id = ${userId}
       and field_id = ${fieldId}
       and embedding is not null
     order by embedding <=> ${literal}::vector
     limit ${limit}
  `);

  return rows.map((row) => ({
    generatedText: row.generated_text,
    finalText: row.final_text,
  }));
}

/**
 * Recent examples for a field, used when embeddings are unavailable.
 *
 * The retrieval path degrades to recency rather than failing the structuring
 * call — a slightly worse prompt beats no report.
 */
export async function recentExamples(
  db: Database,
  userId: string,
  fieldId: string,
  limit = MAX_PHRASE_EXAMPLES_PER_FIELD,
): Promise<PhraseExample[]> {
  const rows = await db
    .select({
      generatedText: phraseExamples.generatedText,
      finalText: phraseExamples.finalText,
    })
    .from(phraseExamples)
    .where(and(eq(phraseExamples.userId, userId), eq(phraseExamples.fieldId, fieldId)))
    .orderBy(sql`${phraseExamples.createdAt} desc`)
    .limit(limit);
  return rows;
}

/**
 * Mean edit distance per field over a window.
 *
 * This is the primary product-health metric. Falling means the model is
 * learning the user's phrasing; flat or rising after a prompt change is a
 * regression worth reverting.
 */
export async function meanEditDistance(
  db: Database,
  orgId: string,
  since: Date,
): Promise<number | null> {
  const [row] = await db
    .select({ mean: sql<string | null>`avg(${phraseExamples.editDistance})` })
    .from(phraseExamples)
    .where(and(eq(phraseExamples.orgId, orgId), sql`${phraseExamples.createdAt} >= ${since}`));

  return row?.mean == null ? null : Number(row.mean);
}
