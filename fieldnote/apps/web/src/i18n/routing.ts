import { defineRouting } from 'next-intl/routing';
import { createNavigation } from 'next-intl/navigation';

/**
 * Locales.
 *
 * English is vertical one. Arabic is here from the start because the GCC port
 * is a stated destination and retrofitting RTL into a UI built with physical
 * direction classes is a rewrite of every component, not a stylesheet change.
 */
export const LOCALES = ['en', 'ar'] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

/** Text direction per locale. Drives the `dir` attribute on <html>. */
export const LOCALE_DIRECTION: Record<Locale, 'ltr' | 'rtl'> = {
  en: 'ltr',
  ar: 'rtl',
};

export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  ar: 'العربية',
};

export const routing = defineRouting({
  locales: LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  // The default locale carries no prefix, so existing English URLs are stable.
  localePrefix: 'as-needed',
});

export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}
