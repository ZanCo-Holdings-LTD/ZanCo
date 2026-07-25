/**
 * CSV and delimited-text reading.
 *
 * Written out rather than pulled in, because the edge cases that matter here are
 * few, specific, and all of them appear in real aggregator exports: quoted
 * fields containing the delimiter, doubled quotes, CRLF, the UTF-8 BOM Excel
 * writes, semicolon delimiters from European-locale Excel, and preamble rows
 * above the real header.
 *
 * A wrong answer here is not a crash, it is a column silently read as another
 * column, so the behaviour is worth owning.
 */

export const DELIMITERS = [',', ';', '\t', '|'] as const;
export type Delimiter = (typeof DELIMITERS)[number];

export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Guess the delimiter by which candidate yields the most consistent column
 * count across the first few lines. Consistency beats raw frequency: a comma
 * appearing inside quoted addresses can out-count a genuine semicolon delimiter.
 */
export function detectDelimiter(text: string): Delimiter {
  const sample = stripBom(text).split(/\r?\n/).filter((line) => line.trim() !== '').slice(0, 12);
  if (sample.length === 0) return ',';

  let best: Delimiter = ',';
  let bestScore = -1;

  for (const delimiter of DELIMITERS) {
    const counts = sample.map((line) => parseLine(line, delimiter).length);
    const columns = counts[0] ?? 1;
    if (columns < 2) continue;

    const consistent = counts.filter((count) => count === columns).length;
    // Reward agreement across lines, then width, so a two-column false positive
    // does not beat a genuine eight-column layout.
    const score = consistent * 100 + columns;
    if (score > bestScore) {
      bestScore = score;
      best = delimiter;
    }
  }

  return best;
}

function parseLine(line: string, delimiter: string): string[] {
  return parseCsv(line, delimiter)[0] ?? [];
}

/** RFC 4180 with a configurable delimiter. */
export function parseCsv(input: string, delimiter: string = ','): string[][] {
  const text = stripBom(input);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let index = 0;

  const endRow = (): void => {
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

    if (char === '"' && field === '') {
      inQuotes = true;
      index += 1;
      continue;
    }
    if (char === delimiter) {
      row.push(field);
      field = '';
      index += 1;
      continue;
    }
    if (char === '\r') {
      if (text[index + 1] === '\n') index += 1;
      endRow();
      index += 1;
      continue;
    }
    if (char === '\n') {
      endRow();
      index += 1;
      continue;
    }

    field += char;
    index += 1;
  }

  if (field !== '' || row.length > 0) endRow();

  return rows.filter((candidate) => candidate.some((cell) => cell.trim() !== ''));
}

export interface Sheet {
  readonly headerRowIndex: number;
  readonly headers: readonly string[];
  /** Data rows, keyed by header. Duplicated headers get a `_2` suffix. */
  readonly rows: readonly Record<string, string>[];
  /** The raw cell arrays, so a parser can reach a column by position if it must. */
  readonly rawRows: readonly (readonly string[])[];
  readonly delimiter: Delimiter;
}

/**
 * Find the header row.
 *
 * Aggregator exports frequently carry a title, a store name and a date range
 * above the real header. Taking row 0 as the header on those files produces a
 * sheet whose columns are all named after a date, which then fails to fingerprint
 * and lands in manual review — correct, but slow. So the header is the first row
 * that looks like one: mostly non-empty, mostly non-numeric, and the widest.
 */
export function findHeaderRow(rows: readonly (readonly string[])[]): number {
  let best = 0;
  let bestScore = -1;

  const limit = Math.min(rows.length, 20);
  for (let index = 0; index < limit; index += 1) {
    const row = rows[index]!;
    const filled = row.filter((cell) => cell.trim() !== '');
    if (filled.length < 2) continue;

    const numeric = filled.filter((cell) => /^-?[\d.,()%\s]+$/.test(cell.trim())).length;
    const textual = filled.length - numeric;

    // Header rows are wide and made of words. Data rows are wide and made of
    // numbers. Preamble rows are narrow.
    const score = textual * 10 + filled.length - numeric * 5;
    if (score > bestScore) {
      bestScore = score;
      best = index;
    }
  }

  return best;
}

export function readSheet(input: string, delimiter?: Delimiter): Sheet {
  const chosen = delimiter ?? detectDelimiter(input);
  const rawRows = parseCsv(input, chosen);

  if (rawRows.length === 0) {
    return { headerRowIndex: 0, headers: [], rows: [], rawRows: [], delimiter: chosen };
  }

  const headerRowIndex = findHeaderRow(rawRows);
  const headers = dedupeHeaders(rawRows[headerRowIndex]!.map((cell) => cell.trim()));

  const rows = rawRows.slice(headerRowIndex + 1).map((row) => {
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      if (header === '') return;
      record[header] = (row[index] ?? '').trim();
    });
    return record;
  });

  return { headerRowIndex, headers, rows, rawRows, delimiter: chosen };
}

function dedupeHeaders(headers: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return headers.map((header) => {
    const count = seen.get(header) ?? 0;
    seen.set(header, count + 1);
    return count === 0 ? header : `${header}_${count + 1}`;
  });
}
