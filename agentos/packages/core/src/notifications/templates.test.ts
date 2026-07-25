import { describe, expect, it } from 'vitest';
import { LOCALES } from '../types.js';
import { seedRenewalRules } from '../renewals/seed-rules.js';
import {
  DEFAULT_BRANDING,
  EMAIL_TEMPLATES,
  MissingTemplateError,
  findEmailTemplate,
  interpolate,
  missingVariables,
  renderEmail,
} from './templates.js';
import {
  WHATSAPP_PARAMETER_ORDER,
  WHATSAPP_TEMPLATES,
  findWhatsAppTemplate,
  normaliseParameter,
  renderTemplateBody,
  validateParameters,
  validateTemplate,
} from './whatsapp.js';

const VARIABLES = {
  contactName: 'Layla Haddad',
  entityName: 'Example Trading FZ-LLC',
  documentDescription: 'trade licence',
  expiryDate: '14 March 2026',
  daysRemaining: '30',
  assigneeName: 'Omar',
  portalUrl: 'https://portal.example.com/abc',
  digestBody: '3 renewals due',
};

describe('interpolation', () => {
  it('substitutes known variables', () => {
    expect(interpolate('Hello {{contactName}}', VARIABLES)).toBe('Hello Layla Haddad');
  });

  it('leaves an unknown variable visible rather than blanking it', () => {
    // A hole in a message is invisible; a literal {{foo}} is obvious in preview.
    expect(interpolate('Hello {{nope}}', VARIABLES)).toBe('Hello {{nope}}');
    expect(missingVariables('{{nope}} and {{alsoNope}}', VARIABLES)).toEqual(['alsoNope', 'nope']);
  });
});

describe('email templates', () => {
  it('exist in every supported locale', () => {
    for (const template of EMAIL_TEMPLATES) {
      for (const locale of LOCALES) {
        expect(template.subject[locale], `${template.key} subject ${locale}`).toBeTruthy();
        expect(template.body[locale], `${template.key} body ${locale}`).toBeTruthy();
      }
    }
  });

  it('reference no variable the render step cannot supply', () => {
    const available = { ...VARIABLES, firmName: 'Firm' };
    for (const template of EMAIL_TEMPLATES) {
      for (const locale of LOCALES) {
        expect(
          missingVariables(template.body[locale], available),
          `${template.key} ${locale}`,
        ).toEqual([]);
        expect(missingVariables(template.subject[locale], available)).toEqual([]);
      }
    }
  });

  it('render with the firm’s branding', () => {
    const rendered = renderEmail({
      key: 'renewal.client_reminder',
      locale: 'en',
      variables: VARIABLES,
      branding: { ...DEFAULT_BRANDING, firmName: 'Gulf Corporate Services', signature: 'GCS Team' },
    });
    expect(rendered.subject).toContain('Example Trading FZ-LLC');
    expect(rendered.text).toContain('GCS Team');
    expect(rendered.html).toContain('GCS Team');
  });

  it('set dir=rtl on Arabic mail', () => {
    const rendered = renderEmail({
      key: 'renewal.client_reminder',
      locale: 'ar',
      variables: VARIABLES,
    });
    expect(rendered.html).toContain('dir="rtl"');
    expect(rendered.html).toContain('text-align:right');
  });

  it('escape HTML in variable values', () => {
    const rendered = renderEmail({
      key: 'renewal.client_reminder',
      locale: 'en',
      variables: { ...VARIABLES, entityName: '<script>alert(1)</script>' },
    });
    expect(rendered.html).not.toContain('<script>');
    expect(rendered.html).toContain('&lt;script&gt;');
  });

  it('accept a per-firm override', () => {
    const rendered = renderEmail({
      key: 'renewal.client_reminder',
      locale: 'en',
      variables: VARIABLES,
      overrideSubject: 'Custom: {{entityName}}',
      overrideBody: 'Our own wording about {{documentDescription}}.',
    });
    expect(rendered.subject).toBe('Custom: Example Trading FZ-LLC');
    expect(rendered.text).toContain('Our own wording about trade licence.');
  });

  it('throw loudly on an unknown key rather than sending nothing', () => {
    expect(() =>
      renderEmail({ key: 'no.such.template', locale: 'en', variables: VARIABLES }),
    ).toThrow(MissingTemplateError);
  });
});

describe('WhatsApp templates', () => {
  it('all satisfy Meta’s structural rules', () => {
    for (const template of WHATSAPP_TEMPLATES) {
      expect(validateTemplate(template), `${template.name}/${template.language}`).toEqual([]);
    }
  });

  it('exist in both languages', () => {
    const names = new Set(WHATSAPP_TEMPLATES.map((t) => t.name));
    for (const name of names) {
      for (const locale of LOCALES) {
        expect(findWhatsAppTemplate(name, locale), `${name} ${locale}`).not.toBeNull();
      }
    }
  });

  it('are all UTILITY, because a renewal reminder is not marketing', () => {
    for (const template of WHATSAPP_TEMPLATES) {
      expect(template.category).toBe('UTILITY');
    }
  });

  it('take their parameters in one order, so the send site needs no per-template lookup', () => {
    // If this drifts, a client gets sent the firm's name where the expiry date
    // should be, and it will look plausible enough that nobody notices.
    for (const template of WHATSAPP_TEMPLATES) {
      expect(template.parameters, `${template.name}/${template.language}`).toEqual([
        ...WHATSAPP_PARAMETER_ORDER,
      ]);
    }
  });

  it('render with positional parameters', () => {
    const values = [
      'Layla',
      'Gulf Corporate Services',
      'trade licence',
      'Example Trading',
      '14 March 2026',
    ];
    for (const name of ['renewal_reminder_30d', 'renewal_urgent_daily'] as const) {
      const template = findWhatsAppTemplate(name, 'en')!;
      const body = renderTemplateBody(template, values);
      expect(body).toContain('Layla');
      expect(body).toContain('Gulf Corporate Services');
      expect(body).toContain('14 March 2026');
      expect(body).not.toContain('{{');
    }
  });

  it('reject parameter values Meta would reject', () => {
    expect(validateParameters(['fine'])).toEqual([]);
    expect(validateParameters(['has\nnewline']).join(' ')).toContain('newlines');
    expect(validateParameters(['has\ttab']).join(' ')).toContain('newlines');
    expect(validateParameters(['four    spaces']).join(' ')).toContain('consecutive spaces');
    expect(validateParameters(['']).join(' ')).toContain('must not be empty');
  });

  it('normalise a value pasted out of a spreadsheet into a sendable one', () => {
    const value = normaliseParameter('Example  Trading\tFZ-LLC\n');
    expect(validateParameters([value])).toEqual([]);
    expect(value).toBe('Example Trading FZ-LLC');
  });

  it('catch a malformed template', () => {
    expect(
      validateTemplate({
        name: 'Bad Name',
        language: 'en',
        category: 'UTILITY',
        body: '{{1}}{{2}}',
        parameters: ['a', 'b'],
      }).length,
    ).toBeGreaterThan(0);
  });
});

describe('the ladders and the templates agree', () => {
  const rules = seedRenewalRules();

  it('every rung resolves to a template that exists', () => {
    for (const rule of rules) {
      for (const step of rule.escalationSchedule) {
        if (step.channel === 'whatsapp') {
          for (const locale of LOCALES) {
            expect(
              findWhatsAppTemplate(step.templateKey, locale),
              `${rule.id} rung "${step.templateKey}" (${locale})`,
            ).not.toBeNull();
          }
        } else {
          expect(findEmailTemplate(step.templateKey), `${rule.id} rung "${step.templateKey}"`)
            .not.toBeNull();
        }
      }
    }
  });
});
