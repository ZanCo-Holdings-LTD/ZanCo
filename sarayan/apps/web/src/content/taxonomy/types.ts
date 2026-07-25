/**
 * The document taxonomy.
 *
 * "The DocumentType table is the product's real intellectual property: a
 * curated taxonomy per country of every document type, its typical validity
 * period, renewal lead time, issuing authority, penalty schedule and
 * dependencies. Build it by hand, treat it as a content asset, and never let it
 * become user-generated."
 *
 * So it lives in version control as typed data, is seeded into Postgres, and
 * feeds three things at once: extraction schemas, renewal defaults, and the SEO
 * page for that document type in that jurisdiction.
 */

import type { FieldSpec } from "@sarayan/core-docs";

export type CountryCode = "AE" | "SA" | "QA" | "KW";

export type HolderKind = "person" | "vehicle" | "asset" | "entity";

export type DocumentCategory =
  | "corporate"
  | "immigration"
  | "labour"
  | "vehicle"
  | "premises"
  | "insurance"
  | "certification"
  | "tax";

export interface PenaltyBand {
  /** Days past expiry this band starts. */
  fromDay: number;
  /** Days past expiry this band ends; `null` means open-ended. */
  toDay: number | null;
  /** Local-currency amount, or per-day rate when `perDay` is true. */
  amount: number;
  currency: "AED" | "SAR" | "QAR" | "KWD";
  perDay?: boolean;
  note?: string;
}

export interface Consequence {
  /** What stops working when this document lapses. */
  effect: string;
  severity: "blocking" | "financial" | "operational";
}

export interface SeoContent {
  /** URL segment, e.g. `dubai-trade-licence-renewal`. */
  slug: string;
  title: string;
  metaDescription: string;
  /** Two or three opening paragraphs. Written, not generated. */
  intro: string[];
  steps: Array<{ heading: string; body: string }>;
  faqs: Array<{ question: string; answer: string }>;
  /** Related slugs, hand-picked for internal linking. */
  related: string[];
}

export interface DocumentTypeDefinition {
  /** Stable machine code. Never renamed — records reference it. */
  code: string;
  country: CountryCode;
  /** Emirate, region or "national". Drives the per-jurisdiction SEO pages. */
  jurisdiction: string;
  category: DocumentCategory;
  holderKind: HolderKind;
  nameEn: string;
  nameAr: string;
  /** Common alternative names, used for search and CSV import matching. */
  aliases: string[];
  issuingAuthority: string;
  issuingAuthorityAr: string;
  /** Typical validity in months. `null` for documents with no fixed term. */
  typicalValidityMonths: number | null;
  /** Days before expiry the renewal should start — the default lead time. */
  renewalLeadDays: number;
  /** Typical official cost of renewal, in the local currency. */
  typicalRenewalCost: { amount: number; currency: PenaltyBand["currency"] } | null;
  penalties: PenaltyBand[];
  /** Codes of documents that break when this one lapses. Hand-curated, no model. */
  blocks: string[];
  /** Codes this document depends on — it cannot be renewed while these are expired. */
  requires: string[];
  consequences: Consequence[];
  /** Extraction schema for this type. */
  fields: FieldSpec[];
  seo: SeoContent | null;
}

/** Fields nearly every government document carries. */
export const COMMON_FIELDS: FieldSpec[] = [
  {
    key: "documentNumber",
    label: "Document number",
    kind: "text",
    required: true,
    hint: "The primary reference number printed on the document",
  },
  {
    key: "holderName",
    label: "Holder name",
    kind: "name",
    required: true,
    hint: "The person or company the document is issued to, in Latin script if shown",
  },
  {
    key: "issueDate",
    label: "Issue date",
    kind: "date",
    hint: "Gregorian issue date, YYYY-MM-DD",
  },
  {
    key: "expiryDate",
    label: "Expiry date",
    kind: "date",
    required: true,
    critical: true,
    hint: "Gregorian expiry date, YYYY-MM-DD. Read it — never infer it.",
  },
];

export function withCommonFields(...extra: FieldSpec[]): FieldSpec[] {
  return [...COMMON_FIELDS, ...extra];
}
