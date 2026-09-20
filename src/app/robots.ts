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
          /*
           * send-407 — same class of gap /mentorship's own sub-routes had
           * (send-385, this file's own comment below): a seeker-nav-linked
           * (masthead.tsx's NAV_LINKS, "Get Verified") route whose own
           * page.tsx calls requireUser(), crawlable and unblocked, serving a
           * generic login redirect to anything that fetched it. Checked
           * every other requireUser()-gated page.tsx against this file
           * systematically while finding this one — it was the only gap;
           * every other gated route (auto-apply, billing, feedback, refer,
           * resume-builder incl. its /edit and /new, settings, tailor,
           * tracker incl. its /[applicationId]/sent, onboarding,
           * employer/onboarding — covered by the blanket /employer entry
           * below) already has a matching disallow.
           */
          "/talent-directory/verify",
          // The feed and list themselves need a session; individual detail
          // pages do not.
          "/jobs$",
          "/scholarships$",
          /*
           * send-385 — the INVERSE of the /jobs$/scholarships$ shape above:
           * `/mentorship` itself is now the real, signed-out-visitor public
           * page (components/mentorship/public-landing.tsx), so it must stay
           * OFF this list — but every sub-route still needs a session and was
           * found, while investigating this send, to have the exact same
           * "crawlable, unblocked, serves a generic login redirect" gap the
           * SEO audit flagged for /mentorship itself: [mentorId], apply,
           * book/callback, reviews(/[verificationId]), sessions(/mentor). A
           * trailing-slash, non-anchored prefix disallow catches all of them
           * in one line while leaving the bare /mentorship path untouched.
           */
          "/mentorship/",
          /*
           * The employer DASHBOARD surface — everything under /employer
           * except the bare path itself.
           *
           * send-350 — `/employer` (bare) is now a real, public "for
           * employers" marketing page (components/employer/employer-public-
           * landing.tsx) rather than the redirect-only route it used to be,
           * so it comes OFF this list — the exact "if a public marketing
           * page is ever built, it earns its own Allow" this comment used to
           * anticipate. Every sub-route below still requires a session
           * (`requireEmployer()` or, for onboarding, `requireUser()`,
           * checked directly in each page — see employer/layout.tsx's own
           * comment for why the layout itself no longer forces this) and
           * stays disallowed for the same "don't waste crawl budget
           * discovering a redirect" reason as ever.
           *
           * /employer/analytics, /employer/talent-directory and
           * /employer/claim are ALSO requireEmployer()-gated
           * (confirmed by reading each page directly) but were never added
           * here — found while touching this exact block for send-350, the
           * same "crawlable, unblocked, serves a generic login redirect"
           * shape send-385 already fixed for /mentorship's own sub-routes.
           */
          "/employer/campaigns",
          "/employer/jobs",
          "/employer/onboarding",
          "/employer/profile",
          "/employer/analytics",
          "/employer/talent-directory",
          "/employer/claim",
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
