import type { MetadataRoute } from "next";
import { absoluteUrl, SITE_ORIGIN } from "@/lib/seo/site";

/**
 * robots.txt.
 *
 * DISALLOW IS NOT A SECURITY CONTROL and nothing here is treated as one. Every
 * path below is already enforced server-side — `/admin` by the admin session
 * guard, the authenticated app routes by `requireUser` on each page, the API
 * by its own auth. This exists to stop crawlers WASTING their budget on URLs
 * that will only ever answer with a redirect, and to keep login and callback
 * pages out of the index. A path that were only protected by this line would
 * be public.
 *
 * `/jobs/` IS CRAWLABLE, deliberately and as the point of the change that
 * added this file: the detail page is public and carries JobPosting
 * structured data. `/jobs` itself — the authenticated feed — is not, hence
 * the trailing-slash distinction below.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/"],
        disallow: [
          "/admin",
          "/api/",
          // Authenticated app surfaces. Each already redirects; this just
          // stops the crawl budget being spent discovering that.
          "/auto-apply",
          "/billing",
          "/feedback",
          "/refer",
          "/resume-builder",
          "/scholarships",
          "/settings",
          "/tailor",
          "/tracker",
          "/onboarding",
          "/dashboard",
          // The feed itself needs a session; individual postings do not.
          "/jobs$",
          // Employer console. The public /employer landing page stays allowed
          // by the more specific rules above it.
          "/employer/campaigns",
          "/employer/jobs",
          "/employer/onboarding",
          "/employer/profile",
          // Auth and one-time flows: nothing to index, and some carry tokens.
          "/login",
          "/signup",
          "/forgot-password",
          "/reset-password",
          "/auth/",
          // Internal.
          "/dev/",
        ],
      },
    ],
    sitemap: absoluteUrl("/sitemap.xml"),
    host: SITE_ORIGIN,
  };
}
