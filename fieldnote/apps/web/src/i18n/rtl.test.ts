import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import en from '../../messages/en.json';
import ar from '../../messages/ar.json';
import { LOCALE_DIRECTION, LOCALES } from './routing';

/**
 * RTL and translation guards.
 *
 * The GCC vertical has Arabic-speaking field crews, and a UI that mirrors
 * incorrectly is one nobody in that market trusts. Two failure modes are easy
 * to introduce and impossible to spot in an English-only review, so both are
 * checked mechanically:
 *
 *  - a physical direction class (`ml-`, `pr-`, `text-left`) that will not
 *    mirror under `dir="rtl"`;
 *  - an English key with no Arabic counterpart, which renders as a raw key
 *    path in the middle of an otherwise translated page.
 */

const SRC = join(import.meta.dirname, '..');

/**
 * Physical-direction Tailwind classes. Matched with a word boundary so
 * `mr-` catches `mr-2` but not `mr-auto`'s legitimate cousins in other words,
 * and so `border-l-` is caught without flagging `border-`.
 */
const PHYSICAL_CLASS =
  /\b(?:ml|mr|pl|pr|left|right|border-l|border-r|rounded-l|rounded-r)-[\w[\]./]+/g;
const PHYSICAL_TEXT_ALIGN = /\btext-(?:left|right)\b/g;

/**
 * Genuinely physical exceptions.
 *
 * An audio waveform scrubs left to right regardless of script direction, and
 * so does a video timeline. Anything added here needs a reason in this comment.
 */
const ALLOWED = new Set<string>([]);

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.next') continue;
      yield* walk(path);
    } else if (/\.tsx?$/.test(entry.name)) {
      yield path;
    }
  }
}

describe('logical properties', () => {
  it('uses no physical direction classes anywhere in the UI', async () => {
    const offenders: string[] = [];

    for await (const file of walk(SRC)) {
      if (file.endsWith('.test.ts') || file.endsWith('.test.tsx')) continue;
      const source = await readFile(file, 'utf8');

      for (const match of [
        ...(source.match(PHYSICAL_CLASS) ?? []),
        ...(source.match(PHYSICAL_TEXT_ALIGN) ?? []),
      ]) {
        if (ALLOWED.has(match)) continue;
        offenders.push(`${file.replace(SRC, 'src')}: ${match}`);
      }
    }

    expect(
      offenders,
      `Use logical properties so the UI mirrors under dir="rtl":\n` +
        `  ml- -> ms-   mr- -> me-   pl- -> ps-   pr- -> pe-\n` +
        `  left- -> start-   right- -> end-   text-left -> text-start\n\n` +
        offenders.join('\n'),
    ).toEqual([]);
  });
});

describe('locale configuration', () => {
  it('marks Arabic as right to left', () => {
    expect(LOCALE_DIRECTION.ar).toBe('rtl');
    expect(LOCALE_DIRECTION.en).toBe('ltr');
  });

  it('has a direction for every configured locale', () => {
    for (const locale of LOCALES) {
      expect(LOCALE_DIRECTION[locale]).toBeDefined();
    }
  });
});

describe('translations', () => {
  function keysOf(value: unknown, prefix = ''): string[] {
    if (typeof value !== 'object' || value === null) return [prefix];
    return Object.entries(value).flatMap(([key, child]) =>
      keysOf(child, prefix ? `${prefix}.${key}` : key),
    );
  }

  it('has an Arabic message for every English key', () => {
    const missing = keysOf(en).filter((key) => !keysOf(ar).includes(key));
    expect(missing, `Missing Arabic translations:\n${missing.join('\n')}`).toEqual([]);
  });

  it('has no Arabic keys that English does not define', () => {
    // A stale Arabic key is dead weight that hides a rename.
    const extra = keysOf(ar).filter((key) => !keysOf(en).includes(key));
    expect(extra, `Arabic keys with no English counterpart:\n${extra.join('\n')}`).toEqual([]);
  });
});
