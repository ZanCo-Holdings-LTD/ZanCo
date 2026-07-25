import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/routing';

/**
 * Primary navigation.
 *
 * Note the absence of `ml-`/`mr-` anywhere: spacing is `gap` and logical
 * padding, so the bar mirrors under `dir="rtl"` with no conditional and no
 * second stylesheet.
 */
export async function AppNav({ locale }: { locale: string }) {
  const t = await getTranslations('nav');
  const app = await getTranslations('app');

  const items = [
    { href: '/' as const, label: t('dashboard') },
    { href: '/statements' as const, label: t('statements') },
    { href: '/recon' as const, label: t('reconciliation') },
    { href: '/disputes' as const, label: t('disputes') },
    { href: '/margin' as const, label: t('margin') },
    { href: '/settings' as const, label: t('settings') },
  ];

  const otherLocale = locale === 'ar' ? 'en' : 'ar';

  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-6">
        <Link href="/" className="text-sm font-semibold text-ink">
          {app('name')}
        </Link>

        <nav className="flex flex-wrap items-center gap-x-5 gap-y-2">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-sm text-ink-muted transition hover:text-ink"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="ms-auto flex items-center gap-4">
          <Link
            href="/audit"
            className="text-sm font-medium text-brand transition hover:opacity-80"
          >
            {t('freeAudit')}
          </Link>
          {/* Locale switch preserves the path, so it is not a way to lose your place. */}
          <Link
            href="/"
            locale={otherLocale}
            className="rounded-lg border border-line px-2.5 py-1 text-xs font-medium text-ink-muted transition hover:text-ink"
            lang={otherLocale}
          >
            {otherLocale === 'ar' ? 'العربية' : 'English'}
          </Link>
        </div>
      </div>
    </header>
  );
}
