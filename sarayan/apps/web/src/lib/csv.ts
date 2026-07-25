/**
 * CSV import and export.
 *
 * Hand-rolled because the import path is the product's onboarding: every design
 * partner arrives with a spreadsheet, and the parser has to survive Excel's
 * BOM, CRLF line endings, quoted commas and Arabic column headers without
 * throwing. A library that rejects a malformed row loses the customer; this
 * one collects the problem and imports the rest.
 */

export function parseCsv(input: string): string[][] {
  const text = input.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((entry) => entry.some((cell) => cell.trim() !== ""));
}

export function toCsv(rows: Array<Array<string | number | null | undefined>>): string {
  const escape = (value: string | number | null | undefined): string => {
    if (value === null || value === undefined) return "";
    const text = String(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  // BOM so Excel opens UTF-8 Arabic correctly instead of rendering mojibake.
  return `\uFEFF${rows.map((row) => row.map(escape).join(",")).join("\r\n")}\r\n`;
}

/**
 * Match a spreadsheet header to a known field.
 *
 * Real customer spreadsheets say "Emp Name", "الاسم", "Expiry", "Exp. Date",
 * "Valid Until". Matching is fuzzy on purpose — a header we fail to map becomes
 * a column the user has to remap by hand, and that is where imports get
 * abandoned.
 */
const HEADER_SYNONYMS: Record<string, string[]> = {
  holderName: ["holder", "name", "employee", "employee name", "staff", "staff name", "person", "الاسم", "اسم الموظف", "emp name", "full name"],
  holderKind: ["type", "holder type", "kind", "category"],
  documentType: ["document", "document type", "doc type", "type of document", "نوع الوثيقة", "doc"],
  documentNumber: ["number", "document number", "doc number", "id", "id number", "reference", "رقم الوثيقة", "no", "no."],
  issuedOn: ["issue", "issue date", "issued", "issued on", "date of issue", "تاريخ الإصدار", "from"],
  expiresOn: ["expiry", "expiry date", "expires", "expires on", "expiration", "valid until", "valid till", "تاريخ الانتهاء", "exp", "exp date", "end date", "to"],
  issuingAuthority: ["authority", "issuing authority", "issued by", "الجهة المصدرة"],
  entity: ["entity", "company", "legal entity", "branch", "المنشأة", "الشركة"],
  nationality: ["nationality", "الجنسية"],
  department: ["department", "dept", "القسم"],
  email: ["email", "e-mail", "البريد"],
  phone: ["phone", "mobile", "contact", "الجوال", "الهاتف"],
  identifier: ["plate", "plate number", "vehicle", "serial", "asset", "رقم اللوحة"],
  notes: ["notes", "note", "remarks", "comment", "ملاحظات"],
};

export function mapHeaders(headers: string[]): Record<number, string> {
  const mapping: Record<number, string> = {};
  headers.forEach((header, index) => {
    const normalised = header.trim().toLowerCase().replace(/[_\-.]+/g, " ").replace(/\s+/g, " ");
    if (!normalised) return;
    for (const [field, synonyms] of Object.entries(HEADER_SYNONYMS)) {
      if (synonyms.includes(normalised)) {
        mapping[index] = field;
        return;
      }
    }
    for (const [field, synonyms] of Object.entries(HEADER_SYNONYMS)) {
      if (synonyms.some((synonym) => normalised.includes(synonym) && synonym.length > 3)) {
        mapping[index] = field;
        return;
      }
    }
  });
  return mapping;
}

/**
 * Parse a date from a spreadsheet.
 *
 * Gulf spreadsheets are overwhelmingly DD/MM/YYYY, and the cost of guessing
 * wrong is a wrong expiry date — the exact failure the product exists to
 * prevent. So: ISO is trusted, unambiguous day-first values are accepted, and
 * anything genuinely ambiguous (03/04/2026) is resolved day-first and flagged
 * to the user rather than silently chosen.
 */
export interface ParsedDate {
  value: string | null;
  ambiguous: boolean;
  error: string | null;
}

export function parseSpreadsheetDate(input: string): ParsedDate {
  const text = input.trim();
  if (!text) return { value: null, ambiguous: false, error: null };

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return { value: text, ambiguous: false, error: validCalendarDate(text) };
  }

  const slash = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2}|\d{4})$/.exec(text);
  if (slash) {
    const first = Number(slash[1]);
    const second = Number(slash[2]);
    const year = normaliseYear(Number(slash[3]));

    // Only one reading is possible when a component exceeds 12.
    if (first > 12 && second <= 12) {
      const iso = format(year, second, first);
      return { value: iso, ambiguous: false, error: validCalendarDate(iso) };
    }
    if (second > 12 && first <= 12) {
      const iso = format(year, first, second);
      return { value: iso, ambiguous: false, error: validCalendarDate(iso) };
    }
    const iso = format(year, second, first); // day-first
    return { value: iso, ambiguous: true, error: validCalendarDate(iso) };
  }

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    return { value: parsed.toISOString().slice(0, 10), ambiguous: true, error: null };
  }

  return { value: null, ambiguous: false, error: `Could not read "${input}" as a date.` };
}

function normaliseYear(year: number): number {
  if (year >= 1000) return year;
  // A two-digit year on an expiry date is far more likely 2027 than 1927.
  return year <= 70 ? 2000 + year : 1900 + year;
}

function format(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function validCalendarDate(iso: string): string | null {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const valid =
    date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
  return valid ? null : `"${iso}" is not a real date.`;
}
