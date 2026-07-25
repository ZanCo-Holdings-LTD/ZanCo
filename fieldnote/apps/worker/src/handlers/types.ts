import type { Db } from '../db.js';

export interface JobContext {
  db: Db;
  jobId: string;
  payload: unknown;
  attempt: number;
  /** Aborted when the process is shutting down, so a job can bail cleanly. */
  signal: AbortSignal;
}

export type JobHandler = (context: JobContext) => Promise<void>;
