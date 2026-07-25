import { AppError } from '@fieldnote/shared';
import { env } from './env.js';

/**
 * Transactional email.
 *
 * The PDF is attached, not linked. A link in a client's inbox outlives the
 * signed URL behind it, gets forwarded, and eventually 404s in front of the
 * person the surveyor most wants to impress. An attachment is the artefact.
 */

export interface SendReportOptions {
  to: string;
  fromName: string;
  replyTo: string | null;
  subject: string;
  bodyText: string;
  attachment: { filename: string; content: Uint8Array };
}

export interface SendResult {
  providerMessageId: string;
}

export async function sendReport(options: SendReportOptions): Promise<SendResult> {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `${options.fromName} <${env.DELIVERY_FROM_EMAIL}>`,
      to: [options.to],
      ...(options.replyTo ? { reply_to: options.replyTo } : {}),
      subject: options.subject,
      text: options.bodyText,
      attachments: [
        {
          filename: options.attachment.filename,
          content: Buffer.from(options.attachment.content).toString('base64'),
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new AppError('upstream_failed', `Resend returned ${response.status}`, {
      retryable: response.status >= 500 || response.status === 429,
      details: { status: response.status, body: body.slice(0, 300) },
    });
  }

  const payload = (await response.json()) as { id?: string };
  if (!payload.id) {
    throw new AppError('upstream_failed', 'Resend accepted the send but returned no id', {
      retryable: false,
    });
  }
  return { providerMessageId: payload.id };
}

export function defaultSubject(propertyAddress: string, reference: string | null): string {
  return reference
    ? `Inspection report — ${propertyAddress} (${reference})`
    : `Inspection report — ${propertyAddress}`;
}

export function defaultBody(propertyAddress: string, surveyorName: string): string {
  return [
    'Good afternoon,',
    '',
    `Please find attached my inspection report for ${propertyAddress}.`,
    '',
    'Do let me know if you have any questions about the findings or the recommendations.',
    '',
    'Kind regards,',
    surveyorName,
  ].join('\n');
}
