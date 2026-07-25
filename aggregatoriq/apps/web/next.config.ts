import createNextIntlPlugin from 'next-intl/plugin';
import type { NextConfig } from 'next';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const config: NextConfig = {
  reactStrictMode: true,

  /**
   * The workspace packages are TypeScript source rather than built output, so
   * Next compiles them itself. Building them separately would mean a stale
   * `dist` silently shadowing a change to the engine — which is exactly the
   * class of bug that ends with a customer seeing an old number.
   */
  transpilePackages: [
    '@aggregatoriq/core',
    '@aggregatoriq/db',
    '@aggregatoriq/engine',
    '@aggregatoriq/parsers',
  ],

  experimental: {
    // The database driver is server-only and must never be traced into a client
    // bundle.
    serverActions: { bodySizeLimit: '16mb' },
  },

  serverExternalPackages: ['postgres'],

  /**
   * The workspace packages are ESM TypeScript, so their relative imports carry
   * `.js` extensions as the Node resolver requires. Webpack resolves those
   * literally and cannot find a file that only exists as `.ts`, so it is told to
   * try the TypeScript source first.
   *
   * The alternative — dropping the extensions — would make the packages
   * unloadable by Node, which the worker depends on.
   */
  webpack(config) {
    config.resolve = config.resolve ?? {};
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=()',
          },
        ],
      },
    ];
  },
};

export default withNextIntl(config);
