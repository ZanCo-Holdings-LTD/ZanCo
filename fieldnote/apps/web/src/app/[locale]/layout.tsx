import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';
import { isLocale, LOCALE_DIRECTION, LOCALES } from '@/i18n/routing';
import '../globals.css';

export const metadata: Metadata = {
  title: 'Fieldnote',
  description: 'Walk the property talking. Review the report this evening.',
};

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  setRequestLocale(locale);
  const messages = await getMessages();

  return (
    // `dir` on <html> is what makes logical properties resolve correctly.
    // Everything downstream uses ms-/me-/ps-/pe-/start-/end- rather than
    // left/right, so this one attribute mirrors the entire interface.
    <html lang={locale} dir={LOCALE_DIRECTION[locale]}>
      <body>
        <NextIntlClientProvider messages={messages}>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
