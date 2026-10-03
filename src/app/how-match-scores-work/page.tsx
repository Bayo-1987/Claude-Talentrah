import type { Metadata } from "next";
import Link from "next/link";
import { pageMetadata } from "@/lib/seo/site";
import { MarketingMasthead } from "@/components/marketing/marketing-masthead";
import { MarketingFooter } from "@/components/marketing/marketing-footer";
import { Container, EyebrowLabel, BorderedCard } from "@/components/ui";

/**
 * "How match scores work": the one place that says what a match score counts, what it does not count yet, and what "thin"
 * means. It replaces the "Industry alignment: Not yet measured" cell that used to repeat on every job card (S3-23a), so the
 * honesty about what is not measured is said once instead of on every card. Tier names and thresholds are the three real
 * ones in src/lib/match-tier.ts; keep this in step with docs/match-confidence-invariant.md.
 */
export const metadata: Metadata = pageMetadata({
  title: "How match scores work — Talentrah",
  description:
    "What a Talentrah match score counts (skill tags and seniority), what it does not count yet (industry), and what a thin match means.",
  path: "/how-match-scores-work",
});

export default function HowMatchScoresWorkPage() {
  return (
    <>
      <MarketingMasthead />
      <main id="main-content">
        <Container className="flex max-w-[760px] flex-col gap-8 py-12">
          <div>
            <EyebrowLabel>Match scores</EyebrowLabel>
            <h1 className="mt-2 font-display text-[34px] leading-[1.15] font-medium text-ink">How match scores work</h1>
            <p className="mt-3 text-[15px] text-ink-soft">
              A match score is a quick, cheap comparison of your resume with a job. It is a guide to where to look first, not a verdict.
            </p>
          </div>

          <BorderedCard className="flex flex-col gap-2 p-5">
            <EyebrowLabel size="sm">What is counted</EyebrowLabel>
            <p className="text-[14.5px] text-ink-soft">
              <strong className="text-ink">Skill tags.</strong> Each job lists the skills its text names. The score is how many of those skill tags
              your resume also lists. <strong className="text-ink">Seniority.</strong> Your latest job title is compared with the level the posting
              asks for, and a close match adds a little, a far one takes a little away. When a posting does not say its level, seniority is{" "}
              <strong className="text-ink">neutral</strong>: it neither adds to the score nor takes anything away, so an unstated level is not
              held against the job or against you.
            </p>
          </BorderedCard>

          <BorderedCard className="flex flex-col gap-2 p-5">
            <EyebrowLabel size="sm">What is not counted yet</EyebrowLabel>
            <p className="text-[14.5px] text-ink-soft">
              <strong className="text-ink">Industry.</strong> A score does not yet consider whether a job is in an industry you have worked in or
              want to work in. Treat a high score for a role far from your background with care.
            </p>
          </BorderedCard>

          <BorderedCard className="flex flex-col gap-2 p-5">
            <EyebrowLabel size="sm">What a &ldquo;thin match&rdquo; means</EyebrowLabel>
            <p className="text-[14.5px] text-ink-soft">
              Some jobs name only one or two skills. Covering both is easy and tells you little, so a thin match can score very high without much
              evidence behind it. A thin match is never shown as Excellent: it is capped at 79% and labelled &ldquo;thin match&rdquo;, and it is
              listed below jobs with more to go on.
            </p>
          </BorderedCard>

          <BorderedCard className="flex flex-col gap-2 p-5">
            <EyebrowLabel size="sm">The three tiers</EyebrowLabel>
            <p className="text-[14.5px] text-ink-soft">
              <strong className="text-ink">Excellent</strong> is 80% and above, <strong className="text-ink">Good</strong> is 70 to 79%, and{" "}
              <strong className="text-ink">Fair</strong> is 60 to 69%. Below 60% no tier is shown.
            </p>
          </BorderedCard>

          <p className="text-[14px] text-ink-soft">
            <Link href="/jobs" className="font-semibold text-rust underline underline-offset-2">
              Back to jobs
            </Link>
          </p>
        </Container>
      </main>
      <MarketingFooter />
    </>
  );
}
