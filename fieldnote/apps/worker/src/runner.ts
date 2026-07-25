import { randomUUID } from 'node:crypto';
import { toAppError, type JobKind } from '@fieldnote/shared';
import { db, repositories } from './db.js';
import { env } from './env.js';
import { errorFields, log } from './logger.js';
import { handleDeliver } from './handlers/deliver.js';
import { handleEmbed } from './handlers/embed.js';
import { handleRenderPdf } from './handlers/render-pdf.js';
import { handleStructure } from './handlers/structure.js';
import { handleTranscribe } from './handlers/transcribe.js';
import type { JobHandler } from './handlers/types.js';

/**
 * The job runner.
 *
 * Polls the Postgres-backed queue, claims a batch with FOR UPDATE SKIP LOCKED
 * and runs up to `WORKER_CONCURRENCY` handlers at once. Delivery is
 * at-least-once, so every handler is written to be safe on a repeat — that
 * property is checked in each handler, not assumed here.
 */

const HANDLERS: Record<JobKind, JobHandler> = {
  transcribe_capture: handleTranscribe,
  structure_report: handleStructure,
  render_pdf: handleRenderPdf,
  deliver_report: handleDeliver,
  embed_phrase_example: handleEmbed,
};

/** Identifies this process in the queue's lease column. */
const WORKER_ID = `${process.env.FLY_MACHINE_ID ?? 'local'}-${randomUUID().slice(0, 8)}`;

const IDLE_POLL_MS = 2_000;
const BUSY_POLL_MS = 100;

export class Runner {
  private running = false;
  private inFlight = 0;
  private readonly controller = new AbortController();
  private loopPromise: Promise<void> | undefined;

  start(): void {
    if (this.running) return;
    this.running = true;
    log.info('runner started', { workerId: WORKER_ID, concurrency: env.WORKER_CONCURRENCY });
    this.loopPromise = this.loop();
  }

  /**
   * Stop claiming new work and wait for in-flight jobs to finish.
   *
   * Fly sends SIGTERM before replacing a machine. A job killed mid-flight is
   * recoverable — its lease expires and another worker reclaims it — but
   * finishing cleanly avoids a duplicate Deepgram bill or a second email.
   */
  async stop(graceMs = 25_000): Promise<void> {
    if (!this.running) return;
    this.running = false;
    log.info('runner draining', { inFlight: this.inFlight });

    const deadline = Date.now() + graceMs;
    while (this.inFlight > 0 && Date.now() < deadline) {
      await sleep(200);
    }

    if (this.inFlight > 0) {
      log.warn('runner aborting in-flight jobs at deadline', { inFlight: this.inFlight });
      this.controller.abort();
    }

    await this.loopPromise;
    log.info('runner stopped');
  }

  private async loop(): Promise<void> {
    while (this.running) {
      const capacity = env.WORKER_CONCURRENCY - this.inFlight;
      if (capacity <= 0) {
        await sleep(BUSY_POLL_MS);
        continue;
      }

      let claimed;
      try {
        claimed = await repositories.jobs.claim(db, WORKER_ID, capacity);
      } catch (error: unknown) {
        // A database blip must not kill the loop; back off and try again.
        log.error('failed to claim jobs', errorFields(error));
        await sleep(IDLE_POLL_MS);
        continue;
      }

      if (claimed.length === 0) {
        await sleep(IDLE_POLL_MS);
        continue;
      }

      for (const job of claimed) {
        this.inFlight += 1;
        void this.run(job).finally(() => {
          this.inFlight -= 1;
        });
      }
    }
  }

  private async run(job: Awaited<ReturnType<typeof repositories.jobs.claim>>[number]): Promise<void> {
    const started = Date.now();
    const handler = HANDLERS[job.kind];

    if (!handler) {
      // An unknown kind means a deploy removed a handler that still has queued
      // work. Retrying forever would hide that, so it goes straight to dead.
      await repositories.jobs.fail(db, job, `No handler for kind ${job.kind}`, false);
      log.error('no handler for job kind', { jobId: job.id, kind: job.kind });
      return;
    }

    try {
      await handler({
        db,
        jobId: job.id,
        payload: job.payload,
        attempt: job.attempts,
        signal: this.controller.signal,
      });
      await repositories.jobs.succeed(db, job.id);
      log.info('job succeeded', {
        jobId: job.id,
        kind: job.kind,
        attempt: job.attempts,
        durationMs: Date.now() - started,
      });
    } catch (error: unknown) {
      const appError = toAppError(error);
      const outcome = await repositories.jobs.fail(
        db,
        job,
        `${appError.code}: ${appError.message}`,
        appError.retryable,
      );

      const fields = {
        jobId: job.id,
        kind: job.kind,
        attempt: job.attempts,
        code: appError.code,
        outcome,
        durationMs: Date.now() - started,
        ...errorFields(error),
      };

      // A dead job means a survey is stuck and someone has to look at it.
      if (outcome === 'dead') log.error('job dead', fields);
      else log.warn('job failed, will retry', fields);
    }
  }

  get stats(): { workerId: string; inFlight: number; running: boolean } {
    return { workerId: WORKER_ID, inFlight: this.inFlight, running: this.running };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
