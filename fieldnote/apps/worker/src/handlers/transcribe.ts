import { z } from 'zod';
import { asService, repositories } from '../db.js';
import { isPoorAudio, transcribe } from '@fieldnote/ai';
import { env } from '../env.js';
import { log } from '../logger.js';
import { contentTypeFor, download } from '../storage.js';
import type { JobContext } from './types.js';

export const transcribePayload = z.object({
  orgId: z.string().uuid(),
  reportId: z.string().uuid(),
  captureId: z.string().uuid(),
});

/**
 * Stage 1: transcribe one capture.
 *
 * Per capture rather than per report so a single unreadable recording does not
 * block the rest of a survey, and so a retry re-does one file instead of forty
 * minutes of audio.
 *
 * When this is the last outstanding capture on the report, structuring is
 * enqueued. That check happens here rather than on a timer because "all the
 * audio has arrived" is exactly the condition structuring waits on.
 */
export async function handleTranscribe(context: JobContext): Promise<void> {
  const { orgId, reportId, captureId } = transcribePayload.parse(context.payload);

  await asService(context.db, async (db) => {
    const capture = await repositories.captures.findById(db, captureId);
    if (!capture) {
      log.warn('capture disappeared before transcription', { captureId });
      return;
    }

    // Already done. The queue is at-least-once, so a repeat delivery is normal
    // and must be cheap rather than a duplicate Deepgram bill.
    if (capture.transcribedAt) {
      log.debug('capture already transcribed', { captureId });
      await maybeEnqueueStructuring(db, orgId, reportId);
      return;
    }

    const report = await repositories.reports.findById(db, orgId, reportId);
    if (!report) return;

    const keywords = await repositories.templates.asrKeywords(db, report.templateId);
    const audio = await download('captures', capture.storagePath);

    const transcript = await transcribe(audio, contentTypeFor(capture.storagePath), {
      apiKey: env.DEEPGRAM_API_KEY,
      model: env.DEEPGRAM_MODEL,
      language: env.DEEPGRAM_LANGUAGE,
      keywords,
      signal: context.signal,
    });

    await repositories.captures.attachTranscript(db, captureId, transcript);
    await repositories.billing.addTranscriptionCost(db, orgId, reportId, transcript.durationMs);

    if (isPoorAudio(transcript)) {
      // Surfaced rather than silently degrading the report — the reviewer needs
      // to know a section came from a recording made next to a running plant.
      log.warn('capture transcribed with low confidence', {
        captureId,
        meanConfidence: transcript.meanConfidence,
      });
    }

    log.info('capture transcribed', {
      captureId,
      durationMs: transcript.durationMs,
      words: transcript.words.length,
      meanConfidence: Number(transcript.meanConfidence.toFixed(3)),
    });

    await maybeEnqueueStructuring(db, orgId, reportId);
  });
}

async function maybeEnqueueStructuring(
  db: Parameters<typeof repositories.captures.allTranscribed>[0],
  orgId: string,
  reportId: string,
): Promise<void> {
  if (!(await repositories.captures.allTranscribed(db, reportId))) return;

  await repositories.jobs.enqueue(db, {
    orgId,
    kind: 'structure_report',
    payload: { orgId, reportId },
    // One structuring pass per report; repeated enqueues collapse.
    idempotencyKey: `structure:${reportId}`,
  });
  await repositories.reports.setStatus(db, orgId, reportId, 'processing');
}
