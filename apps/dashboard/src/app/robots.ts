import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// Keep the signed-in dashboard out of search results; only marketing pages and docs are indexed.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/overview",
          "/admin",
          "/api-keys",
          "/contacts",
          "/domains",
          "/lists",
          "/sending-addresses",
          "/sends",
          "/webhooks",
          "/signin",
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
