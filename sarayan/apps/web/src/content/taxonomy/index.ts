import type { ExtractionSchema } from "@sarayan/core-docs";
import { SAUDI_DOCUMENT_TYPES } from "./saudi";
import type { CountryCode, DocumentTypeDefinition } from "./types";
import { UAE_DOCUMENT_TYPES } from "./uae";

export * from "./types";

/**
 * The full curated taxonomy. Twenty-four hand-written document types across the
 * UAE and Saudi Arabia — comfortably past the fifteen v1 requires — each with
 * validity, lead time, penalties and dependency edges.
 */
export const DOCUMENT_TYPES: DocumentTypeDefinition[] = [
  ...UAE_DOCUMENT_TYPES,
  ...SAUDI_DOCUMENT_TYPES,
];

const BY_CODE = new Map(DOCUMENT_TYPES.map((type) => [type.code, type]));

export function documentType(code: string): DocumentTypeDefinition | undefined {
  return BY_CODE.get(code);
}

export function documentTypesFor(country: CountryCode): DocumentTypeDefinition[] {
  return DOCUMENT_TYPES.filter((type) => type.country === country);
}

export function documentTypeName(code: string, locale: "en" | "ar" = "en"): string {
  const type = BY_CODE.get(code);
  if (!type) return code;
  return locale === "ar" ? type.nameAr : type.nameEn;
}

/** Every document type that publishes an SEO page. */
export const SEO_DOCUMENT_TYPES = DOCUMENT_TYPES.filter(
  (type): type is DocumentTypeDefinition & { seo: NonNullable<DocumentTypeDefinition["seo"]> } =>
    type.seo !== null,
);

export function documentTypeBySlug(slug: string) {
  return SEO_DOCUMENT_TYPES.find((type) => type.seo.slug === slug);
}

/** Project a definition into the extraction schema `@sarayan/core-docs` expects. */
export function toExtractionSchema(type: DocumentTypeDefinition): ExtractionSchema {
  return {
    documentTypeCode: type.code,
    documentTypeLabel: type.nameEn,
    country: type.country,
    fields: type.fields,
  };
}

/**
 * Resolve the dependency graph: what breaks downstream when `code` lapses.
 *
 * Hand-curated edges, walked deterministically. No model involved — a lookup
 * table does this correctly, so a model must not.
 */
export function downstreamImpact(code: string, seen = new Set<string>()): DocumentTypeDefinition[] {
  const type = BY_CODE.get(code);
  if (!type || seen.has(code)) return [];
  seen.add(code);

  const impacted: DocumentTypeDefinition[] = [];
  for (const blockedCode of type.blocks) {
    const blocked = BY_CODE.get(blockedCode);
    if (!blocked || seen.has(blockedCode)) continue;
    impacted.push(blocked);
    impacted.push(...downstreamImpact(blockedCode, seen));
  }
  return impacted;
}

/** What must be valid before `code` can itself be renewed. */
export function upstreamDependencies(code: string, seen = new Set<string>()): DocumentTypeDefinition[] {
  const type = BY_CODE.get(code);
  if (!type || seen.has(code)) return [];
  seen.add(code);

  const dependencies: DocumentTypeDefinition[] = [];
  for (const requiredCode of type.requires) {
    const required = BY_CODE.get(requiredCode);
    if (!required || seen.has(requiredCode)) continue;
    dependencies.push(required);
    dependencies.push(...upstreamDependencies(requiredCode, seen));
  }
  return dependencies;
}

/**
 * Estimated penalty for a document that is `daysLate` days past expiry.
 *
 * Deterministic arithmetic over the published bands. Used by the public fine
 * estimator and by the in-app exposure figure — the same function, so the
 * number a prospect sees on the marketing site is the number they see in the
 * product.
 */
export function estimatePenalty(
  code: string,
  daysLate: number,
): { amount: number; currency: string; breakdown: string[] } | null {
  const type = BY_CODE.get(code);
  if (!type || type.penalties.length === 0 || daysLate <= 0) return null;

  let total = 0;
  const breakdown: string[] = [];
  const currency = type.penalties[0].currency;

  for (const band of type.penalties) {
    if (daysLate < band.fromDay) continue;
    const bandEnd = band.toDay ?? daysLate;
    const daysInBand = Math.max(0, Math.min(daysLate, bandEnd) - band.fromDay + 1);
    if (daysInBand === 0) continue;

    if (band.perDay) {
      const amount = band.amount * daysInBand;
      total += amount;
      breakdown.push(`${daysInBand} day${daysInBand === 1 ? "" : "s"} × ${band.currency} ${band.amount} = ${band.currency} ${amount.toLocaleString()}`);
    } else if (band.note?.toLowerCase().includes("per month")) {
      const months = Math.ceil(daysInBand / 30);
      const amount = band.amount * months;
      total += amount;
      breakdown.push(`${months} month${months === 1 ? "" : "s"} × ${band.currency} ${band.amount} = ${band.currency} ${amount.toLocaleString()}`);
    } else {
      total += band.amount;
      breakdown.push(`${band.note ?? "Fixed penalty"}: ${band.currency} ${band.amount.toLocaleString()}`);
    }
  }

  return total > 0 ? { amount: total, currency, breakdown } : null;
}

export const COUNTRIES: Array<{ code: CountryCode; nameEn: string; nameAr: string; currency: string }> = [
  { code: "AE", nameEn: "United Arab Emirates", nameAr: "الإمارات العربية المتحدة", currency: "AED" },
  { code: "SA", nameEn: "Saudi Arabia", nameAr: "المملكة العربية السعودية", currency: "SAR" },
  { code: "QA", nameEn: "Qatar", nameAr: "قطر", currency: "QAR" },
  { code: "KW", nameEn: "Kuwait", nameAr: "الكويت", currency: "KWD" },
];
