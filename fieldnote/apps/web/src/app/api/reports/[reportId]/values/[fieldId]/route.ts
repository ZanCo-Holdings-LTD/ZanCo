import { NextResponse } from 'next/server';
import { z } from 'zod';
import { repositories } from '@fieldnote/db';
import { toAppError } from '@fieldnote/shared';
import { requireSession, query } from '@/lib/session';
import { enqueue } from '@/lib/worker';

/**
 * Edit or confirm one field.
 *
 * Both actions clear the amber gate for that field, and the difference is
 * recorded rather than collapsed: an edit means the model was wrong and feeds
 * the phrase corpus, a confirmation means it was right and does not. Losing
 * that distinction would destroy the edit-distance metric.
 *
 * Runs under RLS as the caller, so a request naming another tenant's report
 * simply finds nothing.
 */

const body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('edit'), value: z.string().max(20_000) }),
  z.object({ action: z.literal('confirm') }),
]);

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ reportId: string; fieldId: string }> },
) {
  try {
    const session = await requireSession();
    const { reportId, fieldId } = await params;
    const input = body.parse(await request.json());

    if (input.action === 'confirm') {
      await query(session, (tx) =>
        repositories.values.confirm(tx, reportId, fieldId, session.userId),
      );
      return NextResponse.json({ ok: true });
    }

    const result = await query(session, async (tx) => {
      const report = await repositories.reports.findById(tx, session.orgId, reportId);
      if (!report) return null;

      const edited = await repositories.values.edit(
        tx,
        session.orgId,
        reportId,
        fieldId,
        input.value === '' ? null : input.value,
        session.userId,
      );

      // Stage 4: the learning loop. Only a real correction to something the
      // model actually produced teaches anything — a field the human filled
      // from scratch says nothing about how they rephrase.
      if (edited && typeof edited.generatedValue === 'string' && input.value) {
        await repositories.learning.recordEdit(tx, {
          orgId: session.orgId,
          userId: session.userId,
          fieldId,
          generatedText: edited.generatedValue,
          finalText: input.value,
        });
      }

      await repositories.audit.record(tx, {
        orgId: session.orgId,
        actorId: session.userId,
        action: 'value.edited',
        entityType: 'report_value',
        entityId: reportId,
        metadata: { fieldId },
      });

      return edited;
    });

    if (result === null) {
      return NextResponse.json(
        { error: { code: 'not_found', message: 'Report not found' } },
        { status: 404 },
      );
    }

    // Embedding runs out of band so the reviewer never waits on it.
    if (typeof result.generatedValue === 'string') {
      await enqueue({
        orgId: session.orgId,
        kind: 'embed_phrase_example',
        payload: { orgId: session.orgId },
        // Coalesce a burst of edits into one sweep of the backlog.
        idempotencyKey: `embed:${session.orgId}:${new Date().toISOString().slice(0, 13)}`,
      }).catch(() => {
        // The sweep is best-effort; a failure here must not fail the edit the
        // reviewer just made.
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    const appError = toAppError(error);
    return NextResponse.json(appError.toJSON(), { status: appError.status });
  }
}
