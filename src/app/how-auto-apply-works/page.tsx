import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { pageMetadata } from "@/lib/seo/site";
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
 *   server-side/atomically — described here only qualitatively ("a daily
 *   limit", "a cap on the queue"), not with the exact numbers in
 *   src/lib/auto-apply/config.ts, so this page doesn't go stale the moment
 *   those constants are retuned.
 * - Free-then-credits framing matches CLAUDE.md §6.9 exactly: "a free
 *   weekly allowance" then Credits — not an open-ended free claim.
 */
export const metadata: Metadata = pageMetadata({
  title: "How Auto-Apply Works — Talentrah",
  description:
    "Auto-Apply queues your highest-scoring job matches and waits for you to confirm before anything is submitted. Here's exactly what it does, what it never does, and how external postings are handled.",
  path: "/how-auto-apply-works",
});

const QUESTIONS: { q: string; a: ReactNode }[] = [
  {
    q: "What does Auto-Apply actually do?",
    a: (
      <>
        Turn it on from your job feed, and Auto-Apply watches for postings that
        score <strong>Excellent</strong> against your resume — Talentrah&apos;s
        highest match tier — and adds each one to a review queue. Nothing is
        submitted the moment it&apos;s queued; it just waits there for you.
      </>
    ),
  },
  {
    q: "Does it ever apply without asking me first?",
    a: "No. There's no silent mode, and no setting that creates one. Every match sits in your queue until you personally confirm it — the toggle turns matching on, not submitting.",
  },
  {
    q: "What happens when I confirm a match?",
    a: (
      <>
        It depends on where the job lives. For a job posted directly on
        Talentrah, confirming genuinely submits your application — Talentrah
        owns that posting, so a real application is created and lands in your
        Job Tracker as applied. For a job Talentrah found elsewhere (an
        aggregated, external listing), there&apos;s no way to submit into that
        employer&apos;s own system — confirming opens the original posting for
        you to apply on their site, and saves it to your Job Tracker so you
        don&apos;t lose track of it. It&apos;s never marked as applied on your
        behalf, because nothing was actually submitted — you were only handed
        the link.
      </>
    ),
  },
  {
    q: "Could it submit to a job whose match score has changed since it was queued?",
    a: "No — the match is checked again at the moment you confirm, not just when it first joined the queue. If a score has slipped, or the posting has closed in the meantime, confirming won't submit it.",
  },
  {
    q: "What stops it from submitting to everything?",
    a: "Two limits, both enforced automatically and not adjustable from the toggle: a daily cap on how many applications it will submit for you, and a cap on how many matches can sit in the queue waiting for your review. Once the queue is full, Auto-Apply stops adding new matches until you clear some out.",
  },
  {
    q: "Does it cost anything?",
    a: "Confirming a match on a Talentrah-hosted posting draws from a free weekly allowance; once that's used up, each one costs credits, the same way Talentrah's other AI actions do. Opening an external posting Auto-Apply found for you is always free and never counted against any cap — Talentrah isn't the one submitting it.",
  },
  {
    q: "Can I see what it's done?",
    a: "Yes — every match Auto-Apply queues, submits, hands off, or skips shows up in your Auto-Apply queue, with what happened and when. Nothing happens off the record.",
  },
];

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
            {QUESTIONS.map((item) => (
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
