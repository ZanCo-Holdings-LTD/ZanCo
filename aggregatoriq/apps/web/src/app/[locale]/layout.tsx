import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { dirFor, routing } from '@/i18n/routing';
import { AppNav } from '@/components/nav';
import '../globals.css';

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'app' });

  return {
    title: { default: t('name'), template: `%s · ${t('name')}` },
    description: t('tagline'),
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  // Required for static rendering of the locale segment.
  setRequestLocale(locale);

  return (
    // `dir` is server-rendered. Every logical property in the app resolves from
    // it, so the layout is correct in the first paint rather than after a flip.
    <html lang={locale} dir={dirFor(locale)}>
      <body>
        <NextIntlClientProvider>
          <div className="min-h-dvh">
            <AppNav locale={locale} />
            <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">{children}</main>
          </div>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
