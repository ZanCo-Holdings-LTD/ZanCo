/**
 * Email templates and the render step shared by both channels.
 *
 * Email is the genuine fallback, not a token one: if WhatsApp template approval
 * changes under us, or a client has no WhatsApp number, the ladder still runs
 * end to end on email alone. That means every WhatsApp rung has an email
 * counterpart carrying the same information — checked by a test.
 *
 * Firms control branding (name, reply-to, signature, colour) and can override
 * any template body. What they cannot do is remove the variables the renewal
 * refers to, because a reminder that does not say which document expires when
 * is worse than no reminder.
 */
import type { Locale } from '../types.js';
import { isRtl } from '../types.js';

export interface Branding {
  readonly firmName: string;
  readonly replyTo: string | null;
  readonly logoUrl: string | null;
  /** Hex, used for the header rule in the email shell. */
  readonly accentColour: string;
  readonly signature: string | null;
  readonly portalUrl: string | null;
}

export const DEFAULT_BRANDING: Branding = {
  firmName: 'AgentOS',
  replyTo: null,
  logoUrl: null,
  accentColour: '#0f766e',
  signature: null,
  portalUrl: null,
};

/** The variables every renewal-related template can refer to. */
export interface TemplateVariables {
  readonly contactName: string;
  readonly entityName: string;
  readonly documentDescription: string;
  readonly expiryDate: string;
  readonly firmName: string;
  readonly daysRemaining: string;
  readonly portalUrl: string;
  readonly assigneeName: string;
  readonly [key: string]: string;
}

export interface EmailTemplate {
  readonly key: string;
  readonly subject: Record<Locale, string>;
  readonly body: Record<Locale, string>;
}

const VARIABLE = /\{\{(\w+)\}\}/g;

export class MissingTemplateError extends Error {
  constructor(key: string) {
    super(
      `No email template registered for "${key}". Every escalation rung must ` +
        `resolve to a template — an unresolved rung is a reminder that never sends.`,
    );
    this.name = 'MissingTemplateError';
  }
}

/**
 * Substitute `{{variable}}` placeholders. Unknown variables are left in place
 * rather than blanked, so a broken custom template is obvious in the preview
 * instead of producing a message with a hole in it.
 */
export function interpolate(text: string, variables: Readonly<Record<string, string>>): string {
  return text.replace(VARIABLE, (match, name: string) => variables[name] ?? match);
}

/** Variables referenced by a template body but not supplied. */
export function missingVariables(
  text: string,
  variables: Readonly<Record<string, string>>,
): string[] {
  const missing = new Set<string>();
  for (const match of text.matchAll(VARIABLE)) {
    const name = match[1]!;
    if (!(name in variables)) missing.add(name);
  }
  return [...missing].sort();
}

export const EMAIL_TEMPLATES: readonly EmailTemplate[] = [
  {
    key: 'renewal.opening_notice',
    subject: {
      en: '{{entityName}} — {{documentDescription}} renewal window is open',
      ar: '{{entityName}} — فتح نافذة تجديد {{documentDescription}}',
    },
    body: {
      en: `The renewal window for {{entityName}} has opened.

Document: {{documentDescription}}
Expires: {{expiryDate}} ({{daysRemaining}} days from today)
Assigned to: {{assigneeName}}

Nothing is required from the client yet. This notice exists so the work can be
scheduled rather than discovered.`,
      ar: `تم فتح نافذة التجديد لـ {{entityName}}.

المستند: {{documentDescription}}
تاريخ الانتهاء: {{expiryDate}} (بعد {{daysRemaining}} يوماً من اليوم)
المسؤول: {{assigneeName}}

لا يلزم أي إجراء من العميل حتى الآن. الغرض من هذا الإشعار جدولة العمل مسبقاً.`,
    },
  },
  {
    key: 'renewal.client_first_notice',
    subject: {
      en: '{{documentDescription}} for {{entityName}} expires {{expiryDate}}',
      ar: 'تنتهي صلاحية {{documentDescription}} الخاصة بـ {{entityName}} بتاريخ {{expiryDate}}',
    },
    body: {
      en: `Dear {{contactName}},

The {{documentDescription}} for {{entityName}} expires on {{expiryDate}}, which is
{{daysRemaining}} days from today.

We are starting the renewal now so that everything is in place well before the
deadline. We will let you know what we need from you and when.

You can see the current status of all your documents at any time here:
{{portalUrl}}`,
      ar: `عزيزي {{contactName}}،

تنتهي صلاحية {{documentDescription}} الخاصة بـ {{entityName}} بتاريخ {{expiryDate}}، أي بعد
{{daysRemaining}} يوماً من اليوم.

سنبدأ إجراءات التجديد الآن لضمان اكتمال كل شيء قبل الموعد النهائي بوقت كافٍ.
وسنخبركم بما نحتاجه منكم وفي أي وقت.

يمكنكم الاطلاع على حالة جميع مستنداتكم في أي وقت عبر الرابط التالي:
{{portalUrl}}`,
    },
  },
  {
    key: 'renewal.client_reminder',
    subject: {
      en: 'Reminder — {{documentDescription}} for {{entityName}} expires in {{daysRemaining}} days',
      ar: 'تذكير — تنتهي صلاحية {{documentDescription}} لـ {{entityName}} خلال {{daysRemaining}} يوماً',
    },
    body: {
      en: `Dear {{contactName}},

A reminder that the {{documentDescription}} for {{entityName}} expires on
{{expiryDate}} — {{daysRemaining}} days from today.

Please confirm you are happy for us to proceed, and send over anything still
outstanding. Renewals filed close to the deadline carry a real risk of penalty.

Status of all your documents: {{portalUrl}}`,
      ar: `عزيزي {{contactName}}،

نذكركم بأن صلاحية {{documentDescription}} الخاصة بـ {{entityName}} تنتهي بتاريخ
{{expiryDate}} أي بعد {{daysRemaining}} يوماً من اليوم.

يرجى تأكيد موافقتكم على المتابعة، وإرسال أي مستندات متبقية. إن التقديم قرب الموعد
النهائي ينطوي على مخاطر حقيقية بفرض غرامات.

حالة جميع مستنداتكم: {{portalUrl}}`,
    },
  },
  {
    key: 'renewal.pro_action_required',
    subject: {
      en: 'Action required — {{entityName}} {{documentDescription}} ({{daysRemaining}} days)',
      ar: 'مطلوب إجراء — {{entityName}} {{documentDescription}} ({{daysRemaining}} يوماً)',
    },
    body: {
      en: `{{documentDescription}} for {{entityName}} expires on {{expiryDate}}, in
{{daysRemaining}} days, and the renewal is not yet complete.

Assigned to: {{assigneeName}}

Open the renewal to record progress or reassign it.`,
      ar: `تنتهي صلاحية {{documentDescription}} الخاصة بـ {{entityName}} بتاريخ {{expiryDate}}، أي بعد
{{daysRemaining}} يوماً، ولم يكتمل التجديد بعد.

المسؤول: {{assigneeName}}

يرجى فتح سجل التجديد لتسجيل التقدم أو إعادة إسناده.`,
    },
  },
  {
    key: 'renewal.escalation_final_week',
    subject: {
      en: 'ESCALATION — {{entityName}} {{documentDescription}} expires {{expiryDate}}',
      ar: 'تصعيد — تنتهي صلاحية {{documentDescription}} لـ {{entityName}} بتاريخ {{expiryDate}}',
    },
    body: {
      en: `This renewal is in its final week and is still open.

Entity: {{entityName}}
Document: {{documentDescription}}
Expires: {{expiryDate}} ({{daysRemaining}} days)
Assigned to: {{assigneeName}}

You are receiving this as account manager because the assigned PRO has not
closed it. Every reminder sent to the client so far is logged against the
renewal.`,
      ar: `هذا التجديد في أسبوعه الأخير ولا يزال مفتوحاً.

المنشأة: {{entityName}}
المستند: {{documentDescription}}
تاريخ الانتهاء: {{expiryDate}} ({{daysRemaining}} يوماً)
المسؤول: {{assigneeName}}

تصلكم هذه الرسالة بصفتكم مدير الحساب لأن المسؤول المكلف لم يغلق هذا التجديد.
جميع التذكيرات المرسلة إلى العميل مسجلة في سجل التجديد.`,
    },
  },
  {
    key: 'renewal.expires_today',
    subject: {
      en: 'EXPIRES TODAY — {{entityName}} {{documentDescription}}',
      ar: 'تنتهي اليوم — {{entityName}} {{documentDescription}}',
    },
    body: {
      en: `The {{documentDescription}} for {{entityName}} expires today, {{expiryDate}}.

Assigned to: {{assigneeName}}

If the renewal has been filed, close it so this stops escalating.`,
      ar: `تنتهي صلاحية {{documentDescription}} الخاصة بـ {{entityName}} اليوم بتاريخ {{expiryDate}}.

المسؤول: {{assigneeName}}

إذا تم تقديم طلب التجديد، يرجى إغلاق السجل لإيقاف التصعيد.`,
    },
  },
  {
    key: 'renewal.overdue',
    subject: {
      en: 'OVERDUE — {{entityName}} {{documentDescription}} expired {{expiryDate}}',
      ar: 'متأخر — انتهت صلاحية {{documentDescription}} لـ {{entityName}} بتاريخ {{expiryDate}}',
    },
    body: {
      en: `The {{documentDescription}} for {{entityName}} expired on {{expiryDate}} and the
renewal is still open.

Assigned to: {{assigneeName}}

A lapsed document usually means a penalty accruing against the client. This
notice repeats until the renewal is closed or cancelled.`,
      ar: `انتهت صلاحية {{documentDescription}} الخاصة بـ {{entityName}} بتاريخ {{expiryDate}} ولا يزال
سجل التجديد مفتوحاً.

المسؤول: {{assigneeName}}

عادةً ما يترتب على انتهاء صلاحية المستند غرامات متراكمة على العميل. سيتكرر هذا
الإشعار حتى يتم إغلاق التجديد أو إلغاؤه.`,
    },
  },
  {
    key: 'renewal.completed',
    subject: {
      en: '{{documentDescription}} for {{entityName}} has been renewed',
      ar: 'تم تجديد {{documentDescription}} الخاصة بـ {{entityName}}',
    },
    body: {
      en: `Dear {{contactName}},

The {{documentDescription}} for {{entityName}} has been renewed and is now valid
until {{expiryDate}}.

The updated document is available in your portal: {{portalUrl}}`,
      ar: `عزيزي {{contactName}}،

تم تجديد {{documentDescription}} الخاصة بـ {{entityName}} وهي الآن صالحة حتى {{expiryDate}}.

المستند المحدث متاح في بوابتكم: {{portalUrl}}`,
    },
  },
  {
    key: 'portal.invitation',
    subject: {
      en: '{{firmName}} — your document and renewal portal',
      ar: '{{firmName}} — بوابة المستندات والتجديدات الخاصة بكم',
    },
    body: {
      en: `Dear {{contactName}},

{{firmName}} has given you access to a portal showing the current status of
{{entityName}} — every licence, card and visa, with its expiry date and where
each renewal has got to.

Open it here: {{portalUrl}}

The link is personal to you. It is read-only; nothing you do there can change
your records.`,
      ar: `عزيزي {{contactName}}،

منحكم {{firmName}} إمكانية الوصول إلى بوابة تعرض الحالة الحالية لـ {{entityName}} —
كل رخصة وبطاقة وتأشيرة مع تاريخ انتهائها وموقف كل تجديد.

يمكنكم فتحها من هنا: {{portalUrl}}

هذا الرابط خاص بكم. البوابة للاطلاع فقط ولا يمكن تعديل أي من سجلاتكم من خلالها.`,
    },
  },
  {
    key: 'digest.weekly',
    subject: {
      en: '{{firmName}} — renewals due in the next 90 days',
      ar: '{{firmName}} — التجديدات المستحقة خلال التسعين يوماً القادمة',
    },
    body: {
      en: `Your renewal position as of today.

{{digestBody}}

Full dashboard: {{portalUrl}}`,
      ar: `موقف التجديدات لديكم حتى اليوم.

{{digestBody}}

لوحة المتابعة الكاملة: {{portalUrl}}`,
    },
  },
];

const EMAIL_BY_KEY = new Map(EMAIL_TEMPLATES.map((template) => [template.key, template]));

export function findEmailTemplate(key: string): EmailTemplate | null {
  return EMAIL_BY_KEY.get(key) ?? null;
}

export function emailTemplateKeys(): string[] {
  return EMAIL_TEMPLATES.map((template) => template.key).sort();
}

export interface RenderedEmail {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

export interface RenderEmailOptions {
  readonly key: string;
  readonly locale: Locale;
  readonly variables: Readonly<Record<string, string>>;
  readonly branding?: Branding;
  /** Per-firm override of the body, already stored against the org. */
  readonly overrideSubject?: string | null;
  readonly overrideBody?: string | null;
}

export function renderEmail(options: RenderEmailOptions): RenderedEmail {
  const branding = options.branding ?? DEFAULT_BRANDING;
  const template = findEmailTemplate(options.key);

  if (template === null && (options.overrideBody ?? null) === null) {
    throw new MissingTemplateError(options.key);
  }

  const variables: Record<string, string> = {
    firmName: branding.firmName,
    portalUrl: branding.portalUrl ?? '',
    ...options.variables,
  };

  const subjectSource =
    options.overrideSubject ?? template?.subject[options.locale] ?? template?.subject.en ?? '';
  const bodySource =
    options.overrideBody ?? template?.body[options.locale] ?? template?.body.en ?? '';

  const subject = interpolate(subjectSource, variables);
  const bodyText = interpolate(bodySource, variables);
  const signature = branding.signature ?? branding.firmName;
  const text = `${bodyText}\n\n—\n${signature}`;

  return {
    subject,
    text,
    html: wrapHtml(bodyText, signature, branding, options.locale),
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Deliberately plain, table-free, inline-styled HTML. It has to survive Outlook
 * and the Gmail Arabic renderer, and it has to read correctly right-to-left,
 * which is why `dir` is set on the root element rather than assumed.
 */
function wrapHtml(body: string, signature: string, branding: Branding, locale: Locale): string {
  const dir = isRtl(locale) ? 'rtl' : 'ltr';
  const align = isRtl(locale) ? 'right' : 'left';
  const paragraphs = body
    .split(/\n{2,}/)
    .map(
      (paragraph) =>
        `<p style="margin:0 0 16px;line-height:1.6;">${escapeHtml(paragraph).replace(/\n/g, '<br />')}</p>`,
    )
    .join('');

  const logo =
    branding.logoUrl === null
      ? ''
      : `<img src="${escapeHtml(branding.logoUrl)}" alt="${escapeHtml(branding.firmName)}" style="max-height:48px;margin-bottom:16px;" />`;

  return [
    `<div dir="${dir}" style="text-align:${align};font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;color:#1f2937;max-width:600px;margin:0 auto;padding:24px;">`,
    logo,
    `<div style="border-top:3px solid ${escapeHtml(branding.accentColour)};padding-top:20px;">`,
    paragraphs,
    `</div>`,
    `<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />`,
    `<p style="margin:0;font-size:13px;color:#6b7280;">${escapeHtml(signature)}</p>`,
    `</div>`,
  ].join('');
}
