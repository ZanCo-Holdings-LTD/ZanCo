/**
 * WhatsApp Business template definitions and the rules Meta enforces on them.
 *
 * The brief is right that these constraints have to be designed around from the
 * start rather than discovered at launch. A reminder is a business-initiated
 * message outside any customer service window, so it *must* go out as a
 * pre-approved template — there is no free-form fallback. The rules encoded in
 * `validateTemplate` and `validateParameters` are the ones that cause a send to
 * be rejected at the API rather than at review time, which is the failure mode
 * that matters: a rejected send is a reminder that did not happen.
 *
 * The templates below are the submission set. `docs/whatsapp-templates.md`
 * carries the same text in the shape Meta's Business Manager wants it pasted.
 */
import type { Locale } from '../types.js';

export const WHATSAPP_CATEGORIES = ['UTILITY', 'MARKETING', 'AUTHENTICATION'] as const;
export type WhatsAppCategory = (typeof WHATSAPP_CATEGORIES)[number];

export interface WhatsAppTemplate {
  /** Meta template name. Lowercase, digits and underscores only. */
  readonly name: string;
  readonly language: Locale;
  readonly category: WhatsAppCategory;
  /** Body text with numbered placeholders, `{{1}}` upwards. */
  readonly body: string;
  /** What each placeholder is, in order. Documentation for the send site. */
  readonly parameters: readonly string[];
  readonly footer?: string;
}

const TEMPLATE_NAME = /^[a-z0-9_]{1,512}$/;
const PLACEHOLDER = /\{\{(\d+)\}\}/g;

export class WhatsAppTemplateError extends Error {
  readonly issues: readonly string[];
  constructor(issues: readonly string[]) {
    super(`Invalid WhatsApp template: ${issues.join('; ')}`);
    this.name = 'WhatsAppTemplateError';
    this.issues = issues;
  }
}

/**
 * Structural checks that mirror Meta's template requirements.
 *
 * Run in CI over the whole template set, so a template that would be rejected
 * on submission fails the build instead of failing silently in production.
 */
export function validateTemplate(template: WhatsAppTemplate): readonly string[] {
  const issues: string[] = [];

  if (!TEMPLATE_NAME.test(template.name)) {
    issues.push(
      `name "${template.name}" must be lowercase letters, digits and underscores only`,
    );
  }

  const body = template.body;
  if (body.trim() === '') issues.push('body must not be empty');
  if (body.length > 1024) issues.push(`body is ${body.length} characters, limit is 1024`);

  const indices: number[] = [];
  for (const match of body.matchAll(PLACEHOLDER)) {
    indices.push(Number(match[1]));
  }

  // Placeholders must be 1..n with no gaps and no repeats.
  const expected = Array.from({ length: template.parameters.length }, (_, i) => i + 1);
  if (indices.length !== expected.length || indices.some((value, i) => value !== expected[i])) {
    issues.push(
      `placeholders ${JSON.stringify(indices)} must be sequential from 1 and match the ` +
        `${template.parameters.length} declared parameter(s)`,
    );
  }

  // A placeholder may not open or close the body, and two may not be adjacent.
  const trimmed = body.trim();
  if (/^\{\{\d+\}\}/.test(trimmed)) issues.push('body must not start with a placeholder');
  if (/\{\{\d+\}\}$/.test(trimmed)) issues.push('body must not end with a placeholder');
  if (/\{\{\d+\}\}\s*\{\{\d+\}\}/.test(body)) {
    issues.push('two placeholders must not be adjacent — put literal text between them');
  }

  if (template.footer !== undefined && template.footer.length > 60) {
    issues.push(`footer is ${template.footer.length} characters, limit is 60`);
  }

  return issues;
}

/**
 * Meta rejects parameter *values* containing newlines, tabs or runs of four or
 * more spaces. A legal name pasted out of a spreadsheet with a stray tab is
 * enough to fail a send, so values are checked and normalised before they go.
 */
export function validateParameters(values: readonly string[]): readonly string[] {
  const issues: string[] = [];
  values.forEach((value, index) => {
    if (value === '') issues.push(`parameter ${index + 1} must not be empty`);
    if (/[\n\r\t]/.test(value)) {
      issues.push(`parameter ${index + 1} must not contain newlines or tabs`);
    }
    if (/ {4,}/.test(value)) {
      issues.push(`parameter ${index + 1} must not contain four or more consecutive spaces`);
    }
    if (value.length > 1024) {
      issues.push(`parameter ${index + 1} is ${value.length} characters, limit is 1024`);
    }
  });
  return issues;
}

/** Collapse whitespace so a value that would be rejected becomes sendable. */
export function normaliseParameter(value: string): string {
  return value.replace(/[\n\r\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

export function renderTemplateBody(
  template: WhatsAppTemplate,
  values: readonly string[],
): string {
  return template.body.replace(PLACEHOLDER, (_match, index: string) => {
    const value = values[Number(index) - 1];
    return value ?? '';
  });
}

/**
 * The order every template takes its parameters in.
 *
 * Meta numbers placeholders by order of appearance, so `{{1}}` means whatever
 * comes first in that body — which would ordinarily make each template's
 * argument list different and the send site a per-template lookup. Instead every
 * body here is written to use the same five values in the same order, so the
 * worker builds one array and it is correct for any template. A test asserts
 * this holds, because the failure mode if it drifts is a client being sent the
 * firm's name where the expiry date should be.
 */
export const WHATSAPP_PARAMETER_ORDER = [
  'contact name',
  'firm name',
  'document description',
  'entity name',
  'date',
] as const;

/**
 * The submission set. Every `templateKey` used by a WhatsApp rung of a renewal
 * ladder must exist here in both languages — enforced by a test, because a
 * ladder referencing a template that was never submitted is a reminder that
 * silently never sends.
 */
export const WHATSAPP_TEMPLATES: readonly WhatsAppTemplate[] = [
  {
    name: 'renewal_reminder_30d',
    language: 'en',
    category: 'UTILITY',
    body:
      'Hello {{1}}, a reminder from {{2}}: the {{3}} for {{4}} expires on {{5}}. ' +
      'Please reply here so we can start the renewal in good time.',
    parameters: [...WHATSAPP_PARAMETER_ORDER],
    footer: 'Reply STOP to opt out',
  },
  {
    name: 'renewal_reminder_30d',
    language: 'ar',
    category: 'UTILITY',
    body:
      'مرحباً {{1}}، تذكير من {{2}}: تنتهي صلاحية {{3}} الخاصة بـ {{4}} بتاريخ {{5}}. ' +
      'يرجى الرد هنا لبدء إجراءات التجديد في الوقت المناسب.',
    parameters: [...WHATSAPP_PARAMETER_ORDER],
    footer: 'للإيقاف أرسل STOP',
  },
  {
    name: 'renewal_reminder_14d',
    language: 'en',
    category: 'UTILITY',
    body:
      'Hello {{1}}, {{2}} needs your confirmation: the {{3}} for {{4}} expires on {{5}}, ' +
      'which is two weeks away. Please reply to confirm we should proceed.',
    parameters: [...WHATSAPP_PARAMETER_ORDER],
    footer: 'Reply STOP to opt out',
  },
  {
    name: 'renewal_reminder_14d',
    language: 'ar',
    category: 'UTILITY',
    body:
      'مرحباً {{1}}، يحتاج {{2}} إلى تأكيدكم: تنتهي صلاحية {{3}} الخاصة بـ {{4}} بتاريخ {{5}} ' +
      'أي خلال أسبوعين. يرجى الرد للتأكيد على المتابعة.',
    parameters: [...WHATSAPP_PARAMETER_ORDER],
    footer: 'للإيقاف أرسل STOP',
  },
  {
    name: 'renewal_urgent_daily',
    language: 'en',
    category: 'UTILITY',
    body:
      'Urgent, {{1}}. Please contact {{2}} today: the {{3}} for {{4}} expires on {{5}} ' +
      'and a late renewal risks a penalty.',
    parameters: [...WHATSAPP_PARAMETER_ORDER],
    footer: 'Reply STOP to opt out',
  },
  {
    name: 'renewal_urgent_daily',
    language: 'ar',
    category: 'UTILITY',
    body:
      'عاجل {{1}}. يرجى التواصل مع {{2}} اليوم: تنتهي صلاحية {{3}} الخاصة بـ {{4}} بتاريخ {{5}} ' +
      'وقد يترتب على التأخير غرامة.',
    parameters: [...WHATSAPP_PARAMETER_ORDER],
    footer: 'للإيقاف أرسل STOP',
  },
  {
    name: 'document_request',
    language: 'en',
    category: 'UTILITY',
    body:
      'Hello {{1}}, {{2}} needs a document from you: the {{3}} for {{4}} cannot progress ' +
      'without it. Please reply here with a photo or scan before {{5}}. Thank you.',
    parameters: [...WHATSAPP_PARAMETER_ORDER],
    footer: 'Reply STOP to opt out',
  },
  {
    name: 'document_request',
    language: 'ar',
    category: 'UTILITY',
    body:
      'مرحباً {{1}}، يحتاج {{2}} إلى مستند منكم: لا يمكن استكمال {{3}} الخاصة بـ {{4}} بدونه. ' +
      'يرجى الرد هنا بصورة أو نسخة ممسوحة ضوئياً قبل {{5}}. شكراً لكم.',
    parameters: [...WHATSAPP_PARAMETER_ORDER],
    footer: 'للإيقاف أرسل STOP',
  },
  {
    name: 'renewal_completed',
    language: 'en',
    category: 'UTILITY',
    body:
      'Good news {{1}} — {{2}} has completed the renewal. The {{3}} for {{4}} is now valid ' +
      'until {{5}}. The updated document is in your portal.',
    parameters: [...WHATSAPP_PARAMETER_ORDER],
  },
  {
    name: 'renewal_completed',
    language: 'ar',
    category: 'UTILITY',
    body:
      'خبر سار {{1}} — أتم {{2}} إجراءات التجديد. {{3}} الخاصة بـ {{4}} صالحة الآن حتى {{5}}. ' +
      'المستند المحدث متاح في بوابتكم.',
    parameters: [...WHATSAPP_PARAMETER_ORDER],
  },
];

export function findWhatsAppTemplate(name: string, language: Locale): WhatsAppTemplate | null {
  return (
    WHATSAPP_TEMPLATES.find(
      (template) => template.name === name && template.language === language,
    ) ?? null
  );
}

/** Every distinct template name in the submission set. */
export function whatsAppTemplateNames(): string[] {
  return [...new Set(WHATSAPP_TEMPLATES.map((template) => template.name))].sort();
}
