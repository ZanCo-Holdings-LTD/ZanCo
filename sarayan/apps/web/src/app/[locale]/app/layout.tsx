import {
  BellRing,
  Building2,
  FileCheck2,
  FileText,
  LayoutDashboard,
  RefreshCw,
  Settings,
  Users,
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { and, count, eq, isNull } from "drizzle-orm";
import { Logo } from "@/components/marketing/chrome";
import { Badge } from "@/components/ui";
import { db } from "@/db";
import { alerts } from "@/db/schema";
import { currentSession } from "@/lib/auth";
import { DEFAULT_LOCALE, isLocale, translator, type Locale } from "@/lib/i18n";
import { planFor } from "@/lib/plans";
import { signOutAction } from "../(auth)/actions";
import { OrgSwitcher } from "./org-switcher";

export default async function AppLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const t = translator(locale);

  const session = await currentSession();
  if (!session) redirect(`/${locale}/sign-in`);

  const [{ waiting }] = await db
    .select({ waiting: count() })
    .from(alerts)
    .where(
      and(
        eq(alerts.organisationId, session.organisation.id),
        eq(alerts.status, "sent"),
        isNull(alerts.acknowledgedAt),
      ),
    );

  const plan = planFor(session.organisation.tier);

  const nav = [
    { href: `/${locale}/app`, icon: LayoutDashboard, label: t("dashboard.title"), exact: true },
    { href: `/${locale}/app/records`, icon: FileText, label: t("records.title") },
    { href: `/${locale}/app/alerts`, icon: BellRing, label: t("alerts.title"), badge: waiting },
    { href: `/${locale}/app/renewals`, icon: RefreshCw, label: t("renewals.title") },
    { href: `/${locale}/app/holders`, icon: Users, label: locale === "ar" ? "الحاملون" : "Holders" },
    { href: `/${locale}/app/entities`, icon: Building2, label: t("entities.title") },
    { href: `/${locale}/app/evidence`, icon: FileCheck2, label: t("evidence.title") },
    { href: `/${locale}/app/settings`, icon: Settings, label: t("settings.title") },
  ];

  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      <aside className="border-b border-ink-200 bg-white lg:w-60 lg:shrink-0 lg:border-b-0 lg:border-e dark:border-ink-800 dark:bg-ink-900">
        <div className="flex h-14 items-center justify-between px-4 lg:border-b lg:border-ink-100 dark:lg:border-ink-800">
          <Logo locale={locale} />
        </div>

        <div className="px-3 py-3">
          <OrgSwitcher
            locale={locale}
            current={session.organisation.id}
            organisations={session.organisations.map((entry) => ({
              id: entry.organisation.id,
              name: entry.organisation.name,
            }))}
          />
        </div>

        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:overflow-visible">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-ink-600 transition-colors hover:bg-ink-100 hover:text-ink-900 dark:text-ink-300 dark:hover:bg-ink-800 dark:hover:text-ink-50"
            >
              <item.icon className="size-4 shrink-0" aria-hidden />
              <span className="whitespace-nowrap">{item.label}</span>
              {item.badge ? (
                <Badge tone="expired" className="ms-auto">
                  {item.badge}
                </Badge>
              ) : null}
            </Link>
          ))}
        </nav>

        <div className="hidden border-t border-ink-100 p-3 lg:block dark:border-ink-800">
          <p className="px-1 text-xs text-ink-500 dark:text-ink-400">{session.user.name}</p>
          <p className="mt-0.5 px-1 text-xs text-ink-400">
            {locale === "ar" ? plan.nameAr : plan.name}
            {session.organisation.billingStatus === "trialing"
              ? locale === "ar"
                ? " · تجريبي"
                : " · trial"
              : ""}
          </p>
          <form action={signOutAction} className="mt-2">
            <input type="hidden" name="locale" value={locale} />
            <button
              type="submit"
              className="w-full rounded-md px-1 py-1 text-start text-xs text-ink-500 hover:text-ink-900 dark:text-ink-400 dark:hover:text-ink-100"
            >
              {t("nav.signOut")}
            </button>
          </form>
        </div>
      </aside>

      <main className="min-w-0 flex-1 bg-[var(--surface)]">
        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">{children}</div>
      </main>
    </div>
  );
}
