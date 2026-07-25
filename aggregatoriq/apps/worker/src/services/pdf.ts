/**
 * A minimal PDF writer.
 *
 * Text-only, single font family, A4. Written out rather than pulled in because
 * the dispute pack is a plain document — a heading, a table of variances, and
 * the evidence behind each — and a full PDF library is a large dependency and a
 * large supply-chain surface for a product whose whole pitch is that its numbers
 * can be trusted.
 *
 * Deliberate limitation: the standard PDF fonts are Latin-only, so the pack is
 * generated in English. Aggregator partner teams work in English and a dispute
 * is submitted to them, so this is the right call for now — but it is a
 * limitation rather than a decision that Arabic does not matter, and an embedded
 * font is the fix when a customer needs one. The CSV export carries the same
 * data with no such constraint.
 */

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 56;
const LINE_HEIGHT = 14;
const FONT_SIZE = 10;
const TITLE_SIZE = 16;
const HEADING_SIZE = 12;

export interface PdfBlock {
  readonly kind: 'title' | 'heading' | 'body' | 'mono' | 'spacer' | 'rule';
  readonly text?: string;
}

export function title(text: string): PdfBlock {
  return { kind: 'title', text };
}
export function heading(text: string): PdfBlock {
  return { kind: 'heading', text };
}
export function body(text: string): PdfBlock {
  return { kind: 'body', text };
}
export function mono(text: string): PdfBlock {
  return { kind: 'mono', text };
}
export function spacer(): PdfBlock {
  return { kind: 'spacer' };
}
export function rule(): PdfBlock {
  return { kind: 'rule' };
}

/**
 * Escape for a PDF literal string, and drop anything outside WinAnsi.
 *
 * A stray non-Latin character would otherwise produce a corrupt file rather than
 * a missing glyph, and a dispute pack that will not open is worse than one with
 * a transliterated restaurant name.
 */
function escapeText(text: string): string {
  // WinAnsi's printable ranges: ASCII, then the Latin-1 supplement. Written as
  // explicit escapes because the literal form contains a non-breaking space,
  // which is invisible in review and trivially broken by an editor.
  return text
    .replace(/[^\x20-\x7e\xa0-\xff]/g, '?')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

/** Rough width metric for Helvetica, good enough to wrap a paragraph sensibly. */
function wrap(text: string, size: number, maxWidth: number): string[] {
  const charWidth = size * 0.5;
  const perLine = Math.max(20, Math.floor(maxWidth / charWidth));
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current === '' ? word : `${current} ${word}`;
    if (candidate.length <= perLine) {
      current = candidate;
      continue;
    }
    if (current !== '') lines.push(current);
    current = word.length > perLine ? word.slice(0, perLine) : word;
  }
  if (current !== '') lines.push(current);

  return lines.length === 0 ? [''] : lines;
}

interface Line {
  readonly text: string;
  readonly size: number;
  readonly font: 'F1' | 'F2' | 'F3';
  readonly isRule: boolean;
}

function layout(blocks: readonly PdfBlock[]): Line[][] {
  const usableWidth = PAGE_WIDTH - MARGIN * 2;
  const linesPerPage = Math.floor((PAGE_HEIGHT - MARGIN * 2) / LINE_HEIGHT);

  const flat: Line[] = [];

  for (const block of blocks) {
    switch (block.kind) {
      case 'spacer':
        flat.push({ text: '', size: FONT_SIZE, font: 'F1', isRule: false });
        break;
      case 'rule':
        flat.push({ text: '', size: FONT_SIZE, font: 'F1', isRule: true });
        break;
      case 'title':
        for (const line of wrap(block.text ?? '', TITLE_SIZE, usableWidth)) {
          flat.push({ text: line, size: TITLE_SIZE, font: 'F2', isRule: false });
        }
        flat.push({ text: '', size: FONT_SIZE, font: 'F1', isRule: false });
        break;
      case 'heading':
        for (const line of wrap(block.text ?? '', HEADING_SIZE, usableWidth)) {
          flat.push({ text: line, size: HEADING_SIZE, font: 'F2', isRule: false });
        }
        break;
      case 'mono':
        for (const line of wrap(block.text ?? '', FONT_SIZE, usableWidth)) {
          flat.push({ text: line, size: FONT_SIZE, font: 'F3', isRule: false });
        }
        break;
      case 'body':
      default:
        for (const line of wrap(block.text ?? '', FONT_SIZE, usableWidth)) {
          flat.push({ text: line, size: FONT_SIZE, font: 'F1', isRule: false });
        }
        break;
    }
  }

  const pages: Line[][] = [];
  for (let index = 0; index < flat.length; index += linesPerPage) {
    pages.push(flat.slice(index, index + linesPerPage));
  }
  return pages.length === 0 ? [[]] : pages;
}

function contentStream(lines: readonly Line[]): string {
  const parts: string[] = [];
  let y = PAGE_HEIGHT - MARGIN;

  for (const line of lines) {
    if (line.isRule) {
      parts.push(
        `0.8 G 0.5 w ${MARGIN} ${(y + 4).toFixed(2)} m ${(PAGE_WIDTH - MARGIN).toFixed(2)} ${(y + 4).toFixed(2)} l S`,
      );
    } else if (line.text !== '') {
      parts.push(
        `BT /${line.font} ${line.size} Tf ${MARGIN} ${y.toFixed(2)} Td (${escapeText(line.text)}) Tj ET`,
      );
    }
    y -= LINE_HEIGHT;
  }

  return parts.join('\n');
}

/** Render blocks to PDF bytes. */
export function renderPdf(blocks: readonly PdfBlock[]): Buffer {
  const pages = layout(blocks);

  const objects: string[] = [];
  const fontObjectStart = 3 + pages.length * 2;

  const kids = pages.map((_, index) => `${3 + index * 2} 0 R`).join(' ');

  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);

  pages.forEach((lines, index) => {
    const contentsRef = `${4 + index * 2} 0 R`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
        `/Resources << /Font << /F1 ${fontObjectStart} 0 R /F2 ${fontObjectStart + 1} 0 R ` +
        `/F3 ${fontObjectStart + 2} 0 R >> >> /Contents ${contentsRef} >>`,
    );

    const stream = contentStream(lines);
    objects.push(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
  });

  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>');

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];

  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, 'latin1');
}
