import { ar } from "@/messages/ar";
import { en } from "@/messages/en";

/**
 * Localisation and direction.
 *
 * "Right-to-left is a layout architecture decision, not a plugin." In practice
 * that means: the locale is a route segment, `dir` is set on `<html>`, every
 * component uses logical properties (`ms-*`, `pe-*`, `text-start`) instead of
 * left/right, and any place that genuinely needs a physical direction asks for
 * it here rather than guessing.
 */

export const LOCALES = ["en", "ar"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

export function direction(locale: Locale): "ltr" | "rtl" {
  return locale === "ar" ? "rtl" : "ltr";
}

/** Widen the English literals to `string` so translations are structurally checked. */
type Widen<T> = T extends string ? string : { [K in keyof T]: Widen<T[K]> };

export type Messages = Widen<typeof en>;

// `ar` is checked against the same shape: a missing or misspelled key is a
// compile error, not a runtime fallback nobody notices.
const DICTIONARIES: Record<Locale, Messages> = { en, ar };

export function messagesFor(locale: Locale): Messages {
  return DICTIONARIES[locale] ?? en;
}

/**
 * Translate by dotted key with `{placeholder}` interpolation.
 *
 * Falls back to English rather than rendering a key: a missing Arabic string
 * should look like an untranslated string, not like a broken page.
 */
export function translator(locale: Locale) {
  const dictionary = messagesFor(locale);
  return function t(key: string, values?: Record<string, string | number>): string {
    const template = lookup(dictionary, key) ?? lookup(en, key) ?? key;
    if (!values) return template;
    return template.replace(/\{(\w+)\}/g, (match, name: string) =>
      name in values ? String(values[name]) : match,
    );
  };
}

export type Translate = ReturnType<typeof translator>;

function lookup(dictionary: unknown, key: string): string | null {
  let current: unknown = dictionary;
  for (const segment of key.split(".")) {
    if (typeof current !== "object" || current === null) return null;
    current = (current as Record<string, unknown>)[segment];
  }
  return typeof current === "string" ? current : null;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const INTL_LOCALES: Record<Locale, string> = { en: "en-GB", ar: "ar-AE" };

export function formatDate(value: string | Date | null, locale: Locale): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(`${value.slice(0, 10)}T00:00:00Z`) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(INTL_LOCALES[locale], {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
    // Arabic-speaking Gulf users read Gregorian dates in Latin digits routinely;
    // forcing Arabic-Indic numerals here makes cross-referencing a government
    // document harder, not easier.
    numberingSystem: "latn",
  }).format(date);
}

export function formatDateTime(value: Date | null, locale: Locale): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat(INTL_LOCALES[locale], {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    numberingSystem: "latn",
  }).format(value);
}

export function formatNumber(value: number, locale: Locale): string {
  return new Intl.NumberFormat(INTL_LOCALES[locale], { numberingSystem: "latn" }).format(value);
}

export function formatCurrency(value: number, currency: string, locale: Locale): string {
  return new Intl.NumberFormat(INTL_LOCALES[locale], {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
    numberingSystem: "latn",
  }).format(value);
}

/** "in 42 days" / "12 days ago", localised. */
export function formatRelativeDays(days: number, locale: Locale): string {
  const formatter = new Intl.RelativeTimeFormat(INTL_LOCALES[locale], { numeric: "auto" });
  return formatter.format(days, "day");
}
