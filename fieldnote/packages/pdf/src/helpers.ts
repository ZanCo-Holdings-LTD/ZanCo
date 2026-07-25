import Handlebars from 'handlebars';

/**
 * Template helpers.
 *
 * Kept minimal on purpose. A report template should be a layout, not a program
 * — anything that needs a decision belongs in model.ts where it can be tested.
 */
let registered = false;

export function registerHelpers(): typeof Handlebars {
  if (registered) return Handlebars;

  /** Render prose with paragraph breaks preserved, escaping every segment. */
  Handlebars.registerHelper('paragraphs', (text: unknown) => {
    if (typeof text !== 'string' || text.trim() === '') return '';
    const html = text
      .split(/\n{2,}/)
      .map((paragraph) => `<p>${Handlebars.escapeExpression(paragraph.trim())}</p>`)
      .join('');
    return new Handlebars.SafeString(html);
  });

  Handlebars.registerHelper('eq', (a: unknown, b: unknown) => a === b);
  Handlebars.registerHelper('gt', (a: number, b: number) => a > b);
  Handlebars.registerHelper('inc', (value: number) => value + 1);

  registered = true;
  return Handlebars;
}

/**
 * Inline an asset as a data URI.
 *
 * The renderer runs with no network access, so every image — logo, letterhead,
 * signature, site photo — must already be embedded by the time the HTML is
 * handed to the browser. That is a deliberate constraint: a rendered report
 * must never depend on a URL that could later 404 or be swapped out.
 */
export function toDataUri(bytes: Uint8Array, contentType: string): string {
  return `data:${contentType};base64,${Buffer.from(bytes).toString('base64')}`;
}
