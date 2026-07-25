/**
 * Environment configuration.
 *
 * Every integration is optional and degrades to something that still works:
 * no model key means manual field entry, no mail key means alerts queue and
 * surface in-app, no Stripe key means the invoice flow. The app must boot and
 * be useful with nothing configured but a database.
 */

function optional(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() !== "" ? value.trim() : undefined;
}

function required(name: string, fallback?: string): string {
  const value = optional(name) ?? fallback;
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  isProduction: process.env.NODE_ENV === "production",

  /** Absolute origin, used in emails, evidence pack verify links and OG tags. */
  appUrl: (optional("NEXT_PUBLIC_APP_URL") ?? "http://localhost:3000").replace(/\/$/, ""),

  databaseUrl: optional("DATABASE_URL"),

  /**
   * Secret for signing cookies and one-time tokens.
   *
   * A getter, not a value: reading it at module load would fail the production
   * *build*, which runs before the deployment's secrets are attached. It throws
   * on first use in production instead, which is when it actually matters.
   */
  get sessionSecret(): string {
    if (process.env.NODE_ENV === "production") return required("SESSION_SECRET");
    return optional("SESSION_SECRET") ?? "sarayan-development-secret-do-not-use-in-production";
  },

  /** Wraps per-tenant data keys. Rotating this requires re-wrapping every key. */
  masterEncryptionKey: optional("MASTER_ENCRYPTION_KEY"),

  anthropicApiKey: optional("ANTHROPIC_API_KEY"),
  extractionModel: optional("EXTRACTION_MODEL") ?? "claude-opus-5",

  resendApiKey: optional("RESEND_API_KEY"),
  emailFrom: optional("EMAIL_FROM") ?? "Sarayan <alerts@sarayan.app>",

  whatsapp: {
    provider: optional("WHATSAPP_PROVIDER"),
    apiKey: optional("WHATSAPP_API_KEY"),
    baseUrl: optional("WHATSAPP_BASE_URL"),
    sender: optional("WHATSAPP_SENDER"),
    templateName: optional("WHATSAPP_TEMPLATE_NAME") ?? "sarayan_expiry_alert",
  },

  stripe: {
    secretKey: optional("STRIPE_SECRET_KEY"),
    webhookSecret: optional("STRIPE_WEBHOOK_SECRET"),
    prices: {
      starter: optional("STRIPE_PRICE_STARTER"),
      business: optional("STRIPE_PRICE_BUSINESS"),
      enterprise: optional("STRIPE_PRICE_ENTERPRISE"),
      agency: optional("STRIPE_PRICE_AGENCY"),
    },
  },

  storage: {
    endpoint: optional("S3_ENDPOINT"),
    region: optional("S3_REGION") ?? "me-central-1",
    bucket: optional("S3_BUCKET"),
    accessKeyId: optional("S3_ACCESS_KEY_ID"),
    secretAccessKey: optional("S3_SECRET_ACCESS_KEY"),
    /** Where uploads go when no object store is configured. */
    localDir: optional("LOCAL_STORAGE_DIR") ?? ".storage",
  },

  /** Shared secret the scheduler must present on /api/cron/*. */
  cronSecret: optional("CRON_SECRET"),

  posthogKey: optional("NEXT_PUBLIC_POSTHOG_KEY"),
  posthogHost: optional("NEXT_PUBLIC_POSTHOG_HOST"),
  sentryDsn: optional("SENTRY_DSN"),
} as const;

export const features = {
  extraction: Boolean(env.anthropicApiKey),
  email: Boolean(env.resendApiKey),
  whatsapp: Boolean(env.whatsapp.apiKey && env.whatsapp.baseUrl),
  cardPayments: Boolean(env.stripe.secretKey),
  objectStorage: Boolean(env.storage.bucket && env.storage.accessKeyId),
} as const;
