import { NextResponse } from 'next/server';
import { repositories } from '@fieldnote/db';
import { AppError, evaluateExportGate, toAppError } from '@fieldnote/shared';
import { requireSession, query } from '@/lib/session';
import { enqueue } from '@/lib/worker';

/**
 * Request a PDF export.
 *
 * The export gate is evaluated here, server-side, before any job is queued —
 * and again in the worker before the browser is launched. The client-side
 * check only greys out a button; these two are the control. A report with an
 * unreviewed low-confidence value must not be renderable by any path.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ reportId: string }> },
) {
  try {
    const session = await requireSession();
    const { reportId } = await params;

    const gate = await query(session, async (tx) => {
      const report = await repositories.reports.findById(tx, session.orgId, reportId);
      if (!report) throw new AppError('not_found', 'Report not found');

      const values = await repositories.values.loadForReview(tx, reportId, report.templateId);
      return evaluateExportGate(
        values.map((row) => ({
          value: row.value,
          confidence: row.confidence,
          required: row.required,
          editedByHuman: row.editedByHuman,
          reviewedAt: row.reviewedAt,
        })),
      );
    });

    if (!gate.canExport) {
      throw new AppError('export_blocked', gate.reasons.join('; '), { details: { ...gate } });
    }

    await enqueue({
      orgId: session.orgId,
      kind: 'render_pdf',
      payload: { orgId: session.orgId, reportId, requestedBy: session.userId },
      // Timestamped rather than keyed on the report alone: re-exporting after
      // further edits is a legitimate action that must produce a new version.
      idempotencyKey: `render:${reportId}:${Date.now()}`,
    });

    return NextResponse.json({ ok: true, queued: true }, { status: 202 });
  } catch (error: unknown) {
    const appError = toAppError(error);
    return NextResponse.json(appError.toJSON(), { status: appError.status });
  }
}
