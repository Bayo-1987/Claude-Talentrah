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
 * `/jobs/` AND `/scholarships/` ARE CRAWLABLE, deliberately: each detail page
 * is public and the feed/list behind it is not, hence the trailing-slash
 * distinction below on both. Scholarships followed the same move for the same
 * reason job postings did first (#152) — the catalog carries "fully funded
 * scholarships for Nigerians"-class search demand, and a blanket disallow on
 * `/scholarships` made every listing invisible to it. RLS is what actually
 * keeps a pending listing out (0084); this line only stops crawl budget being
 * spent discovering that the authenticated list route redirects.
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
          "/settings",
          "/tailor",
          "/tracker",
          "/onboarding",
          "/dashboard",
          // The feed and list themselves need a session; individual detail
          // pages do not.
          "/jobs$",
          "/scholarships$",
          /*
           * The whole employer surface, INCLUDING /employer itself.
           *
           * An earlier version of this file allowed /employer on the belief
           * that it was a public landing page. It is not: it is a redirect-only
           * route whose first act is `getEmployerContext()`, which calls
           * `requireUser()`. A signed-out visitor gets 307 -> /login, so there
           * is no page there to index and no title to give it — Next's redirect
           * boilerplate carries the root title, which is what made it look like
           * a real page from the outside.
           *
           * If a public "for employers" marketing page is ever built, it earns
           * its own Allow and its own title at that point.
           */
          "/employer",
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
