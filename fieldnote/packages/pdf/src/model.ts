/**
 * The view model handed to a report template.
 *
 * Deliberately flat and already-formatted: a Handlebars template should never
 * have to reason about confidence thresholds, null handling or date formats.
 * Every decision about what a client sees is made here, in typed code that can
 * be tested, rather than inside a template.
 */

export interface BrandingModel {
  companyName: string;
  logoDataUri: string | null;
  letterheadDataUri: string | null;
  signatureDataUri: string | null;
  surveyorName: string;
  professionalBody: string | null;
}

export interface PhotoModel {
  dataUri: string;
  caption: string | null;
  /** Position in the recording, formatted as m:ss. Aids cross-referencing. */
  timestamp: string | null;
}

export interface FieldModel {
  label: string;
  /** Already formatted for display: booleans as Yes/No, arrays joined, etc. */
  value: string;
  /** Long prose renders as a paragraph block; short values render inline. */
  isProse: boolean;
  /** Empty required fields are still shown, so an omission is visible. */
  isEmpty: boolean;
}

export interface SectionModel {
  title: string;
  fields: FieldModel[];
  photos: PhotoModel[];
}

export interface ReportModel {
  branding: BrandingModel;
  propertyAddress: string;
  clientName: string | null;
  reference: string | null;
  inspectedAt: string | null;
  renderedAt: string;
  versionLabel: string;
  sections: SectionModel[];
  /**
   * The professional-responsibility statement. Present on every rendered
   * report: the surveyor, not the software, is responsible for the findings.
   */
  disclaimer: string;
}

export const DEFAULT_DISCLAIMER =
  'This report was prepared from notes recorded on site by the named surveyor and ' +
  'reviewed by them before issue. The surveyor remains solely responsible for its ' +
  'contents, including all findings, diagnoses and recommendations. Software was ' +
  'used to assist with transcription and drafting; it does not constitute a survey ' +
  'and no reliance should be placed on it.';

export function formatValue(
  value: unknown,
  type: string,
  enumValues: string[] | null,
): { text: string; isProse: boolean; isEmpty: boolean } {
  if (value === null || value === undefined || value === '') {
    return { text: '—', isProse: false, isEmpty: true };
  }

  switch (type) {
    case 'boolean':
      return { text: value === true ? 'Yes' : 'No', isProse: false, isEmpty: false };
    case 'multi_enum': {
      if (!Array.isArray(value) || value.length === 0) {
        return { text: '—', isProse: false, isEmpty: true };
      }
      // Preserve the template's declared order rather than the model's, so two
      // reports on the same template read the same way.
      const ordered = enumValues
        ? enumValues.filter((option) => value.includes(option))
        : (value as string[]);
      return { text: ordered.join(', '), isProse: false, isEmpty: false };
    }
    case 'number':
      return { text: String(value), isProse: false, isEmpty: false };
    case 'long_text': {
      const text = String(value).trim();
      return { text, isProse: true, isEmpty: text.length === 0 };
    }
    default: {
      const text = String(value).trim();
      return { text, isProse: false, isEmpty: text.length === 0 };
    }
  }
}

export function formatDate(value: Date | string | null): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

export function formatTimestamp(ms: number | null): string | null {
  if (ms === null || ms === undefined) return null;
  const totalSeconds = Math.round(ms / 1000);
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;
}
