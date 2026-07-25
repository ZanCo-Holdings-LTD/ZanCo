import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { DEFAULT_LOCALE, LOCALES, direction, isLocale, messagesFor } from "@/lib/i18n";
import "../globals.css";

/**
 * The locale segment is the root layout.
 *
 * `lang` and `dir` are set here, from the URL, before anything renders — which
 * is what makes RTL a layout property of the document rather than a class
 * components have to remember to apply.
 */

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafafa" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1117" },
  ],
  width: "device-width",
  initialScale: 1,
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const resolved = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const messages = messagesFor(resolved);

  return {
    metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
    title: {
      default: `${messages.brand.name} — ${messages.marketing.heroEyebrow}`,
      template: `%s · ${messages.brand.name}`,
    },
    description: messages.marketing.heroBody,
    alternates: {
      canonical: `/${resolved}`,
      languages: { en: "/en", ar: "/ar", "x-default": "/en" },
    },
    openGraph: {
      type: "website",
      siteName: messages.brand.name,
      locale: resolved === "ar" ? "ar_AE" : "en_GB",
      title: `${messages.brand.name} — ${messages.marketing.heroTitle}`,
      description: messages.marketing.heroBody,
    },
    robots: { index: true, follow: true },
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
  if (!isLocale(locale)) notFound();

  return (
    <html lang={locale} dir={direction(locale)} suppressHydrationWarning>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
