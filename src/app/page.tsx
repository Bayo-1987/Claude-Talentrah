import { MarketingMasthead } from "@/components/marketing/marketing-masthead";
import { HeroSection } from "@/components/marketing/hero-section";
import { JobBoardPreview } from "@/components/marketing/job-board-preview";
import { ProblemSection } from "@/components/marketing/problem-section";
import { HowItWorksSection } from "@/components/marketing/how-it-works-section";
import { MeetFarahSection } from "@/components/marketing/meet-farah-section";
import { FaqSection } from "@/components/marketing/faq-section";
import { FinalCtaSection } from "@/components/marketing/final-cta-section";
import { MarketingFooter } from "@/components/marketing/marketing-footer";

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
