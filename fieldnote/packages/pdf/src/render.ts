import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser } from 'playwright-core';
import { AppError } from '@fieldnote/shared';
import { registerHelpers } from './helpers.js';
import type { ReportModel } from './model.js';

/**
 * HTML to PDF.
 *
 * Chromium's print pipeline rather than a PDF library, because the deliverable
 * has to be indistinguishable from the firm's existing Word or InDesign
 * template — page breaks that respect section boundaries, a repeating
 * letterhead, real typography. A layout engine gets there; a drawing API does
 * not.
 *
 * The browser is launched once per worker process and reused. Launching per
 * report costs about a second each time and is the single largest avoidable
 * latency in the export path.
 */

const templatesDir = join(dirname(fileURLToPath(import.meta.url)), '../templates');
const compiled = new Map<string, HandlebarsTemplateDelegate<ReportModel>>();

let browser: Browser | undefined;

export interface RenderOptions {
  /** Template name, from templates.pdf_template. Falls back to `default`. */
  template: string;
  /** Path to a Chromium executable. Set in the worker image. */
  executablePath?: string;
}

async function loadTemplate(name: string): Promise<HandlebarsTemplateDelegate<ReportModel>> {
  const cached = compiled.get(name);
  if (cached) return cached;

  const handlebars = registerHelpers();

  let source: string;
  try {
    source = await readFile(join(templatesDir, `${name}.hbs`), 'utf8');
  } catch {
    if (name === 'default') {
      throw new AppError('internal', 'The default report template is missing from the build');
    }
    // A template referenced by a template record but absent from the build is a
    // deployment problem, not a reason to fail a customer's export.
    return loadTemplate('default');
  }

  const layout = await readFile(join(templatesDir, 'layout.css'), 'utf8');
  const template = handlebars.compile<ReportModel>(source.replace('/* {{STYLES}} */', layout), {
    noEscape: false,
  });
  compiled.set(name, template);
  return template;
}

export async function renderHtml(model: ReportModel, options: RenderOptions): Promise<string> {
  const template = await loadTemplate(options.template);
  return template(model);
}

async function getBrowser(executablePath?: string): Promise<Browser> {
  if (browser?.isConnected()) return browser;
  browser = await chromium.launch({
    ...(executablePath ? { executablePath } : {}),
    args: [
      // The renderer handles only our own HTML with inlined assets, and runs
      // in a container with no network. These flags are what make it start
      // reliably under a non-root user in a minimal image.
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  });
  return browser;
}

export async function closeBrowser(): Promise<void> {
  await browser?.close();
  browser = undefined;
}

export interface RenderedPdf {
  bytes: Uint8Array;
  html: string;
}

export async function renderPdf(model: ReportModel, options: RenderOptions): Promise<RenderedPdf> {
  const html = await renderHtml(model, options);
  const instance = await getBrowser(options.executablePath);
  const context = await instance.newContext();
  const page = await context.newPage();

  try {
    // `domcontentloaded` rather than `networkidle`: every asset is already a
    // data URI, so waiting on the network waits on nothing.
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    await page.emulateMedia({ media: 'print' });

    const bytes = await page.pdf({
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: footerTemplate(model),
      margin: { top: '18mm', bottom: '20mm', left: '16mm', right: '16mm' },
    });

    return { bytes, html };
  } finally {
    await context.close();
  }
}

/**
 * Page numbering and the reference line.
 *
 * Surveyors are asked for "page 7 of the report" over the phone, so the
 * numbering has to be present and the reference has to be on every page.
 */
function footerTemplate(model: ReportModel): string {
  const reference = escapeHtml(model.reference ?? model.propertyAddress);
  return `
    <div style="width:100%;font-size:8pt;color:#666;padding:0 16mm;
                font-family:Georgia,'Times New Roman',serif;
                display:flex;justify-content:space-between;">
      <span>${reference}</span>
      <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
    </div>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
