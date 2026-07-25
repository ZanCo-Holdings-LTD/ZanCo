import { getRequestConfig } from 'next-intl/server';
import { hasLocale } from 'next-intl';
import { routing } from './routing';

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
    /**
     * Formatting follows the locale, but the timezone does not: statement
     * periods are calendar dates and rendering them in the viewer's zone is how
     * a payout dated the 15th displays as the 14th to someone in London.
     */
    timeZone: 'UTC',
    formats: {
      dateTime: {
        short: { day: '2-digit', month: 'short', year: 'numeric' },
      },
    },
  };
});
