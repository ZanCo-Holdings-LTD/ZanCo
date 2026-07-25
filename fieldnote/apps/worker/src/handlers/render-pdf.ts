import { z } from 'zod';
import { AppError, ENGINE_VERSION, evaluateExportGate, reportPdfKey } from '@fieldnote/shared';
import {
  DEFAULT_DISCLAIMER,
  formatDate,
  formatTimestamp,
  formatValue,
  renderPdf,
  toDataUri,
  type PhotoModel,
  type ReportModel,
  type SectionModel,
} from '@fieldnote/pdf';
import { asService, repositories, type Db } from '../db.js';
import { log } from '../logger.js';
import { contentTypeFor, download, upload } from '../storage.js';
import type { JobContext } from './types.js';

export const renderPdfPayload = z.object({
  orgId: z.string().uuid(),
  reportId: z.string().uuid(),
  requestedBy: z.string().uuid().nullable(),
});

/**
 * Render a report to PDF and record an immutable version.
 *
 * The export gate is evaluated here, server-side, immediately before rendering.
 * The browser also evaluates it to grey out the button, but that check is a
 * courtesy — this one is the control. A report whose amber fields have not been
 * touched must not be renderable by any path, including a replayed request.
 */
export async function handleRenderPdf(context: JobContext): Promise<void> {
  const { orgId, reportId, requestedBy } = renderPdfPayload.parse(context.payload);

  await asService(context.db, async (db) => {
    const report = await repositories.reports.findById(db, orgId, reportId);
    if (!report) throw new AppError('not_found', `Report ${reportId} not found`);

    const values = await repositories.values.loadForReview(db, reportId, report.templateId);

    const gate = evaluateExportGate(
      values.map((row) => ({
        value: row.value,
        confidence: row.confidence,
        required: row.required,
        editedByHuman: row.editedByHuman,
        reviewedAt: row.reviewedAt,
      })),
    );

    if (!gate.canExport) {
      // Not retryable: nothing about waiting changes an unreviewed field.
      throw new AppError('export_blocked', `Cannot export: ${gate.reasons.join('; ')}`, {
        retryable: false,
        details: { ...gate },
      });
    }

    const model = await buildModel(db, orgId, report, values);
    const template = await templateNameFor(db, report.templateId);

    const { bytes, html } = await renderPdf(model, {
      template,
      ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    });

    const versions = await repositories.delivery.listVersions(db, reportId);
    const nextVersionNo = (versions[0]?.versionNo ?? 0) + 1;
    const path = reportPdfKey(orgId, reportId, nextVersionNo);

    await upload('reports', path, bytes, 'application/pdf');

    const version = await repositories.delivery.recordVersion(db, {
      orgId,
      reportId,
      pdfPath: path,
      // The rendered HTML is the reproducible snapshot: it pins exactly what
      // the client saw, independent of any later template or data change.
      snapshot: html,
      byteSize: bytes.byteLength,
      engineVersion: ENGINE_VERSION,
      renderedBy: requestedBy,
    });

    await repositories.reports.setStatus(db, orgId, reportId, 'ready');
    await repositories.audit.record(db, {
      orgId,
      actorId: requestedBy,
      action: 'report.exported',
      entityType: 'report',
      entityId: reportId,
      metadata: { versionNo: version.versionNo, byteSize: bytes.byteLength },
    });

    log.info('report rendered', {
      reportId,
      versionNo: version.versionNo,
      byteSize: bytes.byteLength,
    });
  });
}

async function templateNameFor(db: Db, templateId: string): Promise<string> {
  const template = await repositories.templates.findById(db, templateId);
  return template?.pdfTemplate ?? 'default';
}

/**
 * Assemble the view model.
 *
 * Every image is inlined as a data URI: the renderer runs with no network, and
 * a rendered report must never depend on a URL that could later 404 or be
 * swapped for different content.
 */
async function buildModel(
  db: Db,
  orgId: string,
  report: Awaited<ReturnType<typeof repositories.reports.findById>> & object,
  values: Awaited<ReturnType<typeof repositories.values.loadForReview>>,
): Promise<ReportModel> {
  const profile = await repositories.organisations.getProfile(db, report.ownerId);
  const organisation = await repositories.organisations.findById(db, orgId);

  const sections = new Map<string, SectionModel>();
  for (const row of values) {
    let section = sections.get(row.sectionKey);
    if (!section) {
      section = { title: row.sectionTitle, fields: [], photos: [] };
      sections.set(row.sectionKey, section);
    }
    const formatted = formatValue(row.value, row.type, row.enumValues);
    // Optional fields with nothing in them are noise on a client document;
    // required fields with nothing in them are a finding and stay visible.
    if (formatted.isEmpty && !row.required) continue;
    section.fields.push({
      label: row.label,
      value: formatted.text,
      isProse: formatted.isProse,
      isEmpty: formatted.isEmpty,
    });
  }

  for (const [sectionKey, section] of sections) {
    section.photos = await loadPhotos(db, report.id, sectionKey);
  }

  return {
    branding: {
      companyName: profile?.companyName ?? organisation?.name ?? 'Inspection Report',
      logoDataUri: await inlineAsset(profile?.logoPath),
      letterheadDataUri: await inlineAsset(profile?.letterheadPath),
      signatureDataUri: await inlineAsset(profile?.signaturePath),
      surveyorName: profile?.fullName ?? '',
      professionalBody: profile?.professionalBody ?? null,
    },
    propertyAddress: report.propertyAddress,
    clientName: report.clientName,
    reference: report.reference,
    inspectedAt: formatDate(report.inspectedAt),
    renderedAt: formatDate(new Date()) ?? '',
    versionLabel: `v${(await repositories.delivery.listVersions(db, report.id)).length + 1}`,
    sections: [...sections.values()],
    disclaimer: DEFAULT_DISCLAIMER,
  };
}

async function loadPhotos(db: Db, reportId: string, sectionKey: string): Promise<PhotoModel[]> {
  const assets = await repositories.captures.listPhotos(db, reportId, sectionKey);
  const photos: PhotoModel[] = [];

  for (const asset of assets) {
    try {
      const bytes = await download('media', asset.storagePath);
      photos.push({
        dataUri: toDataUri(bytes, contentTypeFor(asset.storagePath)),
        caption: asset.caption,
        timestamp: formatTimestamp(asset.captureOffsetMs),
      });
    } catch (error: unknown) {
      // A missing photo should not block a report the surveyor needs to send.
      log.warn('photo unavailable at render time', {
        assetId: asset.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return photos;
}

async function inlineAsset(path: string | null | undefined): Promise<string | null> {
  if (!path) return null;
  try {
    const bytes = await download('branding', path);
    return toDataUri(bytes, contentTypeFor(path));
  } catch {
    return null;
  }
}
