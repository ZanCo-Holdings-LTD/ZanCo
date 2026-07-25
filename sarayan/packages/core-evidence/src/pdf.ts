/**
 * A minimal, deterministic PDF writer.
 *
 * Deliberately dependency-free. An evidence pack's whole value is that the
 * bytes are reproducible — regenerate the same pack from the same data and you
 * must get the same SHA-256 — and the easiest way to guarantee that is to own
 * every byte. PDF libraries embed object ids, timestamps and, in some cases,
 * random document ids that break reproducibility.
 *
 * Scope: the standard 14 Type1 fonts (Helvetica family), WinAnsi text, lines
 * and filled rectangles. That is everything an evidence pack needs.
 */

export const A4 = { width: 595.28, height: 841.89 } as const;

export type FontName = "Helvetica" | "Helvetica-Bold" | "Helvetica-Oblique";

const FONT_KEYS: Record<FontName, string> = {
  Helvetica: "F1",
  "Helvetica-Bold": "F2",
  "Helvetica-Oblique": "F3",
};

/** Widths per 1000 units for the Helvetica standard fonts, WinAnsi codes 32-126. */
const HELVETICA_WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
  556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667,
  611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
  667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500,
  222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

const HELVETICA_BOLD_WIDTHS = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
  556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667,
  611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
  667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556,
  278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

/** Width of `text` in points at `size`, used for centring and right-alignment. */
export function measure(text: string, font: FontName, size: number): number {
  const widths = font === "Helvetica-Bold" ? HELVETICA_BOLD_WIDTHS : HELVETICA_WIDTHS;
  let total = 0;
  for (const char of sanitise(text)) {
    const code = char.charCodeAt(0);
    total += code >= 32 && code <= 126 ? widths[code - 32] : 556;
  }
  return (total * size) / 1000;
}

/**
 * Fold text to WinAnsi.
 *
 * The standard 14 fonts cannot render Arabic script, and embedding a font would
 * make the writer non-trivial. Rather than emit mojibake, unsupported runs are
 * replaced with a marker; the pack's canonical JSON — which is what the hash
 * actually covers and what the verifier compares — keeps the original text
 * intact, so nothing is lost from the record of truth.
 */
export function sanitise(text: string): string {
  let out = "";
  let dropped = false;
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (code >= 32 && code <= 126) {
      out += char;
      dropped = false;
    } else if (code === 0x2019 || code === 0x2018) {
      out += "'";
      dropped = false;
    } else if (code === 0x201c || code === 0x201d) {
      out += '"';
      dropped = false;
    } else if (code === 0x2013 || code === 0x2014) {
      out += "-";
      dropped = false;
    } else if (code === 0xa3 || code === 0xa9 || code === 0xae || (code >= 0xc0 && code <= 0xff)) {
      out += char;
      dropped = false;
    } else if (code === 10 || code === 13 || code === 9) {
      out += " ";
      dropped = false;
    } else if (!dropped) {
      out += "\u00B7"; // one middle dot stands in for an unrenderable run
      dropped = true;
    }
  }
  return out;
}

function escapeString(text: string): string {
  return sanitise(text)
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/[\u0080-\u00ff]/g, (char) => `\\${char.charCodeAt(0).toString(8).padStart(3, "0")}`);
}

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export const COLOURS = {
  ink: { r: 0.06, g: 0.09, b: 0.16 },
  muted: { r: 0.42, g: 0.45, b: 0.5 },
  rule: { r: 0.85, g: 0.87, b: 0.89 },
  brand: { r: 0.05, g: 0.4, b: 0.36 },
  danger: { r: 0.72, g: 0.11, b: 0.11 },
  warning: { r: 0.72, g: 0.44, b: 0.05 },
  wash: { r: 0.97, g: 0.976, b: 0.98 },
} satisfies Record<string, RGB>;

function fmt(value: number): string {
  // Fixed precision keeps the byte output identical across platforms.
  return (Math.round(value * 100) / 100).toFixed(2);
}

/** A single page's content stream, built up with drawing calls. */
export class Page {
  private ops: string[] = [];

  constructor(
    readonly width = A4.width,
    readonly height = A4.height,
  ) {}

  text(
    content: string,
    x: number,
    y: number,
    options: { font?: FontName; size?: number; colour?: RGB; align?: "left" | "right" | "center" } = {},
  ): this {
    const font = options.font ?? "Helvetica";
    const size = options.size ?? 10;
    const colour = options.colour ?? COLOURS.ink;
    let drawX = x;
    if (options.align === "right") drawX = x - measure(content, font, size);
    else if (options.align === "center") drawX = x - measure(content, font, size) / 2;
    this.ops.push(
      `BT /${FONT_KEYS[font]} ${fmt(size)} Tf ${fmt(colour.r)} ${fmt(colour.g)} ${fmt(colour.b)} rg ${fmt(drawX)} ${fmt(this.height - y)} Td (${escapeString(content)}) Tj ET`,
    );
    return this;
  }

  /** Word-wrap `content` into `maxWidth`, returning the y after the last line. */
  paragraph(
    content: string,
    x: number,
    y: number,
    maxWidth: number,
    options: { font?: FontName; size?: number; colour?: RGB; leading?: number } = {},
  ): number {
    const font = options.font ?? "Helvetica";
    const size = options.size ?? 10;
    const leading = options.leading ?? size * 1.45;
    let cursor = y;
    for (const line of wrap(content, maxWidth, font, size)) {
      this.text(line, x, cursor, { font, size, colour: options.colour });
      cursor += leading;
    }
    return cursor;
  }

  rect(x: number, y: number, width: number, height: number, colour: RGB): this {
    this.ops.push(
      `${fmt(colour.r)} ${fmt(colour.g)} ${fmt(colour.b)} rg ${fmt(x)} ${fmt(this.height - y - height)} ${fmt(width)} ${fmt(height)} re f`,
    );
    return this;
  }

  line(x1: number, y1: number, x2: number, y2: number, colour: RGB = COLOURS.rule, weight = 0.6): this {
    this.ops.push(
      `${fmt(colour.r)} ${fmt(colour.g)} ${fmt(colour.b)} RG ${fmt(weight)} w ${fmt(x1)} ${fmt(this.height - y1)} m ${fmt(x2)} ${fmt(this.height - y2)} l S`,
    );
    return this;
  }

  build(): string {
    return this.ops.join("\n");
  }
}

export function wrap(text: string, maxWidth: number, font: FontName, size: number): string[] {
  const lines: string[] = [];
  for (const rawLine of text.split("\n")) {
    let current = "";
    for (const word of rawLine.split(/\s+/).filter(Boolean)) {
      const candidate = current ? `${current} ${word}` : word;
      if (measure(candidate, font, size) <= maxWidth) {
        current = candidate;
      } else {
        if (current) lines.push(current);
        current = word;
      }
    }
    lines.push(current);
  }
  return lines.length > 0 ? lines : [""];
}

export interface DocumentMeta {
  title: string;
  author: string;
  subject: string;
  /** Fixed timestamp — passed in, never read from the clock, to stay reproducible. */
  createdAt: Date;
  /** Deterministic document id, normally the content hash. */
  id: string;
}

/** Serialise pages into PDF bytes. */
export function renderPdf(pages: Page[], meta: DocumentMeta): Uint8Array {
  const objects: string[] = [];
  const pageCount = pages.length;
  // 1 catalog, 2 pages, 3..(2+n) page objects, then content streams, then fonts, then info.
  const contentStart = 3 + pageCount;
  const fontStart = contentStart + pageCount;

  objects[1] = `<< /Type /Catalog /Pages 2 0 R >>`;
  objects[2] = `<< /Type /Pages /Kids [${pages
    .map((_, index) => `${3 + index} 0 R`)
    .join(" ")}] /Count ${pageCount} >>`;

  pages.forEach((page, index) => {
    objects[3 + index] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${fmt(page.width)} ${fmt(page.height)}] ` +
      `/Resources << /Font << /F1 ${fontStart} 0 R /F2 ${fontStart + 1} 0 R /F3 ${fontStart + 2} 0 R >> >> ` +
      `/Contents ${contentStart + index} 0 R >>`;
    const stream = page.build();
    objects[contentStart + index] =
      `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`;
  });

  (Object.keys(FONT_KEYS) as FontName[]).forEach((font, index) => {
    objects[fontStart + index] =
      `<< /Type /Font /Subtype /Type1 /BaseFont /${font} /Encoding /WinAnsiEncoding >>`;
  });

  const infoIndex = fontStart + 3;
  objects[infoIndex] =
    `<< /Title (${escapeString(meta.title)}) /Author (${escapeString(meta.author)}) ` +
    `/Subject (${escapeString(meta.subject)}) /Producer (Sarayan Evidence Engine) ` +
    `/Creator (Sarayan) /CreationDate (${pdfDate(meta.createdAt)}) /ModDate (${pdfDate(meta.createdAt)}) >>`;

  let body = "%PDF-1.7\n%\u00e2\u00e3\u00cf\u00d3\n";
  const offsets: number[] = [];
  for (let index = 1; index < objects.length; index += 1) {
    offsets[index] = Buffer.byteLength(body, "latin1");
    body += `${index} 0 obj\n${objects[index]}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(body, "latin1");
  let xref = `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let index = 1; index < objects.length; index += 1) {
    xref += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }

  const docId = meta.id.replace(/[^0-9a-f]/gi, "").slice(0, 32).padEnd(32, "0");
  const trailer =
    `trailer\n<< /Size ${objects.length} /Root 1 0 R /Info ${infoIndex} 0 R ` +
    `/ID [<${docId}> <${docId}>] >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return new Uint8Array(Buffer.from(body + xref + trailer, "latin1"));
}

function pdfDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `D:${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}
