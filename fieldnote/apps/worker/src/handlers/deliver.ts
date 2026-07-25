import { z } from 'zod';
import { AppError, slugify } from '@fieldnote/shared';
import { asService, repositories } from '../db.js';
import { defaultBody, defaultSubject, sendReport } from '../email.js';
import { env } from '../env.js';
import { log } from '../logger.js';
import { download } from '../storage.js';
import type { JobContext } from './types.js';

export const deliverPayload = z.object({
  orgId: z.string().uuid(),
  reportId: z.string().uuid(),
  deliveryId: z.string().uuid(),
});

/**
 * Send a report to a client.
 *
 * A report is never auto-sent. This job only ever runs because a human pressed
 * send and the web app created a pending delivery row — the row exists before
 * the attempt so a provider failure stays visible in the report's history
 * rather than vanishing.
 */
export async function handleDeliver(context: JobContext): Promise<void> {
  const { orgId, reportId, deliveryId } = deliverPayload.parse(context.payload);

  await asService(context.db, async (db) => {
    const deliveries = await repositories.delivery.listForReport(db, reportId);
    const delivery = deliveries.find((row) => row.id === deliveryId);
    if (!delivery) throw new AppError('not_found', `Delivery ${deliveryId} not found`);

    // At-least-once queue: a redelivery must not send the client a second copy.
    if (delivery.sentAt) {
      log.debug('delivery already sent', { deliveryId });
      return;
    }

    const report = await repositories.reports.findById(db, orgId, reportId);
    if (!report) throw new AppError('not_found', `Report ${reportId} not found`);

    const versions = await repositories.delivery.listVersions(db, reportId);
    const version = versions.find((row) => row.id === delivery.versionId);
    if (!version) throw new AppError('not_found', 'Report version not found');

    const profile = await repositories.organisations.getProfile(db, report.ownerId);
    const surveyorName = profile?.fullName ?? profile?.companyName ?? env.DELIVERY_FROM_NAME;
    const pdf = await download('reports', version.pdfPath);

    try {
      const { providerMessageId } = await sendReport({
        to: delivery.toEmail,
        fromName: profile?.companyName ?? env.DELIVERY_FROM_NAME,
        // Replies belong to the surveyor, not to our sending domain.
        replyTo: null,
        subject: delivery.subject ?? defaultSubject(report.propertyAddress, report.reference),
        bodyText: delivery.message ?? defaultBody(report.propertyAddress, surveyorName),
        attachment: {
          filename: `${slugify(report.reference ?? report.propertyAddress)}-v${version.versionNo}.pdf`,
          content: pdf,
        },
      });

      await repositories.delivery.markSent(db, deliveryId, providerMessageId);
      await repositories.reports.setStatus(db, orgId, reportId, 'sent');
      await repositories.audit.record(db, {
        orgId,
        actorId: delivery.sentBy,
        action: 'delivery.sent',
        entityType: 'delivery',
        entityId: deliveryId,
        metadata: { versionNo: version.versionNo, providerMessageId },
      });

      log.info('report delivered', { reportId, deliveryId, versionNo: version.versionNo });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      await repositories.delivery.markFailed(db, deliveryId, message);
      throw error;
    }
  });
}
