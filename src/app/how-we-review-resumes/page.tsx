import type { Metadata } from "next";
import Link from "next/link";
import { pageMetadata } from "@/lib/seo/site";
import { MarketingMasthead } from "@/components/marketing/marketing-masthead";
import { MarketingFooter } from "@/components/marketing/marketing-footer";
import { Container, EyebrowLabel, BorderedCard } from "@/components/ui";

/**
 * "How we review resumes" (VERIFY-1 Phase 0a): the one page that says what a Talent Directory resume review checks today and what it does not. The badge on a
 * candidate says who reviewed the resume and on what date; "What this means" under it links here. Plain words, no figures, no promises about checks that do
 * not exist: if a real check is ever added (identity, employment), this page and the badge change together, and not before.
 * tests/talent-directory/how-we-review-page.test.tsx keeps it free of figures and of the word "verified".
 */
export const metadata: Metadata = pageMetadata({
  title: "How we review resumes — Talentrah",
  description: "What a Talentrah resume review checks (that a resume is complete, specific and consistent) and what it does not check (identity, employment history, skills).",
  path: "/how-we-review-resumes",
});

export default function HowWeReviewResumesPage() {
  return (
    <>
      <MarketingMasthead />
      <main id="main-content">
        <Container className="flex max-w-[760px] flex-col gap-8 py-12">
          <div>
            <EyebrowLabel>Resume reviews</EyebrowLabel>
            <h1 className="mt-2 font-display text-[34px] leading-[1.15] font-medium text-ink">How we review resumes</h1>
            <p className="mt-3 text-[15px] text-ink-soft">
              Some candidates in the Talent Directory, and some applicants, carry a note that their resume was reviewed. This page says what that review is, and what it is not.
            </p>
          </div>

          <BorderedCard className="flex flex-col gap-2 p-5">
            <EyebrowLabel size="sm">What is checked</EyebrowLabel>
            <p className="text-[14.5px] text-ink-soft">
              A reviewer reads the resume and checks three things. <strong className="text-ink">Complete:</strong> the main sections are there and filled in.{" "}
              <strong className="text-ink">Specific:</strong> the roles and results say what was actually done, not only general claims.{" "}
              <strong className="text-ink">Consistent:</strong> dates, titles and details do not contradict each other.
            </p>
          </BorderedCard>

          <BorderedCard className="flex flex-col gap-2 p-5">
            <EyebrowLabel size="sm">What is not checked</EyebrowLabel>
            <p className="text-[14.5px] text-ink-soft">
              We did not check who the person is. We did not contact past employers or confirm that anyone worked where their resume says. We did not test their skills. A
              resume review does not confirm any of these. If one of them matters for a role, check it yourself, as you would with any resume.
            </p>
          </BorderedCard>

          <BorderedCard className="flex flex-col gap-2 p-5">
            <EyebrowLabel size="sm">Who reviews</EyebrowLabel>
            <p className="text-[14.5px] text-ink-soft">
              <strong className="text-ink">Resume reviewed by Farah (AI).</strong> Farah, Talentrah&rsquo;s AI assistant, reads the resume and gives it a score, which only the
              person who asked for the review sees. Employers do not see it. <strong className="text-ink">Resume reviewed by a Talentrah mentor.</strong> A mentor
              approved on Talentrah reads the resume and decides whether it holds up. A mentor review has no score.
            </p>
          </BorderedCard>

          <BorderedCard className="flex flex-col gap-2 p-5">
            <EyebrowLabel size="sm">What the note shows</EyebrowLabel>
            <p className="text-[14.5px] text-ink-soft">
              It says who reviewed the resume and on what date. It is not a ranking and it is not a recommendation of the person. The review is of the resume as it was
              on that date: a resume that has changed since has not been reviewed again.
            </p>
          </BorderedCard>

          <p className="text-[14px] text-ink-soft">
            Questions about a review?{" "}
            <Link href="/contact" className="font-semibold text-rust underline underline-offset-2">
              Contact us
            </Link>
            .
          </p>
        </Container>
      </main>
      <MarketingFooter />
    </>
  );
}
