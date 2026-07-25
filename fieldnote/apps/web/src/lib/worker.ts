import 'server-only';
import type { JobKind } from '@fieldnote/shared';
import { AppError } from '@fieldnote/shared';
import { env } from './env';

/**
 * Enqueue work on the worker.
 *
 * The web app never touches the jobs table directly — RLS revokes it from the
 * authenticated role entirely. Everything goes through the worker's internal
 * endpoint with a shared secret, which keeps the ASR and LLM keys in exactly
 * one process.
 */
export async function enqueue(input: {
  orgId: string;
  kind: JobKind;
  payload: Record<string, unknown>;
  idempotencyKey: string;
}): Promise<{ jobId: string | null; deduplicated: boolean }> {
  const response = await fetch(`${env.WORKER_URL}/jobs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Token': env.WORKER_INTERNAL_TOKEN,
    },
    body: JSON.stringify(input),
    // A slow worker must not hold a request handler open indefinitely.
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new AppError('upstream_failed', `Worker returned ${response.status}`, {
      retryable: response.status >= 500,
    });
  }

  return (await response.json()) as { jobId: string | null; deduplicated: boolean };
}
