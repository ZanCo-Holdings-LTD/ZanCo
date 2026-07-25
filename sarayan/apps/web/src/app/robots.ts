import type { MetadataRoute } from "next";
import { env } from "@/lib/env";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // The app, the API and evidence-pack verification pages carry customer
        // data or are per-request; none of them belong in an index.
        disallow: ["/api/", "/en/app/", "/ar/app/", "/en/verify/", "/ar/verify/"],
      },
    ],
    sitemap: `${env.appUrl}/sitemap.xml`,
    host: env.appUrl,
  };
}
