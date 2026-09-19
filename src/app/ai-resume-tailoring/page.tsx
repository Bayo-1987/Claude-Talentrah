import type { Metadata } from "next";
import Link from "next/link";
import { pageMetadata } from "@/lib/seo/site";
import { MarketingMasthead } from "@/components/marketing/marketing-masthead";
import { MarketingFooter } from "@/components/marketing/marketing-footer";
import { ResumeToolCta } from "@/components/seo/resume-tool-cta";
import { Container, EyebrowLabel, BorderedCard } from "@/components/ui";

/**
 * send-386 — a standalone, hand-authored SEO landing page for "AI resume
 * tailoring Nigeria" and adjacent terms. Every AI resume tool the 2026-09-19
 * SEO audit found (Rezi, Kickresume, Teal, Resume.io, Jobscan) is US/UK-
 * oriented with zero Nigeria-specific content — genuinely uncontested
 * keyword demand for a capability Talentrah already ships (§6.3: JD-paste →
 * gap analysis → tailored resume + cover letter).
 *
 * NOT a replacement for the homepage's embedded JD-paste demo
 * (components/marketing/jd-demo-input.tsx) — that stays exactly as-is. This
 * is a separate page for search intent that lands here directly, not on the
 * homepage, and its own copy is written to not read as a near-duplicate of
 * the homepage's (CLAUDE.md: "don't repeat the same sentence verbatim in two
 * sections").
 */
export const metadata: Metadata = pageMetadata({
  title: "AI Resume Tailoring for Nigerian Job Seekers — Talentrah",
  description:
    "Paste any job description and Talentrah's AI shows exactly what's matched and missing, then rewrites your resume and cover letter to fit — built for job seekers in Nigeria and across Africa.",
  path: "/ai-resume-tailoring",
});

export default function AiResumeTailoringPage() {
  return (
    <>
      <MarketingMasthead />
      <main id="main-content" className="py-20">
        <Container className="flex max-w-[820px] flex-col gap-14">
          <div className="flex flex-col gap-4">
            <EyebrowLabel>AI resume tailoring</EyebrowLabel>
            <h1 className="font-display text-[36px] leading-[1.15]">
              Stop sending the same resume to every job.
            </h1>
            <p className="max-w-[620px] text-[16px] leading-[1.6] text-ink-soft">
              A generic resume gets skipped by both the software that screens
              it first and the person who reads it after. Paste a job
              description and Talentrah&apos;s AI rewrites your resume — and your
              cover letter — to actually fit the role, built for the job
              market in Nigeria and across Africa.
            </p>
            <div className="mt-2">
              <ResumeToolCta targetPath="/tailor" />
            </div>
          </div>

          <div className="flex flex-col gap-6 border-t border-line pt-10">
            <EyebrowLabel>How it works</EyebrowLabel>
            <div className="grid gap-5 sm:grid-cols-3">
              <BorderedCard className="flex flex-col gap-2 p-5">
                <span className="font-display text-[22px] text-rust">1</span>
                <h2 className="font-display text-[17px] font-semibold">Paste the job description</h2>
                <p className="text-[13.5px] leading-[1.55] text-ink-soft">
                  A link or the full text — whatever you have. No manual
                  re-typing of requirements.
                </p>
              </BorderedCard>
              <BorderedCard className="flex flex-col gap-2 p-5">
                <span className="font-display text-[22px] text-rust">2</span>
                <h2 className="font-display text-[17px] font-semibold">See what&apos;s matched and missing</h2>
                <p className="text-[13.5px] leading-[1.55] text-ink-soft">
                  Farah reads the real requirements against your actual
                  experience — not a generic checklist — and shows you the
                  gap before you send anything.
                </p>
              </BorderedCard>
              <BorderedCard className="flex flex-col gap-2 p-5">
                <span className="font-display text-[22px] text-rust">3</span>
                <h2 className="font-display text-[17px] font-semibold">Get a tailored resume + cover letter</h2>
                <p className="text-[13.5px] leading-[1.55] text-ink-soft">
                  Rewritten to fit this specific role, with an ATS score and
                  the specific fixes behind it — not just a number.
                </p>
              </BorderedCard>
            </div>
          </div>

          <div className="flex flex-col gap-3 border-t border-line pt-10">
            <EyebrowLabel>Built for the Nigerian job market</EyebrowLabel>
            <p className="max-w-[640px] text-[15px] leading-[1.65] text-ink-soft">
              Most AI resume tools are built around US and UK hiring norms.
              Talentrah is built around the roles, companies and applicant
              tracking systems Nigerian and African job seekers actually
              encounter — the same matching and tailoring engine behind
              Talentrah&apos;s job feed.
            </p>
          </div>

          <BorderedCard className="flex flex-col gap-3 p-8">
            <h2 className="font-display text-[20px] font-semibold">
              Curious whether your resume would survive an ATS filter first?
            </h2>
            <p className="max-w-[560px] text-[14px] text-ink-soft">
              The ATS score is part of the same tailoring flow above — see
              what it actually checks for.
            </p>
            <Link
              href="/ats-resume-checker"
              className="w-fit text-[13.5px] font-semibold text-rust underline underline-offset-2"
            >
              Read about the ATS resume checker →
            </Link>
          </BorderedCard>
        </Container>
      </main>
      <MarketingFooter />
    </>
  );
}
