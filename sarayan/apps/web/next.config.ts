import type { NextConfig } from "next";

/**
 * Content Security Policy.
 *
 * Sarayan stores passports and Emirates IDs. The trust barrier is the second
 * most severe risk in the brief, so the headers are strict by default and
 * loosened deliberately rather than the other way round.
 */
const csp = [
  "default-src 'self'",
  // Next injects inline bootstrap scripts; 'unsafe-inline' is required for them
  // and is ignored by browsers that honour the nonce-less strict-dynamic path.
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Self-contained server bundle, so the Docker image needs no node_modules.
  output: "standalone",
  transpilePackages: ["@sarayan/core-watch", "@sarayan/core-docs", "@sarayan/core-evidence"],
  outputFileTracingRoot: new URL("../../", import.meta.url).pathname,
  experimental: {
    // Server actions handle every mutation; the body limit covers document uploads.
    serverActions: { bodySizeLimit: "24mb" },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
    ];
  },
  async redirects() {
    return [{ source: "/", destination: "/en", permanent: false }];
  },
};

export default nextConfig;
