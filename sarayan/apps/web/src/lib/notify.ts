import "server-only";

import type { Channel } from "@sarayan/core-watch";
import { db } from "@/db";
import { alertDeliveries } from "@/db/schema";
import { env, features } from "./env";

/**
 * Alert delivery.
 *
 * Every send is metered into `alert_deliveries` with a cost, because WhatsApp
 * pricing eroding margin is a named risk and you cannot cap what you do not
 * measure. In-app delivery is free and always succeeds — it is the floor that
 * makes "the alert was never sent" impossible.
 */

export interface Recipient {
  name: string;
  email: string | null;
  phone: string | null;
  locale: "en" | "ar";
}

export interface AlertMessage {
  recordTitle: string;
  holderName: string;
  entityName: string;
  expiresOn: string;
  daysRemaining: number;
  recordUrl: string;
  acknowledgeUrl: string;
  documentTypeName: string;
}

export interface DeliveryOutcome {
  channel: Channel;
  recipient: string;
  succeeded: boolean;
  error: string | null;
  providerMessageId: string | null;
  costMinorUnits: number;
}

/** Indicative per-message costs in GBP pence, for the margin ledger. */
const COST_PENCE: Record<Channel, number> = {
  in_app: 0,
  email: 0,
  // Meta's utility-template rate for the Gulf, in pence. Verify against the
  // current BSP rate card before modelling unit economics.
  whatsapp: 4,
  sms: 3,
};

export async function deliver(
  organisationId: string,
  alertId: string,
  channel: Channel,
  recipient: Recipient,
  message: AlertMessage,
): Promise<DeliveryOutcome> {
  const outcome = await send(channel, recipient, message);

  await db.insert(alertDeliveries).values({
    organisationId,
    alertId,
    channel,
    recipient: outcome.recipient,
    providerMessageId: outcome.providerMessageId,
    succeeded: outcome.succeeded,
    error: outcome.error,
    costMinorUnits: outcome.succeeded ? COST_PENCE[channel] : 0,
  });

  return outcome;
}

async function send(
  channel: Channel,
  recipient: Recipient,
  message: AlertMessage,
): Promise<DeliveryOutcome> {
  const base: DeliveryOutcome = {
    channel,
    recipient: recipient.email ?? recipient.phone ?? "in-app",
    succeeded: false,
    error: null,
    providerMessageId: null,
    costMinorUnits: COST_PENCE[channel],
  };

  if (channel === "in_app") {
    // The alert row itself is the in-app notification; nothing to transmit.
    return { ...base, recipient: recipient.name, succeeded: true };
  }

  if (channel === "email") {
    if (!recipient.email) return { ...base, error: "No email address on file." };
    if (!features.email) {
      // Not configured: the alert still shows in-app, and this is recorded
      // honestly rather than reported as delivered.
      return { ...base, recipient: recipient.email, error: "Email provider not configured." };
    }
    return sendEmail(recipient, message, base);
  }

  if (channel === "whatsapp") {
    if (!recipient.phone) return { ...base, error: "No phone number on file." };
    if (!features.whatsapp) {
      return { ...base, recipient: recipient.phone, error: "WhatsApp provider not configured." };
    }
    return sendWhatsApp(recipient, message, base);
  }

  return { ...base, error: "SMS is not enabled for this deployment." };
}

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------

async function sendEmail(
  recipient: Recipient,
  message: AlertMessage,
  base: DeliveryOutcome,
): Promise<DeliveryOutcome> {
  const subject = expirySubject(message, recipient.locale);
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.resendApiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: env.emailFrom,
        to: [recipient.email],
        subject,
        html: expiryEmailHtml(recipient, message),
        text: expiryEmailText(recipient, message),
      }),
    });

    if (!response.ok) {
      return { ...base, recipient: recipient.email!, error: `Mail provider returned ${response.status}` };
    }
    const payload = (await response.json()) as { id?: string };
    return {
      ...base,
      recipient: recipient.email!,
      succeeded: true,
      providerMessageId: payload.id ?? null,
    };
  } catch (error) {
    return {
      ...base,
      recipient: recipient.email!,
      error: error instanceof Error ? error.message : "Mail delivery failed",
    };
  }
}

export function expirySubject(message: AlertMessage, locale: "en" | "ar"): string {
  const { daysRemaining, documentTypeName, holderName } = message;
  if (locale === "ar") {
    return daysRemaining < 0
      ? `منتهية: ${documentTypeName} — ${holderName}`
      : `ينتهي خلال ${daysRemaining} يوماً: ${documentTypeName} — ${holderName}`;
  }
  return daysRemaining < 0
    ? `EXPIRED: ${documentTypeName} — ${holderName}`
    : `Expires in ${daysRemaining} day${daysRemaining === 1 ? "" : "s"}: ${documentTypeName} — ${holderName}`;
}

function expiryEmailText(recipient: Recipient, message: AlertMessage): string {
  return [
    `${recipient.name},`,
    "",
    message.daysRemaining < 0
      ? `${message.documentTypeName} for ${message.holderName} expired on ${message.expiresOn} — ${Math.abs(message.daysRemaining)} days ago.`
      : `${message.documentTypeName} for ${message.holderName} expires on ${message.expiresOn}, in ${message.daysRemaining} days.`,
    "",
    `Entity: ${message.entityName}`,
    "",
    `Open the record: ${message.recordUrl}`,
    `Acknowledge this alert: ${message.acknowledgeUrl}`,
    "",
    "Acknowledging stops the escalation. Until someone does, this alert widens to managers.",
    "",
    "— Sarayan",
  ].join("\n");
}

function expiryEmailHtml(recipient: Recipient, message: AlertMessage): string {
  const overdue = message.daysRemaining < 0;
  const accent = overdue ? "#b91c1c" : message.daysRemaining <= 30 ? "#b45309" : "#0f6b5c";
  const headline = overdue
    ? `Expired ${Math.abs(message.daysRemaining)} days ago`
    : `Expires in ${message.daysRemaining} days`;

  return `<!doctype html><html><body style="margin:0;background:#f6f7f8;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#111827">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:540px;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb">
<tr><td style="height:4px;background:${accent}"></td></tr>
<tr><td style="padding:28px">
<p style="margin:0 0 4px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280">Sarayan</p>
<h1 style="margin:0 0 16px;font-size:20px;color:${accent}">${escapeHtml(headline)}</h1>
<p style="margin:0 0 20px;font-size:15px;line-height:1.6">${escapeHtml(recipient.name)}, the following document needs attention.</p>
<table role="presentation" width="100%" style="font-size:14px;border-collapse:collapse">
<tr><td style="padding:8px 0;color:#6b7280;width:35%">Document</td><td style="padding:8px 0;font-weight:600">${escapeHtml(message.documentTypeName)}</td></tr>
<tr><td style="padding:8px 0;color:#6b7280">Holder</td><td style="padding:8px 0;font-weight:600">${escapeHtml(message.holderName)}</td></tr>
<tr><td style="padding:8px 0;color:#6b7280">Entity</td><td style="padding:8px 0">${escapeHtml(message.entityName)}</td></tr>
<tr><td style="padding:8px 0;color:#6b7280">Expiry</td><td style="padding:8px 0;font-weight:600">${escapeHtml(message.expiresOn)}</td></tr>
</table>
<div style="margin:28px 0 8px">
<a href="${escapeHtml(message.acknowledgeUrl)}" style="display:inline-block;background:${accent};color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:600;font-size:14px">Acknowledge</a>
<a href="${escapeHtml(message.recordUrl)}" style="display:inline-block;margin-inline-start:8px;color:#374151;text-decoration:none;padding:11px 16px;font-size:14px">Open record</a>
</div>
<p style="margin:20px 0 0;font-size:13px;color:#6b7280;line-height:1.6">Acknowledging stops the escalation. Until someone does, this alert widens to managers.</p>
</td></tr></table></td></tr></table></body></html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// WhatsApp
// ---------------------------------------------------------------------------

/**
 * WhatsApp via a BSP.
 *
 * Business-initiated messages must use an approved template, so the payload
 * sends template parameters rather than free text. The provider shape here
 * matches 360dialog and Unifonic's Meta-compatible endpoints.
 */
async function sendWhatsApp(
  recipient: Recipient,
  message: AlertMessage,
  base: DeliveryOutcome,
): Promise<DeliveryOutcome> {
  const phone = recipient.phone!.replace(/[^\d]/g, "");
  try {
    const response = await fetch(`${env.whatsapp.baseUrl!.replace(/\/$/, "")}/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "D360-API-KEY": env.whatsapp.apiKey!,
        authorization: `Bearer ${env.whatsapp.apiKey}`,
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: phone,
        type: "template",
        template: {
          name: env.whatsapp.templateName,
          language: { code: recipient.locale === "ar" ? "ar" : "en" },
          components: [
            {
              type: "body",
              parameters: [
                { type: "text", text: message.documentTypeName },
                { type: "text", text: message.holderName },
                { type: "text", text: message.expiresOn },
                {
                  type: "text",
                  text:
                    message.daysRemaining < 0
                      ? `${Math.abs(message.daysRemaining)} days overdue`
                      : `${message.daysRemaining} days`,
                },
              ],
            },
          ],
        },
      }),
    });

    if (!response.ok) {
      return { ...base, recipient: phone, error: `WhatsApp provider returned ${response.status}` };
    }
    const payload = (await response.json()) as { messages?: Array<{ id?: string }> };
    return {
      ...base,
      recipient: phone,
      succeeded: true,
      providerMessageId: payload.messages?.[0]?.id ?? null,
    };
  } catch (error) {
    return {
      ...base,
      recipient: phone,
      error: error instanceof Error ? error.message : "WhatsApp delivery failed",
    };
  }
}

/** Transactional mail that is not an expiry alert (invitations, receipts). */
export async function sendPlainEmail(
  to: string,
  subject: string,
  body: string,
): Promise<boolean> {
  if (!features.email) return false;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${env.resendApiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ from: env.emailFrom, to: [to], subject, text: body }),
  }).catch(() => null);
  return Boolean(response?.ok);
}
