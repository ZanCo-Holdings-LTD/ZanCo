import type { Channel } from "@sarayan/core-watch";
import type { PlanTier } from "@/db/schema";

/**
 * Pricing and packaging, straight from the brief.
 *
 * Limits are enforced server-side on every mutation, not merely displayed.
 */

export interface PlanDefinition {
  tier: PlanTier;
  name: string;
  nameAr: string;
  /** Monthly price in GBP pence. */
  monthlyPence: number;
  /** Annual billing at two months free. */
  annualPence: number;
  recordLimit: number;
  userLimit: number;
  entityLimit: number;
  channels: Channel[];
  /** WhatsApp messages included per month before overage metering. */
  includedWhatsappMessages: number;
  features: string[];
  target: string;
  /** Agency tier only: per-client-entity monthly charge in GBP pence. */
  perEntityPence?: number;
  api: boolean;
  sso: boolean;
  customDocumentTypes: boolean;
  evidencePacks: boolean;
  multiEntityConsole: boolean;
  whiteLabel: boolean;
}

export const PLANS: Record<PlanTier, PlanDefinition> = {
  trial: {
    tier: "trial",
    name: "Trial",
    nameAr: "تجريبي",
    monthlyPence: 0,
    annualPence: 0,
    recordLimit: 25,
    userLimit: 3,
    entityLimit: 1,
    channels: ["in_app", "email"],
    includedWhatsappMessages: 0,
    features: ["14 days", "25 records", "Email and in-app alerts"],
    target: "Evaluation",
    api: false,
    sso: false,
    customDocumentTypes: false,
    evidencePacks: true,
    multiEntityConsole: false,
    whiteLabel: false,
  },
  starter: {
    tier: "starter",
    name: "Starter",
    nameAr: "أساسي",
    monthlyPence: 3900,
    annualPence: 39000,
    recordLimit: 25,
    userLimit: 3,
    entityLimit: 1,
    channels: ["in_app", "email"],
    includedWhatsappMessages: 0,
    features: ["25 records", "3 users", "Email and push alerts", "Evidence packs"],
    target: "10-30 staff",
    api: false,
    sso: false,
    customDocumentTypes: false,
    evidencePacks: true,
    multiEntityConsole: false,
    whiteLabel: false,
  },
  business: {
    tier: "business",
    name: "Business",
    nameAr: "أعمال",
    monthlyPence: 9900,
    annualPence: 99000,
    recordLimit: 100,
    userLimit: 10,
    entityLimit: 3,
    channels: ["in_app", "email", "whatsapp"],
    includedWhatsappMessages: 200,
    features: [
      "100 records",
      "10 users",
      "WhatsApp alerts",
      "Evidence packs",
      "Renewal workflow",
      "CSV import and export",
    ],
    target: "30-100 staff",
    api: false,
    sso: false,
    customDocumentTypes: false,
    evidencePacks: true,
    multiEntityConsole: false,
    whiteLabel: false,
  },
  enterprise: {
    tier: "enterprise",
    name: "Enterprise",
    nameAr: "مؤسسي",
    monthlyPence: 24900,
    annualPence: 249000,
    recordLimit: 400,
    userLimit: Number.MAX_SAFE_INTEGER,
    entityLimit: 10,
    channels: ["in_app", "email", "whatsapp", "sms"],
    includedWhatsappMessages: 1000,
    features: [
      "400 records",
      "Unlimited users",
      "API access",
      "SSO",
      "Custom document types",
      "Dependency graph",
    ],
    target: "100-300 staff",
    api: true,
    sso: true,
    customDocumentTypes: true,
    evidencePacks: true,
    multiEntityConsole: false,
    whiteLabel: false,
  },
  agency: {
    tier: "agency",
    name: "Agency",
    nameAr: "وكالة",
    monthlyPence: 60000,
    annualPence: 600000,
    perEntityPence: 800,
    recordLimit: Number.MAX_SAFE_INTEGER,
    userLimit: Number.MAX_SAFE_INTEGER,
    entityLimit: Number.MAX_SAFE_INTEGER,
    channels: ["in_app", "email", "whatsapp", "sms"],
    includedWhatsappMessages: 5000,
    features: [
      "Multi-entity console",
      "White-label client portal",
      "Bulk operations",
      "Unlimited records and users",
      "API access",
      "£8 per client entity",
    ],
    target: "PRO and corporate service firms",
    api: true,
    sso: true,
    customDocumentTypes: true,
    evidencePacks: true,
    multiEntityConsole: true,
    whiteLabel: true,
  },
};

export const PUBLIC_PLANS: PlanDefinition[] = [
  PLANS.starter,
  PLANS.business,
  PLANS.enterprise,
  PLANS.agency,
];

export function planFor(tier: PlanTier): PlanDefinition {
  return PLANS[tier] ?? PLANS.trial;
}

export function formatPrice(pence: number, locale = "en"): string {
  return new Intl.NumberFormat(locale === "ar" ? "ar-AE" : "en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(pence / 100);
}

export interface LimitCheck {
  allowed: boolean;
  used: number;
  limit: number;
  message: string | null;
}

export function checkLimit(tier: PlanTier, kind: "records" | "users" | "entities", used: number): LimitCheck {
  const plan = planFor(tier);
  const limit =
    kind === "records" ? plan.recordLimit : kind === "users" ? plan.userLimit : plan.entityLimit;
  const allowed = used < limit;
  return {
    allowed,
    used,
    limit,
    message: allowed
      ? null
      : `Your ${plan.name} plan includes ${limit === Number.MAX_SAFE_INTEGER ? "unlimited" : limit} ${kind}. Upgrade to add more.`,
  };
}

/** Monthly cost of an agency account, including the per-entity component. */
export function agencyMonthlyPence(entityCount: number): number {
  const plan = PLANS.agency;
  return plan.monthlyPence + (plan.perEntityPence ?? 0) * Math.max(0, entityCount);
}
