import type { MetadataRoute } from "next";
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      // Crawlers must be able to fetch public pages to read their noindex.
      allow: "/",
      disallow: ["/admin", "/api/", "/*?preview=1", "/*&preview=1"],
    },
    ...(process.env.SITE_URL
      ? { sitemap: new URL("/sitemap.xml", process.env.SITE_URL).toString() }
      : {}),
  };
}
