/**
 * Bulk CSV import.
 *
 * Every prospect arrives with a spreadsheet, and importing it is the demo that
 * closes them. A firm with 400 entities will not hand-key them, so this has to
 * cope with the actual state of those files: headers that say "Licence No."
 * or "رقم الرخصة", dates in three formats in the same column, trailing blank
 * rows, a BOM from Excel, and the same client appearing twice.
 *
 * The design rule is that the import never guesses about a date. A cell it
 * cannot parse unambiguously becomes a row-level error the user fixes, not a
 * best guess written to the database — the same reasoning as the extraction
 * confidence threshold.
 */
import { parseLooseDate, type PlainDate } from '../dates.js';
import {
  ENTITY_STATUSES,
  ENTITY_TYPES,
  JURISDICTIONS,
  type EntityStatus,
  type EntityType,
  type Jurisdiction,
} from '../types.js';

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * RFC 4180 parser. Written out rather than pulled in because the edge cases
 * that matter here are few and specific — quoted fields containing commas and
 * newlines, doubled quotes, CRLF, and the UTF-8 BOM Excel writes.
 */
export function parseCsv(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let index = 0;

  const pushField = (): void => {
    row.push(field);
    field = '';
  };
  const pushRow = (): void => {
    row.push(field);
    field = '';
    rows.push(row);
    row = [];
  };

  while (index < text.length) {
    const char = text[index]!;

    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        inQuotes = false;
        index += 1;
        continue;
      }
      field += char;
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      index += 1;
      continue;
    }
    if (char === ',') {
      pushField();
      index += 1;
      continue;
    }
    if (char === '\r') {
      if (text[index + 1] === '\n') index += 1;
      pushRow();
      index += 1;
      continue;
    }
    if (char === '\n') {
      pushRow();
      index += 1;
      continue;
    }

    field += char;
    index += 1;
  }

  if (field !== '' || row.length > 0) pushRow();

  // Excel loves a trailing blank line, and so do exports from Google Sheets.
  return rows.filter((candidate) => candidate.some((cell) => cell.trim() !== ''));
}

// ---------------------------------------------------------------------------
// Column mapping
// ---------------------------------------------------------------------------

export const IMPORT_FIELDS = [
  'legalName',
  'tradeName',
  'jurisdiction',
  'freeZone',
  'entityType',
  'incorporationDate',
  'status',
  'primaryContactName',
  'primaryContactEmail',
  'primaryContactPhone',
  'licenceNumber',
  'licenceType',
  'licenceIssuingAuthority',
  'licenceIssuedOn',
  'licenceExpiresOn',
  'establishmentCardNumber',
  'establishmentCardExpiresOn',
  'notes',
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

export const REQUIRED_IMPORT_FIELDS = ['legalName'] as const satisfies readonly ImportField[];

/**
 * Header aliases seen in real free-zone and firm-maintained spreadsheets,
 * including the Arabic headers that come out of a bilingual template. Matching
 * is done on a normalised form, so "Licence No." and "license_no" both land.
 */
const HEADER_ALIASES: Record<ImportField, readonly string[]> = {
  legalName: ['legal name', 'company name', 'entity name', 'client name', 'name', 'company', 'اسم الشركة', 'الاسم القانوني'],
  tradeName: ['trade name', 'trading name', 'brand name', 'dba', 'الاسم التجاري'],
  jurisdiction: ['jurisdiction', 'emirate', 'country', 'location', 'الإمارة', 'الدولة'],
  freeZone: ['free zone', 'freezone', 'zone', 'authority', 'registered authority', 'المنطقة الحرة'],
  entityType: ['entity type', 'company type', 'legal form', 'type', 'نوع الشركة'],
  incorporationDate: ['incorporation date', 'date of incorporation', 'established', 'establishment date', 'registered on', 'تاريخ التأسيس'],
  status: ['status', 'client status', 'entity status', 'الحالة'],
  primaryContactName: ['contact name', 'primary contact', 'contact person', 'client contact', 'اسم جهة الاتصال'],
  primaryContactEmail: ['email', 'contact email', 'e-mail', 'client email', 'البريد الإلكتروني'],
  primaryContactPhone: ['phone', 'mobile', 'contact number', 'contact phone', 'whatsapp', 'رقم الهاتف', 'الجوال'],
  licenceNumber: ['licence number', 'license number', 'licence no', 'license no', 'trade licence number', 'trade license no', 'cr number', 'commercial registration', 'رقم الرخصة', 'السجل التجاري'],
  licenceType: ['licence type', 'license type', 'activity type', 'نوع الرخصة'],
  licenceIssuingAuthority: ['issuing authority', 'licensing authority', 'issued by', 'authority name', 'جهة الإصدار'],
  licenceIssuedOn: ['licence issue date', 'license issue date', 'issue date', 'issued on', 'تاريخ الإصدار'],
  licenceExpiresOn: ['licence expiry', 'license expiry', 'licence expiry date', 'license expiry date', 'expiry date', 'expires on', 'expiry', 'valid until', 'تاريخ الانتهاء', 'تاريخ انتهاء الرخصة'],
  establishmentCardNumber: ['establishment card number', 'establishment card no', 'immigration card number', 'رقم بطاقة المنشأة'],
  establishmentCardExpiresOn: ['establishment card expiry', 'immigration card expiry', 'establishment card expiry date', 'انتهاء بطاقة المنشأة'],
  notes: ['notes', 'remarks', 'comments', 'ملاحظات'],
};

export function normaliseHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/[._/\\]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s-]+/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export type ColumnMapping = Partial<Record<ImportField, number>>;

export interface HeaderAnalysis {
  readonly mapping: ColumnMapping;
  /** Headers we could not place, shown so the user can map them by hand. */
  readonly unmapped: readonly string[];
  readonly missingRequired: readonly ImportField[];
}

/**
 * Best-effort automatic mapping. The UI always shows the result for
 * confirmation before anything is imported — the same principle as extraction:
 * assistive, never authoritative.
 */
export function analyseHeaders(headers: readonly string[]): HeaderAnalysis {
  const mapping: ColumnMapping = {};
  const taken = new Set<number>();
  const normalised = headers.map(normaliseHeader);

  // Exact alias matches first, so "expiry date" does not get stolen by a
  // partial match against "licence expiry date" in a neighbouring column.
  for (const field of IMPORT_FIELDS) {
    const aliases = HEADER_ALIASES[field];
    const index = normalised.findIndex(
      (header, i) => !taken.has(i) && aliases.includes(header),
    );
    if (index !== -1) {
      mapping[field] = index;
      taken.add(index);
    }
  }

  for (const field of IMPORT_FIELDS) {
    if (mapping[field] !== undefined) continue;
    const aliases = HEADER_ALIASES[field];
    const index = normalised.findIndex(
      (header, i) =>
        !taken.has(i) &&
        header !== '' &&
        aliases.some((alias) => header.includes(alias) || alias.includes(header)),
    );
    if (index !== -1) {
      mapping[field] = index;
      taken.add(index);
    }
  }

  const unmapped = headers.filter((_, index) => !taken.has(index) && headers[index]!.trim() !== '');
  const missingRequired = REQUIRED_IMPORT_FIELDS.filter((field) => mapping[field] === undefined);

  return { mapping, unmapped, missingRequired };
}

// ---------------------------------------------------------------------------
// Row validation
// ---------------------------------------------------------------------------

export interface ImportedEntityRow {
  readonly rowNumber: number;
  readonly legalName: string;
  readonly tradeName: string | null;
  readonly jurisdiction: Jurisdiction;
  readonly freeZone: string | null;
  readonly entityType: EntityType;
  readonly incorporationDate: PlainDate | null;
  readonly status: EntityStatus;
  readonly primaryContactName: string | null;
  readonly primaryContactEmail: string | null;
  readonly primaryContactPhone: string | null;
  readonly licence: {
    readonly number: string;
    readonly licenceType: string | null;
    readonly issuingAuthority: string | null;
    readonly issuedOn: PlainDate | null;
    readonly expiresOn: PlainDate;
  } | null;
  readonly establishmentCard: {
    readonly number: string;
    readonly expiresOn: PlainDate;
  } | null;
  readonly notes: string | null;
}

export interface RowIssue {
  readonly rowNumber: number;
  readonly field: ImportField | null;
  readonly message: string;
  readonly severity: 'error' | 'warning';
  readonly rawValue: string | null;
}

export interface ImportPreview {
  readonly rows: readonly ImportedEntityRow[];
  readonly issues: readonly RowIssue[];
  readonly totalDataRows: number;
  readonly analysis: HeaderAnalysis;
}

const JURISDICTION_ALIASES: Record<string, Jurisdiction> = {
  dubai: 'AE-DU', dxb: 'AE-DU', 'ae du': 'AE-DU', 'ae-du': 'AE-DU', 'دبي': 'AE-DU',
  'abu dhabi': 'AE-AZ', abudhabi: 'AE-AZ', auh: 'AE-AZ', 'ae-az': 'AE-AZ', 'أبوظبي': 'AE-AZ',
  sharjah: 'AE-SH', 'ae-sh': 'AE-SH', 'الشارقة': 'AE-SH',
  'ras al khaimah': 'AE-RK', rak: 'AE-RK', 'ae-rk': 'AE-RK',
  ajman: 'AE-AJ', 'ae-aj': 'AE-AJ', 'عجمان': 'AE-AJ',
  fujairah: 'AE-FU', 'ae-fu': 'AE-FU',
  'umm al quwain': 'AE-UQ', uaq: 'AE-UQ', 'ae-uq': 'AE-UQ',
  uae: 'AE-FED', 'united arab emirates': 'AE-FED', 'ae-fed': 'AE-FED', ae: 'AE-FED', 'الإمارات': 'AE-FED',
  'saudi arabia': 'SA', saudi: 'SA', ksa: 'SA', sa: 'SA', 'السعودية': 'SA',
};

const ENTITY_TYPE_ALIASES: Record<string, EntityType> = {
  fzco: 'free_zone_llc', fzc: 'free_zone_llc', 'fz llc': 'free_zone_llc', 'fz-llc': 'free_zone_llc',
  'free zone llc': 'free_zone_llc', 'free zone company': 'free_zone_llc', fze: 'free_zone_llc',
  llc: 'mainland_llc', 'mainland llc': 'mainland_llc', mainland: 'mainland_llc', 'limited liability company': 'mainland_llc',
  branch: 'branch', 'branch office': 'branch',
  'sole establishment': 'sole_establishment', 'sole proprietorship': 'sole_establishment', establishment: 'sole_establishment',
  offshore: 'offshore', ibc: 'offshore',
  foundation: 'foundation',
  'representative office': 'representative_office', 'rep office': 'representative_office',
};

const STATUS_ALIASES: Record<string, EntityStatus> = {
  active: 'active', live: 'active', current: 'active',
  onboarding: 'onboarding', new: 'onboarding', 'in progress': 'onboarding', pending: 'onboarding',
  dormant: 'dormant', inactive: 'dormant', 'on hold': 'dormant', suspended: 'dormant',
  terminated: 'terminated', closed: 'terminated', cancelled: 'terminated', 'struck off': 'terminated',
};

function cell(row: readonly string[], index: number | undefined): string {
  if (index === undefined) return '';
  return (row[index] ?? '').trim();
}

function optional(value: string): string | null {
  return value === '' ? null : value;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Build a preview of what an import would create. Nothing is written until the
 * user has seen this — the row count, the issues, and what each column was
 * taken to mean.
 */
export function buildImportPreview(csv: string): ImportPreview {
  const table = parseCsv(csv);
  if (table.length === 0) {
    return {
      rows: [],
      issues: [],
      totalDataRows: 0,
      analysis: { mapping: {}, unmapped: [], missingRequired: [...REQUIRED_IMPORT_FIELDS] },
    };
  }

  const headers = table[0]!;
  const analysis = analyseHeaders(headers);
  const rows: ImportedEntityRow[] = [];
  const issues: RowIssue[] = [];
  const seenNames = new Map<string, number>();

  if (analysis.missingRequired.length > 0) {
    for (const field of analysis.missingRequired) {
      issues.push({
        rowNumber: 1,
        field,
        severity: 'error',
        rawValue: null,
        message: `No column could be matched to the required field "${field}"`,
      });
    }
    return { rows, issues, totalDataRows: table.length - 1, analysis };
  }

  for (let i = 1; i < table.length; i += 1) {
    const raw = table[i]!;
    const rowNumber = i + 1; // 1-based, and row 1 is the header
    const mapping = analysis.mapping;

    const legalName = cell(raw, mapping.legalName);
    if (legalName === '') {
      issues.push({
        rowNumber,
        field: 'legalName',
        severity: 'error',
        rawValue: null,
        message: 'Legal name is required',
      });
      continue;
    }

    const dedupeKey = legalName.toLowerCase();
    const firstSeen = seenNames.get(dedupeKey);
    if (firstSeen !== undefined) {
      issues.push({
        rowNumber,
        field: 'legalName',
        severity: 'warning',
        rawValue: legalName,
        message: `Duplicate of row ${firstSeen} ("${legalName}") — it will be imported as a separate entity unless you remove it`,
      });
    } else {
      seenNames.set(dedupeKey, rowNumber);
    }

    const jurisdictionRaw = cell(raw, mapping.jurisdiction);
    const jurisdiction = resolveJurisdiction(jurisdictionRaw);
    if (jurisdictionRaw !== '' && jurisdiction === null) {
      issues.push({
        rowNumber,
        field: 'jurisdiction',
        severity: 'warning',
        rawValue: jurisdictionRaw,
        message: `Jurisdiction "${jurisdictionRaw}" was not recognised and has been set to Other`,
      });
    }

    const entityTypeRaw = cell(raw, mapping.entityType);
    const entityType = resolveEntityType(entityTypeRaw);

    const statusRaw = cell(raw, mapping.status);
    const status = resolveStatus(statusRaw);

    const emailRaw = cell(raw, mapping.primaryContactEmail);
    if (emailRaw !== '' && !EMAIL.test(emailRaw)) {
      issues.push({
        rowNumber,
        field: 'primaryContactEmail',
        severity: 'warning',
        rawValue: emailRaw,
        message: `"${emailRaw}" does not look like an email address — reminders to this contact will not send`,
      });
    }

    const incorporationDate = parseDateCell(
      raw,
      mapping.incorporationDate,
      'incorporationDate',
      rowNumber,
      issues,
    );
    const licenceIssuedOn = parseDateCell(
      raw,
      mapping.licenceIssuedOn,
      'licenceIssuedOn',
      rowNumber,
      issues,
    );
    const licenceExpiresOn = parseDateCell(
      raw,
      mapping.licenceExpiresOn,
      'licenceExpiresOn',
      rowNumber,
      issues,
    );
    const cardExpiresOn = parseDateCell(
      raw,
      mapping.establishmentCardExpiresOn,
      'establishmentCardExpiresOn',
      rowNumber,
      issues,
    );

    const licenceNumber = cell(raw, mapping.licenceNumber);
    if (licenceNumber !== '' && licenceExpiresOn === null) {
      issues.push({
        rowNumber,
        field: 'licenceExpiresOn',
        severity: 'warning',
        rawValue: cell(raw, mapping.licenceExpiresOn) || null,
        message:
          'A licence number was given with no usable expiry date, so no renewal will be ' +
          'created for it. Add the expiry date to put it on the dashboard.',
      });
    }

    const cardNumber = cell(raw, mapping.establishmentCardNumber);

    rows.push({
      rowNumber,
      legalName,
      tradeName: optional(cell(raw, mapping.tradeName)),
      jurisdiction: jurisdiction ?? 'OTHER',
      freeZone: optional(cell(raw, mapping.freeZone)),
      entityType,
      incorporationDate,
      status,
      primaryContactName: optional(cell(raw, mapping.primaryContactName)),
      primaryContactEmail: optional(emailRaw),
      primaryContactPhone: optional(normalisePhone(cell(raw, mapping.primaryContactPhone))),
      licence:
        licenceNumber !== '' && licenceExpiresOn !== null
          ? {
              number: licenceNumber,
              licenceType: optional(cell(raw, mapping.licenceType)),
              issuingAuthority: optional(cell(raw, mapping.licenceIssuingAuthority)),
              issuedOn: licenceIssuedOn,
              expiresOn: licenceExpiresOn,
            }
          : null,
      establishmentCard:
        cardNumber !== '' && cardExpiresOn !== null
          ? { number: cardNumber, expiresOn: cardExpiresOn }
          : null,
      notes: optional(cell(raw, mapping.notes)),
    });
  }

  return { rows, issues, totalDataRows: table.length - 1, analysis };
}

function parseDateCell(
  raw: readonly string[],
  index: number | undefined,
  field: ImportField,
  rowNumber: number,
  issues: RowIssue[],
): PlainDate | null {
  const value = cell(raw, index);
  if (value === '') return null;

  const parsed = parseLooseDate(value);
  if (parsed === null) {
    issues.push({
      rowNumber,
      field,
      severity: 'warning',
      rawValue: value,
      message:
        `Could not read "${value}" as a date. Use YYYY-MM-DD or DD/MM/YYYY. ` +
        `Nothing has been guessed — the field has been left empty.`,
    });
    return null;
  }
  return parsed;
}

export function resolveJurisdiction(value: string): Jurisdiction | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const upper = trimmed.toUpperCase();
  if ((JURISDICTIONS as readonly string[]).includes(upper)) return upper as Jurisdiction;
  return JURISDICTION_ALIASES[normaliseHeader(trimmed)] ?? null;
}

export function resolveEntityType(value: string): EntityType {
  const trimmed = value.trim();
  if (trimmed === '') return 'other';
  const snake = trimmed.toLowerCase().replace(/\s+/g, '_');
  if ((ENTITY_TYPES as readonly string[]).includes(snake)) return snake as EntityType;
  return ENTITY_TYPE_ALIASES[normaliseHeader(trimmed)] ?? 'other';
}

export function resolveStatus(value: string): EntityStatus {
  const trimmed = value.trim();
  if (trimmed === '') return 'active';
  const lower = trimmed.toLowerCase();
  if ((ENTITY_STATUSES as readonly string[]).includes(lower)) return lower as EntityStatus;
  return STATUS_ALIASES[normaliseHeader(trimmed)] ?? 'active';
}

/**
 * Strip the formatting that Gulf phone numbers arrive in. Kept permissive —
 * this feeds a WhatsApp send, and a number that does not resolve is reported at
 * send time against the entity rather than dropped silently at import.
 */
export function normalisePhone(value: string): string {
  const cleaned = value.replace(/[\s()\-.]/g, '');
  if (cleaned === '') return '';
  if (cleaned.startsWith('00')) return `+${cleaned.slice(2)}`;
  return cleaned;
}

/** A blank template with the headers this importer understands. */
export function importTemplateCsv(): string {
  const headers = [
    'Legal Name', 'Trade Name', 'Jurisdiction', 'Free Zone', 'Entity Type',
    'Incorporation Date', 'Status', 'Contact Name', 'Contact Email', 'Contact Phone',
    'Licence Number', 'Licence Type', 'Issuing Authority', 'Licence Issue Date',
    'Licence Expiry Date', 'Establishment Card Number', 'Establishment Card Expiry', 'Notes',
  ];
  const example = [
    'Example Trading FZ-LLC', 'Example Trading', 'Dubai', 'IFZA', 'FZCO',
    '2021-03-14', 'Active', 'Layla Haddad', 'layla@example.com', '+971 50 123 4567',
    'DL-123456', 'Commercial', 'IFZA', '2024-03-15', '2026-03-14', 'EC-998877',
    '2026-03-14', 'Migrated from spreadsheet',
  ];
  return `${headers.join(',')}\n${example.map(quoteCsv).join(',')}\n`;
}

function quoteCsv(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
