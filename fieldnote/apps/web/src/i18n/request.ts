import { getRequestConfig } from 'next-intl/server';
import { DEFAULT_LOCALE, isLocale } from './routing';

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = requested && isLocale(requested) ? requested : DEFAULT_LOCALE;

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
    // Reports are timestamped and read across time zones; pin formatting so a
    // date in a report header never depends on where the reviewer is sitting.
    timeZone: 'Europe/London',
    formats: {
      dateTime: {
        short: { day: 'numeric', month: 'short', year: 'numeric' },
        long: { day: 'numeric', month: 'long', year: 'numeric' },
      },
    },
  };
});
