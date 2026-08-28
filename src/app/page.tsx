import { createClient } from "@/lib/supabase/server";
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
 * The landing page had NO auth awareness at all: a signed-in user arriving
 * back at `/` saw the identical anonymous page as a stranger, including a hero
 * offering to tailor "a sample resume" and a footer of create-an-account CTAs.
 * (marketing-masthead.tsx describes itself in a comment as "the signed-out
 * landing page" — nothing enforced that, and this does not fix the masthead
 * either. It is threaded only as far as the demo, which is where sending the
 * wrong person down the anonymous path would actually cost something.)
 *
 * `getUser()` directly rather than `requireUser()` — that helper redirects,
 * which is exactly wrong here. A signed-in visitor is welcome on the marketing
 * page; they just should not be handed a stranger's demo.
 */
export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const isSignedIn = !!user;

  return (
    <>
      <MarketingMasthead />
      <HeroSection isSignedIn={isSignedIn} />
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
