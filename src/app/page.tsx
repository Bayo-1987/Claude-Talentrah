import type { Metadata } from "next";
import { JsonLd } from "@/components/seo/json-ld";
import { buildOrganizationJsonLd, buildWebSiteJsonLd } from "@/lib/seo/organization-jsonld";
import { MarketingMasthead } from "@/components/marketing/marketing-masthead";
import { GoogleOneTap } from "@/components/auth/google-one-tap";
import { HeroSection } from "@/components/marketing/hero-section";
import { JobBoardPreview } from "@/components/marketing/job-board-preview";
import { ProblemSection } from "@/components/marketing/problem-section";
import { HowItWorksSection } from "@/components/marketing/how-it-works-section";
import { MeetFarahSection } from "@/components/marketing/meet-farah-section";
import { FaqSection } from "@/components/marketing/faq-section";
import { FinalCtaSection } from "@/components/marketing/final-cta-section";
import { MarketingFooter } from "@/components/marketing/marketing-footer";
import { MarketingStickyCta } from "@/components/marketing/marketing-sticky-cta";
import { pageMetadata } from "@/lib/seo/site";

/**
 * The one page in this codebase that had no metadata export at all — every
 * other major page (37+, per layout.tsx's own comment on why title is a
 * plain string, not a template) writes its own title via pageMetadata(), so
 * the homepage silently inheriting the root layout's generic "Talentrah" /
 * "AI-powered career platform for job seekers in Nigeria and across Africa"
 * was backwards: it's the page most backlinks and brand searches land on.
 *
 * FOUNDER-REVIEWED 2026-09-18: the audit's original draft put the "Nigeria &
 * Africa" positioning in the title itself, on the theory that the title is
 * the tag most likely to get quoted back in a search result. The founder's
 * call was to keep the title short and let the description carry the
 * geography instead — description still names Nigeria and Africa explicitly,
 * this is a title-length decision, not a retreat from the positioning.
 */
export const metadata: Metadata = pageMetadata({
  title: "AI Job Search Copilot — Talentrah",
  description:
    "Talentrah matches you to real jobs across Nigeria and Africa, tailors your resume and cover letter with AI, and preps you for interviews — free to start.",
  path: "/",
});

/**
 * The marketing homepage — statically rendered, for everyone.
 *
 * IT USED TO BE DYNAMIC, AND FOR ONE BOOLEAN. This component called
 * `supabase.auth.getUser()` to work out whether the visitor was signed in, and
 * reading the auth cookie in a Server Component opts the WHOLE ROUTE into
 * dynamic rendering — not the component that read it. So every stranger who
 * ever landed here paid a full server render of the problem section, the board
 * preview, how-it-works, Farah, the FAQ, the final CTA and the footer, none of
 * which touch a database or care who is looking. Production answered with
 * `cache-control: private, no-cache, no-store, max-age=0, must-revalidate`.
 *
 * The flag's only consumer was already a client component, so it moved there.
 * See jd-demo-input.tsx — this page no longer knows or needs to know.
 *
 * WHAT WAS CONSIDERED AND NOT DONE. Next 16 has Cache Components, which is the
 * framework's own answer: a static shell with the dynamic slice streamed into
 * a Suspense boundary. It is the better mechanism in the abstract and the
 * wrong trade here — `cacheComponents: true` is project-wide, and every
 * authenticated route in this app currently relies on being dynamic by
 * default. Turning it on to fix a caption on the landing page would put /jobs,
 * /tracker and the employer surface in scope of the change. Worth doing
 * deliberately, on its own, with those routes audited; not as a side effect.
 *
 * GoogleOneTap does not reopen that problem: it's a Client Component that
 * checks auth state and fetches its nonce in the browser after mount, so it
 * adds nothing for the server to read at render time. It renders `null` and
 * decides for itself, client-side, whether this particular visitor is
 * signed out — the same "flag decided in the client" shape as the JD demo
 * input this comment already describes.
 *
 * MarketingStickyCta (the mobile "Get started for free" bar) follows the
 * exact same shape for the exact same reason: it needs to hide itself for a
 * signed-in visitor, and since nothing on this page already knows that
 * answer, it does its own client-side `getSession()` check rather than the
 * page doing one server-side. See that component's own comment.
 */
export default function Home() {
  return (
    <>
      <JsonLd data={buildOrganizationJsonLd()} />
      <JsonLd data={buildWebSiteJsonLd()} />
      <MarketingMasthead />
      <GoogleOneTap />
      <main id="main-content">
        <HeroSection />
        <JobBoardPreview />
        <ProblemSection />
        <HowItWorksSection />
        <MeetFarahSection />
        <FaqSection />
        <FinalCtaSection />
      </main>
      <MarketingFooter />
      <MarketingStickyCta />
    </>
  );
}
