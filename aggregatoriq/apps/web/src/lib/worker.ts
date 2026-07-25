import 'server-only';
import { serverEnv } from '@/env';

/**
 * Client for the worker.
 *
 * The web tier does not parse statements or run reconciliations itself. Both
 * need to write the canonical layer, which the app's database role is scoped
 * away from, and both are slow enough that doing them inside a request would
 * mean a user watching a spinner for a minute.
 */
async function post<T>(path: string, payload: unknown): Promise<T> {
  const env = serverEnv();

  const response = await fetch(`${env.WORKER_URL}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-internal-token': env.INTERNAL_API_TOKEN,
    },
    body: JSON.stringify(payload),
    cache: 'no-store',
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Worker ${path} failed with ${response.status}: ${detail.slice(0, 500)}`);
  }

  return (await response.json()) as T;
}

export interface IngestResponse {
  documentId: string;
  duplicate: boolean;
  parseStatus: string;
  rung: string;
  parserKey: string | null;
  ordersWritten: number;
  payoutsWritten: number;
  problems: number;
  message: string;
}

export async function ingestStatement(input: {
  orgId: string;
  branchId: string;
  aggregatorId: string;
  aggregatorCode: string;
  currency: string;
  timezone: string;
  filename: string | null;
  receivedVia: 'upload' | 'email' | 'free_audit';
  content: Buffer;
}): Promise<IngestResponse> {
  return post<IngestResponse>('/internal/ingest', {
    ...input,
    content: undefined,
    contentBase64: input.content.toString('base64'),
  });
}

export interface ReconResponse {
  reconRunId: string;
  engineVersion: string;
  varianceCount: number;
  recoveryTotalMinor: number;
  unmatchedLineCount: number;
  summary: { causeCode: string; count: number; totalDeltaMinor: number }[];
  warnings: string[];
}

export async function runReconciliation(input: {
  orgId: string;
  branchId: string;
  aggregatorId: string;
  periodStart: string;
  periodEnd: string;
  currency: string;
  materialityThresholdMinor: number;
  triggeredBy: string | null;
}): Promise<ReconResponse> {
  return post<ReconResponse>('/internal/recon/run', input);
}
