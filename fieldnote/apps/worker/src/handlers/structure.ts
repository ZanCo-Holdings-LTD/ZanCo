import { z } from 'zod';
import type { PhotoContext, PhraseExample, Transcript } from '@fieldnote/shared';
import { PROMPT_VERSION, structureSection } from '@fieldnote/ai';
import {
  costAsShareOfArpu,
  ENGINE_VERSION,
  monthlyRevenuePence,
  type PlanId,
} from '@fieldnote/shared';
import { asService, repositories, type Db } from '../db.js';
import { env } from '../env.js';
import { log } from '../logger.js';
import type { JobContext } from './types.js';

export const structurePayload = z.object({
  orgId: z.string().uuid(),
  reportId: z.string().uuid(),
});

/**
 * Stage 2: structure a report, section by section.
 *
 * Sections run sequentially rather than in parallel. The shared prompt prefix
 * is cached, and a cache entry only becomes readable once the first response
 * has started streaming — firing all sections at once would have every one of
 * them pay the full uncached price. Sequential also keeps a long report from
 * consuming the whole worker's rate limit in one burst.
 */
export async function handleStructure(context: JobContext): Promise<void> {
  const { orgId, reportId } = structurePayload.parse(context.payload);

  await asService(context.db, async (db) => {
    const report = await repositories.reports.findById(db, orgId, reportId);
    if (!report) {
      log.warn('report disappeared before structuring', { reportId });
      return;
    }

    const sections = await repositories.templates.loadStructure(db, report.templateId);
    const captures = await repositories.captures.listForReport(db, reportId);
    const transcribed = captures.filter(
      (capture): capture is typeof capture & { cloudTranscript: Transcript } =>
        capture.cloudTranscript !== null,
    );

    if (transcribed.length === 0) {
      log.warn('no transcripts available for structuring', { reportId });
      return;
    }

    const runId = await repositories.runs.start(db, {
      orgId,
      reportId,
      engineVersion: ENGINE_VERSION,
      modelVersion: env.ANTHROPIC_STRUCTURING_MODEL,
      promptVersion: PROMPT_VERSION,
      sectionsTotal: sections.length,
    });

    for (const section of sections) {
      // A capture tagged with this section is the strongest signal we have;
      // untagged audio is offered to every section, because an inspector who
      // forgot to tap a chip still said the words somewhere.
      const relevant = transcribed.filter(
        (capture) => capture.sectionKey === section.key || capture.sectionKey === null,
      );
      if (relevant.length === 0) continue;

      const transcript = mergeTranscripts(relevant.map((capture) => capture.cloudTranscript));
      const primaryCaptureId = relevant[0]!.id;

      const photos = await loadPhotos(db, reportId, section.key);
      const phraseExamples = await loadPhraseExamples(db, report.ownerId, section);

      const result = await structureSection(
        {
          section,
          transcript,
          captureId: primaryCaptureId,
          photos,
          phraseExamples,
        },
        {
          apiKey: env.ANTHROPIC_API_KEY,
          model: env.ANTHROPIC_STRUCTURING_MODEL,
          effort: env.ANTHROPIC_EFFORT,
        },
      );

      const fieldIdByKey = new Map(section.fields.map((field) => [field.key, field.id]));
      await repositories.values.writeGenerated(
        db,
        orgId,
        reportId,
        result.section.fields
          .map((field) => {
            const fieldId = fieldIdByKey.get(field.fieldKey);
            if (!fieldId) return null;
            return {
              fieldId,
              value: field.value,
              confidence: field.confidence,
              sourceSpan: field.sourceSpan,
              modelVersion: env.ANTHROPIC_STRUCTURING_MODEL,
              promptVersion: result.promptVersion,
              engineVersion: ENGINE_VERSION,
            };
          })
          .filter((entry): entry is NonNullable<typeof entry> => entry !== null),
      );

      await repositories.billing.addStructuringCost(db, orgId, reportId, result.usage);
      await repositories.runs.recordSection(db, runId, result.ungroundedFieldKeys.length);

      log.info('section structured', {
        reportId,
        section: section.key,
        fields: result.section.fields.length,
        retried: result.retried,
        ungrounded: result.ungroundedFieldKeys.length,
        cacheReadTokens: result.usage.cacheReadInputTokens,
      });
    }

    await repositories.runs.finish(db, runId, 'succeeded');
    await repositories.reports.setStatus(db, orgId, reportId, 'needs_review');
    await checkMargin(db, orgId, reportId);
  });
}

/**
 * Concatenate several captures into one transcript.
 *
 * Character offsets are what the provenance guarantee rests on, so the merged
 * text must be exactly what the model is shown and word timings must be shifted
 * by each capture's start. Getting this wrong would make every citation in a
 * multi-capture report point at the wrong audio.
 */
export function mergeTranscripts(transcripts: Transcript[]): Transcript {
  if (transcripts.length === 1) return transcripts[0]!;

  const separator = '\n\n';
  let text = '';
  let elapsedMs = 0;
  const words: Transcript['words'] = [];

  for (const [index, transcript] of transcripts.entries()) {
    if (index > 0) text += separator;
    text += transcript.text;
    for (const word of transcript.words) {
      words.push({
        ...word,
        startMs: word.startMs + elapsedMs,
        endMs: word.endMs + elapsedMs,
      });
    }
    elapsedMs += transcript.durationMs;
  }

  const meanConfidence =
    words.length === 0 ? 0 : words.reduce((sum, word) => sum + word.confidence, 0) / words.length;

  return {
    text,
    words,
    provider: transcripts[0]!.provider,
    model: transcripts[0]!.model,
    meanConfidence,
    durationMs: elapsedMs,
  };
}

async function loadPhotos(db: Db, reportId: string, sectionKey: string): Promise<PhotoContext[]> {
  const assets = await repositories.captures.listPhotos(db, reportId, sectionKey);
  return assets.map((asset) => ({
    id: asset.id,
    caption: asset.caption,
    captureOffsetMs: asset.captureOffsetMs,
  }));
}

/**
 * Nearest-neighbour phrase examples for each field in the section.
 *
 * Falls back to recency when embeddings are unavailable. A slightly worse
 * prompt is much better than a failed report.
 */
async function loadPhraseExamples(
  db: Db,
  userId: string,
  section: Awaited<ReturnType<typeof repositories.templates.loadStructure>>[number],
): Promise<Record<string, PhraseExample[]>> {
  const examples: Record<string, PhraseExample[]> = {};
  for (const field of section.fields) {
    const recent = await repositories.learning.recentExamples(db, userId, field.id);
    if (recent.length > 0) examples[field.key] = recent;
  }
  return examples;
}

/**
 * Margin alert.
 *
 * Long reports from heavy users are what invert unit economics, and by the time
 * that shows up on an invoice it has been true for a month. Checked as soon as
 * a report's cost is known.
 */
async function checkMargin(db: Db, orgId: string, reportId: string): Promise<void> {
  const cost = await repositories.billing.reportCost(db, reportId);
  if (!cost) return;

  const subscription = await repositories.billing.getSubscription(db, orgId);
  const seats = subscription?.seats ?? 1;
  const planId = (subscription?.planId ?? 'solo_monthly') as PlanId;

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const { reportCount } = await repositories.billing.meanCostPerReport(db, orgId, since);

  const share = costAsShareOfArpu(
    cost.totalUsd,
    monthlyRevenuePence(planId, seats),
    Math.max(reportCount, 1),
  );

  if (share > env.INFERENCE_COST_ALERT_RATIO) {
    log.warn('inference cost exceeds target share of ARPU', {
      orgId,
      reportId,
      costUsd: Number(cost.totalUsd.toFixed(4)),
      shareOfArpu: Number(share.toFixed(3)),
      threshold: env.INFERENCE_COST_ALERT_RATIO,
    });
  }
}
