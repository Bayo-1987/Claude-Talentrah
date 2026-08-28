import { MarketingMasthead } from "@/components/marketing/marketing-masthead";
import { HeroSection } from "@/components/marketing/hero-section";
import { JobBoardPreview } from "@/components/marketing/job-board-preview";
import { ProblemSection } from "@/components/marketing/problem-section";
import { HowItWorksSection } from "@/components/marketing/how-it-works-section";
import { MeetFarahSection } from "@/components/marketing/meet-farah-section";
import { FaqSection } from "@/components/marketing/faq-section";
import { FinalCtaSection } from "@/components/marketing/final-cta-section";
import { MarketingFooter } from "@/components/marketing/marketing-footer";

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
 */
export default function Home() {
  return (
    <>
      <MarketingMasthead />
      <HeroSection />
      <JobBoardPreview />
      <ProblemSection />
      <HowItWorksSection />
      <MeetFarahSection />
      <FaqSection />
      <FinalCtaSection />
      <MarketingFooter />
    </>
  );
}
