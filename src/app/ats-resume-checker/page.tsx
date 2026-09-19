import type { Metadata } from "next";
import Link from "next/link";
import { pageMetadata } from "@/lib/seo/site";
import { MarketingMasthead } from "@/components/marketing/marketing-masthead";
import { MarketingFooter } from "@/components/marketing/marketing-footer";
import { ResumeToolCta } from "@/components/seo/resume-tool-cta";
import { Container, EyebrowLabel, BorderedCard } from "@/components/ui";

/**
 * send-386 — standalone SEO landing page for "ATS resume checker Nigeria"
 * and adjacent terms, the second of two new pages built for the same
 * uncontested-keyword gap /ai-resume-tailoring closes (see that page's own
 * header for the audit finding both share). This one leads with the ATS
 * SCORE step of the same JD-paste → gap analysis → tailored resume flow
 * (§6.3) rather than duplicating that page's own copy — cross-linked, not
 * near-duplicated (CLAUDE.md: "don't repeat the same sentence verbatim in
 * two sections").
 */
export const metadata: Metadata = pageMetadata({
  title: "Free ATS Resume Checker for Nigerian Job Seekers — Talentrah",
  description:
    "Check whether your resume would pass an applicant tracking system before you apply — Talentrah scores it against a real job description and shows exactly what to fix.",
  path: "/ats-resume-checker",
});

export default function AtsResumeCheckerPage() {
  return (
    <>
      <MarketingMasthead />
      <main id="main-content" className="py-20">
        <Container className="flex max-w-[820px] flex-col gap-14">
          <div className="flex flex-col gap-4">
            <EyebrowLabel>ATS resume checker</EyebrowLabel>
            <h1 className="font-display text-[36px] leading-[1.15]">
              Most resumes never reach a human. Find out if yours would.
            </h1>
            <p className="max-w-[620px] text-[16px] leading-[1.6] text-ink-soft">
              Large employers filter applications with an applicant tracking
              system (ATS) before anyone reads them. Talentrah checks your
              resume against a real job description and gives you a real
              score — with the specific fixes behind it, not just a number.
            </p>
            <div className="mt-2">
              <ResumeToolCta targetPath="/tailor" />
            </div>
          </div>

          <div className="flex flex-col gap-5 border-t border-line pt-10">
            <EyebrowLabel>What the score actually checks</EyebrowLabel>
            <ul className="grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2">
              <li>
                <BorderedCard className="flex h-full flex-col gap-1.5 p-4">
                  <h2 className="font-body text-[14.5px] font-semibold text-ink">Keyword and skill match</h2>
                  <p className="text-[13.5px] leading-[1.5] text-ink-soft">
                    Whether the specific skills and terms this job description
                    actually asks for show up in your resume — not a generic
                    keyword list.
                  </p>
                </BorderedCard>
              </li>
              <li>
                <BorderedCard className="flex h-full flex-col gap-1.5 p-4">
                  <h2 className="font-body text-[14.5px] font-semibold text-ink">Gaps you can still fix</h2>
                  <p className="text-[13.5px] leading-[1.5] text-ink-soft">
                    What the role asks for that your resume doesn&apos;t currently
                    show — before an employer&apos;s own filter quietly screens
                    you out for it.
                  </p>
                </BorderedCard>
              </li>
              <li>
                <BorderedCard className="flex h-full flex-col gap-1.5 p-4">
                  <h2 className="font-body text-[14.5px] font-semibold text-ink">Real requirements, not a checklist</h2>
                  <p className="text-[13.5px] leading-[1.5] text-ink-soft">
                    Farah reads the actual job description you paste in, not
                    a template of what a &ldquo;typical&rdquo; listing usually asks for.
                  </p>
                </BorderedCard>
              </li>
              <li>
                <BorderedCard className="flex h-full flex-col gap-1.5 p-4">
                  <h2 className="font-body text-[14.5px] font-semibold text-ink">A tailored resume to match</h2>
                  <p className="text-[13.5px] leading-[1.5] text-ink-soft">
                    The score comes with a rewritten resume and cover letter
                    aimed at this specific role, not just a diagnosis.
                  </p>
                </BorderedCard>
              </li>
            </ul>
          </div>

          <div className="flex flex-col gap-3 border-t border-line pt-10">
            <EyebrowLabel>Built for the Nigerian job market</EyebrowLabel>
            <p className="max-w-[640px] text-[15px] leading-[1.65] text-ink-soft">
              Most ATS checker tools are built around US and UK employers and
              their applicant tracking systems. Talentrah checks against the
              real postings Nigerian and African job seekers are actually
              applying to — the same matching engine behind Talentrah&apos;s job
              feed.
            </p>
          </div>

          <BorderedCard className="flex flex-col gap-3 p-8">
            <h2 className="font-display text-[20px] font-semibold">
              Ready to see your resume rewritten for a specific role?
            </h2>
            <p className="max-w-[560px] text-[14px] text-ink-soft">
              The ATS score above is one step inside Talentrah&apos;s full
              AI resume tailoring flow.
            </p>
            <Link
              href="/ai-resume-tailoring"
              className="w-fit text-[13.5px] font-semibold text-rust underline underline-offset-2"
            >
              See how AI resume tailoring works →
            </Link>
          </BorderedCard>
        </Container>
      </main>
      <MarketingFooter />
    </>
  );
}
