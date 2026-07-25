import { z } from 'zod';
import { embed, phraseExampleText } from '@fieldnote/ai';
import { asService, repositories } from '../db.js';
import { embeddingApiKey, env } from '../env.js';
import { log } from '../logger.js';
import type { JobContext } from './types.js';

export const embedPayload = z.object({
  orgId: z.string().uuid(),
  /** Optional: embed one example, or sweep the backlog when absent. */
  exampleId: z.string().uuid().optional(),
});

/**
 * Stage 4: the learning loop.
 *
 * Embedding happens here rather than inline on the edit, so the review
 * workspace never blocks on an embeddings API call. A surveyor correcting
 * twenty fields should feel no latency at all from the fact that we are
 * learning from them.
 */
export async function handleEmbed(context: JobContext): Promise<void> {
  const { orgId } = embedPayload.parse(context.payload);

  await asService(context.db, async (db) => {
    const pending = await repositories.learning.listPendingEmbedding(db, 100);
    if (pending.length === 0) return;

    const texts = pending.map((row) => phraseExampleText(row.generatedText, row.finalText));

    const vectors = await embed(texts, {
      provider: env.EMBEDDING_PROVIDER,
      model: env.EMBEDDING_MODEL,
      dimensions: env.EMBEDDING_DIMENSIONS,
      apiKey: embeddingApiKey,
      signal: context.signal,
    });

    for (const [index, row] of pending.entries()) {
      const vector = vectors[index];
      if (!vector) continue;
      await repositories.learning.attachEmbedding(db, row.id, vector);
    }

    log.info('phrase examples embedded', { orgId, count: pending.length });
  });
}
