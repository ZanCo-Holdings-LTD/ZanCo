/**
 * @sarayan/core-evidence
 *
 * "Prove to a bank, auditor or client that we are compliant, in one document,
 * today" — job to be done #2.
 *
 * The output is a branded PDF plus a SHA-256 over a canonical JSON projection
 * of the same data. The hash covers the *data*, not the rendering, so a pack
 * stays verifiable even if the layout changes in a later release.
 */

import { createHash } from "node:crypto";
import { A4, COLOURS, Page, measure, renderPdf, wrap } from "./pdf";

export * from "./pdf";

export interface EvidenceRecord {
  reference: string;
  documentType: string;
  holder: string;
  holderType: string;
  number: string | null;
  issuingAuthority: string | null;
  issuedOn: string | null;
  expiresOn: string | null;
  status: string;
  daysRemaining: number | null;
  /** SHA-256 of the attached file, when one is held. */
  fileHash?: string | null;
}

export interface EvidencePackInput {
  organisation: string;
  entity: string;
  entityCountry: string;
  /** Set by the caller — never read from the clock, so packs are reproducible. */
  generatedAt: Date;
  generatedBy: string;
  /** Free-text scope note, e.g. "All staff visas and labour cards". */
  scope: string;
  records: EvidenceRecord[];
  /** Absolute URL where a third party can verify the hash. */
  verifyBaseUrl: string;
  locale?: "en" | "ar";
}

export interface EvidencePack {
  pdf: Uint8Array;
  /** SHA-256 over the canonical payload — the number printed on the document. */
  hash: string;
  /** The exact bytes the hash covers, stored so verification is a comparison. */
  canonicalPayload: string;
  summary: EvidenceSummary;
  verifyUrl: string;
}

export interface EvidenceSummary {
  total: number;
  valid: number;
  dueSoon: number;
  critical: number;
  expired: number;
  dormant: number;
}

export function summarise(records: EvidenceRecord[]): EvidenceSummary {
  const summary: EvidenceSummary = {
    total: records.length,
    valid: 0,
    dueSoon: 0,
    critical: 0,
    expired: 0,
    dormant: 0,
  };
  for (const record of records) {
    if (record.status === "valid") summary.valid += 1;
    else if (record.status === "due_soon") summary.dueSoon += 1;
    else if (record.status === "critical") summary.critical += 1;
    else if (record.status === "expired") summary.expired += 1;
    else summary.dormant += 1;
  }
  return summary;
}

/**
 * Canonical JSON: sorted keys, sorted records, no whitespace. Two runs over the
 * same data produce byte-identical output on any machine, which is what makes
 * the hash meaningful.
 */
export function canonicalise(input: EvidencePackInput): string {
  const records = [...input.records]
    .map((record) => ({
      documentType: record.documentType,
      expiresOn: record.expiresOn,
      fileHash: record.fileHash ?? null,
      holder: record.holder,
      holderType: record.holderType,
      issuedOn: record.issuedOn,
      issuingAuthority: record.issuingAuthority,
      number: record.number,
      reference: record.reference,
      status: record.status,
    }))
    .sort((a, b) => (a.reference < b.reference ? -1 : a.reference > b.reference ? 1 : 0));

  return JSON.stringify({
    entity: input.entity,
    entityCountry: input.entityCountry,
    generatedAt: input.generatedAt.toISOString(),
    generatedBy: input.generatedBy,
    organisation: input.organisation,
    records,
    scope: input.scope,
    version: "sarayan-evidence-v1",
  });
}

export function hashPayload(canonical: string): string {
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

const MARGIN = 48;
const CONTENT_WIDTH = A4.width - MARGIN * 2;

export function buildEvidencePack(input: EvidencePackInput): EvidencePack {
  const canonicalPayload = canonicalise(input);
  const hash = hashPayload(canonicalPayload);
  const summary = summarise(input.records);
  const verifyUrl = `${input.verifyBaseUrl.replace(/\/$/, "")}/verify/${hash}`;

  const pages: Page[] = [];
  let page = new Page();
  pages.push(page);

  let y = drawHeader(page, input, hash);
  y = drawSummary(page, y, summary, input);

  // Column layout for the register table.
  const columns = [
    { key: "holder" as const, label: "Holder", width: 118 },
    { key: "documentType" as const, label: "Document", width: 118 },
    { key: "number" as const, label: "Number", width: 82 },
    { key: "issuedOn" as const, label: "Issued", width: 56 },
    { key: "expiresOn" as const, label: "Expires", width: 56 },
    { key: "status" as const, label: "Status", width: 69 },
  ];

  y += 10;
  page.text("Register", MARGIN, y, { font: "Helvetica-Bold", size: 12 });
  y += 18;
  y = drawTableHeader(page, y, columns);

  const sorted = [...input.records].sort((a, b) => {
    const rank = (status: string) =>
      status === "expired" ? 0 : status === "critical" ? 1 : status === "due_soon" ? 2 : 3;
    const byRank = rank(a.status) - rank(b.status);
    if (byRank !== 0) return byRank;
    return (a.expiresOn ?? "9999-12-31").localeCompare(b.expiresOn ?? "9999-12-31");
  });

  let zebra = false;
  for (const record of sorted) {
    if (y > A4.height - MARGIN - 46) {
      drawFooter(page, pages.length, hash, input);
      page = new Page();
      pages.push(page);
      y = MARGIN + 12;
      y = drawTableHeader(page, y, columns);
      zebra = false;
    }

    const rowHeight = 20;
    if (zebra) page.rect(MARGIN, y - 13, CONTENT_WIDTH, rowHeight, COLOURS.wash);
    zebra = !zebra;

    let x = MARGIN + 4;
    for (const column of columns) {
      const raw = cellValue(record, column.key);
      const text = truncate(raw, column.width - 8, 8.5);
      const colour =
        column.key === "status"
          ? statusColour(record.status)
          : column.key === "holder"
            ? COLOURS.ink
            : COLOURS.muted;
      page.text(text, x, y, {
        size: 8.5,
        colour,
        font: column.key === "holder" ? "Helvetica-Bold" : "Helvetica",
      });
      x += column.width;
    }
    y += rowHeight;
  }

  if (sorted.length === 0) {
    page.text("No records in scope.", MARGIN + 4, y, { size: 9, colour: COLOURS.muted });
    y += 20;
  }

  y += 14;
  page.line(MARGIN, y, A4.width - MARGIN, y);
  y += 18;
  y = page.paragraph(
    "This pack is a point-in-time statement of the records held in Sarayan for the entity named " +
      "above. It certifies what the register contained at the moment of generation. It does not " +
      "constitute legal advice, and it does not assert that the register is complete — only the " +
      "organisation can attest to that.",
    MARGIN,
    y,
    CONTENT_WIDTH,
    { size: 8, colour: COLOURS.muted },
  );

  y += 8;
  page.paragraph(
    `Integrity hash (SHA-256): ${hash}\nVerify at: ${verifyUrl}`,
    MARGIN,
    y,
    CONTENT_WIDTH,
    { size: 8, colour: COLOURS.ink, font: "Helvetica-Bold" },
  );

  drawFooter(page, pages.length, hash, input);

  const pdf = renderPdf(pages, {
    title: `Compliance evidence pack — ${input.entity}`,
    author: "Sarayan",
    subject: `${input.scope} — generated ${input.generatedAt.toISOString()}`,
    createdAt: input.generatedAt,
    id: hash,
  });

  return { pdf, hash, canonicalPayload, summary, verifyUrl };
}

function drawHeader(page: Page, input: EvidencePackInput, hash: string): number {
  page.rect(0, 0, A4.width, 6, COLOURS.brand);
  let y = MARGIN + 10;

  page.text("SARAYAN", MARGIN, y, { font: "Helvetica-Bold", size: 13, colour: COLOURS.brand });
  page.text("Compliance evidence pack", A4.width - MARGIN, y, {
    align: "right",
    size: 9,
    colour: COLOURS.muted,
  });
  y += 26;

  page.text(input.entity, MARGIN, y, { font: "Helvetica-Bold", size: 19 });
  y += 18;
  page.text(`${input.organisation} · ${input.entityCountry}`, MARGIN, y, {
    size: 9.5,
    colour: COLOURS.muted,
  });
  y += 16;
  page.text(`Scope: ${input.scope}`, MARGIN, y, { size: 9.5, colour: COLOURS.muted });
  y += 16;
  page.text(
    `Generated ${formatTimestamp(input.generatedAt)} by ${input.generatedBy}`,
    MARGIN,
    y,
    { size: 9.5, colour: COLOURS.muted },
  );
  y += 10;
  page.line(MARGIN, y, A4.width - MARGIN, y);
  y += 22;

  // Hash lives in the header too — an auditor should not have to hunt for it.
  page.text(`SHA-256 ${hash.slice(0, 32)}…`, A4.width - MARGIN, MARGIN + 26, {
    align: "right",
    size: 7.5,
    colour: COLOURS.muted,
  });

  return y;
}

function drawSummary(page: Page, y: number, summary: EvidenceSummary, input: EvidencePackInput): number {
  const tiles: Array<{ label: string; value: number; colour: typeof COLOURS.ink }> = [
    { label: "Records", value: summary.total, colour: COLOURS.ink },
    { label: "Valid", value: summary.valid, colour: COLOURS.brand },
    { label: "Due soon", value: summary.dueSoon, colour: COLOURS.warning },
    { label: "Critical", value: summary.critical, colour: COLOURS.warning },
    { label: "Expired", value: summary.expired, colour: COLOURS.danger },
  ];

  const gap = 8;
  const tileWidth = (CONTENT_WIDTH - gap * (tiles.length - 1)) / tiles.length;
  let x = MARGIN;
  for (const tile of tiles) {
    page.rect(x, y - 12, tileWidth, 46, COLOURS.wash);
    page.text(String(tile.value), x + 10, y + 8, {
      font: "Helvetica-Bold",
      size: 17,
      colour: tile.colour,
    });
    page.text(tile.label.toUpperCase(), x + 10, y + 24, { size: 6.5, colour: COLOURS.muted });
    x += tileWidth + gap;
  }
  void input;
  return y + 46;
}

function drawTableHeader(
  page: Page,
  y: number,
  columns: Array<{ label: string; width: number }>,
): number {
  let x = MARGIN + 4;
  for (const column of columns) {
    page.text(column.label.toUpperCase(), x, y, { size: 6.5, colour: COLOURS.muted });
    x += column.width;
  }
  y += 6;
  page.line(MARGIN, y, A4.width - MARGIN, y);
  return y + 14;
}

function drawFooter(page: Page, pageNumber: number, hash: string, input: EvidencePackInput): void {
  const y = A4.height - 28;
  page.line(MARGIN, y - 12, A4.width - MARGIN, y - 12);
  page.text(`${input.entity} · ${formatTimestamp(input.generatedAt)}`, MARGIN, y, {
    size: 7,
    colour: COLOURS.muted,
  });
  page.text(`${hash.slice(0, 16)} · page ${pageNumber}`, A4.width - MARGIN, y, {
    align: "right",
    size: 7,
    colour: COLOURS.muted,
  });
}

function cellValue(record: EvidenceRecord, key: keyof EvidenceRecord): string {
  const value = record[key];
  if (value === null || value === undefined || value === "") return "—";
  if (key === "status") return STATUS_LABELS[String(value)] ?? String(value);
  return String(value);
}

const STATUS_LABELS: Record<string, string> = {
  valid: "Valid",
  due_soon: "Due soon",
  critical: "Critical",
  expired: "EXPIRED",
  dormant: "No expiry",
};

function statusColour(status: string) {
  if (status === "expired") return COLOURS.danger;
  if (status === "critical" || status === "due_soon") return COLOURS.warning;
  if (status === "valid") return COLOURS.brand;
  return COLOURS.muted;
}

function truncate(text: string, maxWidth: number, size: number): string {
  if (measure(text, "Helvetica", size) <= maxWidth) return text;
  let candidate = text;
  while (candidate.length > 1 && measure(`${candidate}…`, "Helvetica", size) > maxWidth) {
    candidate = candidate.slice(0, -1);
  }
  return `${candidate}…`;
}

function formatTimestamp(date: Date): string {
  return `${date.toISOString().slice(0, 10)} ${date.toISOString().slice(11, 16)} UTC`;
}

/** Re-derive the hash from a stored payload — used by the public verify page. */
export function verifyPayload(canonicalPayload: string, expectedHash: string): boolean {
  const actual = hashPayload(canonicalPayload);
  // Constant-time-ish comparison; the values are public but habits matter.
  if (actual.length !== expectedHash.length) return false;
  let diff = 0;
  for (let index = 0; index < actual.length; index += 1) {
    diff |= actual.charCodeAt(index) ^ expectedHash.charCodeAt(index);
  }
  return diff === 0;
}

export { wrap };
