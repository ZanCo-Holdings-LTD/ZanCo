import { defineRouting } from 'next-intl/routing';
import { createNavigation } from 'next-intl/navigation';

/**
 * Locale routing.
 *
 * English and Arabic, both first class. Arabic is not a translation layer bolted
 * on: a Riyadh operator reading a settlement discrepancy in Arabic, right to
 * left, is the primary user in the market this launches in.
 */
export const routing = defineRouting({
  locales: ['en', 'ar'],
  defaultLocale: 'en',
  localePrefix: 'always',
});

export type AppLocale = (typeof routing.locales)[number];

export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);

export function isRtl(locale: string): boolean {
  return locale === 'ar';
}

export function dirFor(locale: string): 'rtl' | 'ltr' {
  return isRtl(locale) ? 'rtl' : 'ltr';
}
