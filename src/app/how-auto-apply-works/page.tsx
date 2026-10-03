import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { pageMetadata } from "@/lib/seo/site";
import { buildQuestions } from "./questions";
import { MarketingMasthead } from "@/components/marketing/marketing-masthead";
import { MarketingFooter } from "@/components/marketing/marketing-footer";
import { Container, EyebrowLabel, BorderedCard, buttonClasses } from "@/components/ui";

/**
 * send-387 Part 2 — a short, plain-prose explainer for Auto-Apply, a real
 * differentiator (CLAUDE.md: "positioned as a trust/quality feature —
 * review-before-submit default, conservative match threshold — not a
 * spam-driving volume feature") with no public-facing SEO content before
 * this page.
 *
 * ── NO FAQPage STRUCTURED DATA, DELIBERATELY ───────────────────────────────
 *
 * Same non-decision as faq-section.tsx's own header comment: Google narrowed
 * FAQ rich results to "well-known, authoritative government and health
 * websites" in September 2023 and removed the feature's documentation
 * entirely in June 2026. Markup here would render nothing in search while
 * still costing bytes on this project's low-end-Android/expensive-data
 * budget. The content below reads as questions and answers because that is
 * genuinely what a visitor wants to know before signing up — not because it
 * is meant to be marked up as one.
 *
 * ── EVERY MECHANICS CLAIM BELOW IS CHECKED AGAINST docs/auto-apply.md ──────
 *
 * Read line by line before writing this, not from memory of the feature:
 * - Review-before-submit, no silent mode: "nothing is ever sent without a
 *   confirmation click. There is no 'silent mode' and no setting that
 *   creates one."
 * - Threshold re-read live, not from the queue snapshot: enforced in
 *   auto_apply_claim_submission "by re-reading match_scores live at confirm
 *   time, not from the snapshot on the queue row" — so this page says the
 *   check happens again at confirmation, and deliberately does not say or
 *   imply the score is fixed once a job is queued.
 * - External postings are handed off, never submitted: "Auto-Apply never
 *   submits to external postings — there is no ATS integration" (CLAUDE.md);
 *   confirming an external match "hands off... opens in a new tab, and it is
 *   saved to the tracker as 'saved'... deliberately not marked applied"
 *   (docs/auto-apply.md). Get this one right — it's a real product boundary.
 * - Caps exist (daily submission cap, queue cap) and are enforced
 *   server-side/atomically. The questions (./questions.tsx) state the numbers,
 *   rendered from src/lib/auto-apply/config.ts, so retuning a constant changes
 *   this page too (S1-26 item 2).
 * - Free-then-credits framing matches CLAUDE.md §6.9 exactly: "a free
 *   weekly allowance" then Credits — not an open-ended free claim.
 */
export const metadata: Metadata = pageMetadata({
  title: "How Auto-Apply Works — Talentrah",
  description:
    "Auto-Apply queues your highest-scoring job matches and waits for you to confirm before anything is submitted. Here's exactly what it does, what it never does, and how external postings are handled.",
  path: "/how-auto-apply-works",
});


export default function HowAutoApplyWorksPage() {
  return (
    <>
      <MarketingMasthead />
      <main id="main-content" className="py-20">
        <Container className="flex max-w-[820px] flex-col gap-14">
          <div className="flex flex-col gap-4">
            <EyebrowLabel>How Auto-Apply works</EyebrowLabel>
            <h1 className="font-display text-[36px] leading-[1.15]">
              It reviews matches for you. It never submits without your say-so.
            </h1>
            <p className="max-w-[620px] text-[16px] leading-[1.6] text-ink-soft">
              Auto-Apply is built as a trust feature, not a volume feature: a
              conservative match threshold, a review queue instead of a
              submit button, and a hard line between a job Talentrah can
              actually apply to and one it can only hand you a link for.
            </p>
          </div>

          <div className="flex flex-col border-t border-line">
            {buildQuestions().map((item) => (
              <div key={item.q} className="flex flex-col gap-3 border-b border-line py-8 min-[901px]:flex-row min-[901px]:gap-10">
                <h2 className="text-[17px] font-semibold text-ink min-[901px]:w-72 min-[901px]:flex-shrink-0">
                  {item.q}
                </h2>
                <p className="flex-1 text-[14.5px] leading-[1.6] text-ink-soft">{item.a}</p>
              </div>
            ))}
          </div>

          <BorderedCard className="flex flex-col gap-3 p-8">
            <h2 className="font-display text-[20px] font-semibold">
              See it working on your own matches
            </h2>
            <p className="max-w-[560px] text-[14px] text-ink-soft">
              Create a free account, upload your resume, and turn Auto-Apply
              on from your job feed whenever you&apos;re ready.
            </p>
            <Link
              href="/signup?redirectTo=%2Fjobs"
              className={buttonClasses("primary", "md", "no-underline w-fit")}
            >
              Create a free account
            </Link>
          </BorderedCard>
        </Container>
      </main>
      <MarketingFooter />
    </>
  );
}
