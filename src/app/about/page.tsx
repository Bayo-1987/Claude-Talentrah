import type { Metadata } from "next";
import { MarketingMasthead } from "@/components/marketing/marketing-masthead";
import { MarketingFooter } from "@/components/marketing/marketing-footer";
import { Container, EyebrowLabel } from "@/components/ui";

export const metadata: Metadata = {
  title: "About — Talentrah",
  description: "What Talentrah is, and why it&apos;s built the way it&apos;s built.",
};

/**
 * Deliberately no founding-story/team-bio content below — this spec (§6.1)
 * is built around not claiming things Talentrah hasn&apos;t earned, and an
 * invented founder narrative would violate that same principle. Swap in
 * real team/founding details here once there&apos;s something real to say;
 * until then the page stays honest about what it actually is: a product
 * and a set of commitments.
 */
export default function AboutPage() {
  return (
    <>
      <MarketingMasthead />
      <div className="py-20">
        <Container className="flex max-w-[760px] flex-col gap-14">
          <div className="flex flex-col gap-4">
            <EyebrowLabel>About</EyebrowLabel>
            <h1 className="text-[36px] leading-[1.2]">
              Built for job seekers in Nigeria and across Africa.
            </h1>
            <p className="text-[16px] text-ink-soft">
              Talentrah is an AI-powered career platform: job matching, resume
              tailoring, and an AI copilot — Farah — that helps you understand
              how well you actually fit a role before you apply, not after
              you&apos;ve been rejected.
            </p>
          </div>

          <div className="flex flex-col gap-4 border-t border-line pt-10">
            <h2 className="text-[22px]">What we believe</h2>
            <p className="text-[15px] text-ink-soft">
              Job search is already stressful enough without guesswork. Farah&apos;s
              match scores, gap analysis, and tailoring suggestions are meant
              to replace that guesswork with something concrete — a clear
              read on where you stand and what would actually move the
              needle, not a black box.
            </p>
            <p className="text-[15px] text-ink-soft">
              We&apos;d rather show you nothing than show you something we can&apos;t
              back up. If a number or a claim appears on Talentrah, it&apos;s real
              — not a placeholder stat dressed up to look like social proof.
            </p>
          </div>

          <div className="flex flex-col gap-4 border-t border-line pt-10">
            <h2 className="text-[22px]">Where Farah fits — and where she doesn&apos;t</h2>
            <p className="text-[15px] text-ink-soft">
              Farah handles the day-to-day: matching, tailoring, coaching. When
              the stakes are highest — negotiating an offer, prepping for a
              final round — she hands you off to a real mentor who&apos;s actually
              done it before. AI gets you further, faster, on the parts it&apos;s
              good at; it steps aside for the parts it isn&apos;t.
            </p>
          </div>

          <div className="flex flex-col gap-4 border-t border-line pt-10">
            <h2 className="text-[22px]">For employers too</h2>
            <p className="text-[15px] text-ink-soft">
              Talentrah isn&apos;t only a seeker-facing product — organizations can
              post roles directly, advertise, or work with our team on
              recruitment and staffing. See{" "}
              <a href="/contact" className="text-rust underline underline-offset-2">
                Business Services
              </a>{" "}
              for more.
            </p>
          </div>
        </Container>
      </div>
      <MarketingFooter />
    </>
  );
}
