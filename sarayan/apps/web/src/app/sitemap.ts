import type { MetadataRoute } from "next";
import { LEGAL_DOCUMENTS } from "@/content/legal";
import { SEO_DOCUMENT_TYPES } from "@/content/taxonomy";
import { LOCALES } from "@/lib/i18n";
import { env } from "@/lib/env";

/**
 * The sitemap is generated from the taxonomy.
 *
 * Publishing a new document-type guide is a content change, not a code change:
 * add the type with its SEO block and it appears here, in the guides index and
 * as a statically rendered page.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = env.appUrl;
  const now = new Date();

  const staticPaths = [
    { path: "", priority: 1, frequency: "weekly" as const },
    { path: "/pricing", priority: 0.9, frequency: "monthly" as const },
    { path: "/guides", priority: 0.9, frequency: "weekly" as const },
    { path: "/calculators", priority: 0.7, frequency: "monthly" as const },
    { path: "/calculators/fine-estimator", priority: 0.8, frequency: "monthly" as const },
    { path: "/calculators/renewal-cost", priority: 0.8, frequency: "monthly" as const },
    { path: "/calculators/visa-timeline", priority: 0.8, frequency: "monthly" as const },
    { path: "/templates/employee-document-tracker", priority: 0.8, frequency: "monthly" as const },
    { path: "/security", priority: 0.6, frequency: "monthly" as const },
    { path: "/verify", priority: 0.4, frequency: "yearly" as const },
  ];

  const entries: MetadataRoute.Sitemap = [];

  for (const locale of LOCALES) {
    for (const entry of staticPaths) {
      entries.push({
        url: `${base}/${locale}${entry.path}`,
        lastModified: now,
        changeFrequency: entry.frequency,
        priority: entry.priority,
        alternates: {
          languages: Object.fromEntries(
            LOCALES.map((other) => [other, `${base}/${other}${entry.path}`]),
          ),
        },
      });
    }

    for (const type of SEO_DOCUMENT_TYPES) {
      entries.push({
        url: `${base}/${locale}/guides/${type.seo.slug}`,
        lastModified: now,
        changeFrequency: "monthly",
        priority: 0.85,
        alternates: {
          languages: Object.fromEntries(
            LOCALES.map((other) => [other, `${base}/${other}/guides/${type.seo.slug}`]),
          ),
        },
      });
    }

    for (const document of LEGAL_DOCUMENTS) {
      entries.push({
        url: `${base}/${locale}/legal/${document.slug}`,
        lastModified: new Date(document.updated),
        changeFrequency: "yearly",
        priority: 0.3,
      });
    }
  }

  return entries;
}
