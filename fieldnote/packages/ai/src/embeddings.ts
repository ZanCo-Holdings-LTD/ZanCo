import { AppError } from '@fieldnote/shared';

/**
 * Embeddings for phrase-example retrieval.
 *
 * Deliberately provider-agnostic: this is a similarity index over short
 * strings, not a reasoning task, and the dimension is pinned by the database
 * column rather than by any one vendor. Swapping providers means re-embedding
 * the corpus, so the choice is recorded in the environment, not in code.
 */

export type EmbeddingProvider = 'openai' | 'voyage';

export interface EmbeddingOptions {
  provider: EmbeddingProvider;
  model: string;
  dimensions: number;
  apiKey: string;
  signal?: AbortSignal;
}

/**
 * The text we actually embed is the pair, not just the final wording.
 *
 * Retrieval is looking for "a case where the model wrote something like this
 * and the surveyor changed it like that" — the generated side is what the
 * query resembles at lookup time.
 */
export function phraseExampleText(generatedText: string, finalText: string): string {
  return `${generatedText}\n->\n${finalText}`;
}

export async function embed(texts: string[], options: EmbeddingOptions): Promise<number[][]> {
  if (texts.length === 0) return [];
  return options.provider === 'openai' ? embedOpenAI(texts, options) : embedVoyage(texts, options);
}

async function embedOpenAI(texts: string[], options: EmbeddingOptions): Promise<number[][]> {
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: options.model,
      input: texts,
      dimensions: options.dimensions,
    }),
    signal: options.signal ?? null,
  });

  if (!response.ok) {
    throw upstream('OpenAI', response.status, await response.text().catch(() => ''));
  }

  const payload = (await response.json()) as {
    data: { index: number; embedding: number[] }[];
  };
  // The API does not guarantee input order in the response.
  return payload.data.sort((a, b) => a.index - b.index).map((row) => row.embedding);
}

async function embedVoyage(texts: string[], options: EmbeddingOptions): Promise<number[][]> {
  const response = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: options.model,
      input: texts,
      input_type: 'document',
      output_dimension: options.dimensions,
    }),
    signal: options.signal ?? null,
  });

  if (!response.ok) {
    throw upstream('Voyage', response.status, await response.text().catch(() => ''));
  }

  const payload = (await response.json()) as {
    data: { index: number; embedding: number[] }[];
  };
  return payload.data.sort((a, b) => a.index - b.index).map((row) => row.embedding);
}

function upstream(provider: string, status: number, body: string): AppError {
  return new AppError('upstream_failed', `${provider} embeddings returned ${status}`, {
    retryable: status >= 500 || status === 429,
    details: { status, body: body.slice(0, 300) },
  });
}

/** Cosine similarity, for tests and for offline analysis of the corpus. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    magA += x * x;
    magB += y * y;
  }
  const denominator = Math.sqrt(magA) * Math.sqrt(magB);
  return denominator === 0 ? 0 : dot / denominator;
}
