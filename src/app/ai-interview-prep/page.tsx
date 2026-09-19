import type { Metadata } from "next";
import Link from "next/link";
import { pageMetadata } from "@/lib/seo/site";
import { MarketingMasthead } from "@/components/marketing/marketing-masthead";
import { MarketingFooter } from "@/components/marketing/marketing-footer";
import { FarahInterviewPrepCta } from "@/components/seo/farah-interview-prep-cta";
import { Container, EyebrowLabel, BorderedCard } from "@/components/ui";

/**
 * Standalone SEO landing page for "AI interview prep Nigeria" and adjacent
 * terms — same uncontested-keyword gap the other four /ai-*, /ats-*, and
 * /how-* pages close, for Farah's "Job Interview Prep" quick action
 * specifically (src/lib/farah/quick-actions.ts). That action is chat-only
 * (`href: null`, a starter prompt into the docked panel) with no dedicated
 * route to deep-link into — so this page's CTA is honest about the actual
 * mechanism (sign up, then ask Farah from wherever the panel is docked)
 * rather than implying a standalone interview-prep tool that doesn't exist.
 *
 * Free-tier copy deliberately does NOT quote FARAH_CHAT_FREE_ALLOWANCE's
 * exact number — same "don't invent the exact size of the free allowance"
 * discipline docs/auto-apply.md's own public-facing copy already follows,
 * so this doesn't go stale the next time that constant is retuned.
 */
export const metadata: Metadata = pageMetadata({
  title: "Free AI Interview Prep for Nigerian Job Seekers — Talentrah",
  description:
    "Practice interview answers, get talking points, and prep for a specific role with Farah, Talentrah's AI copilot — built for job seekers in Nigeria and across Africa.",
  path: "/ai-interview-prep",
});

export default function AiInterviewPrepPage() {
  return (
    <>
      <MarketingMasthead />
      <main id="main-content" className="py-20">
        <Container className="flex max-w-[820px] flex-col gap-14">
          <div className="flex flex-col gap-4">
            <EyebrowLabel>AI interview prep</EyebrowLabel>
            <h1 className="font-display text-[36px] leading-[1.15]">
              Walk into the interview having already thought it through.
            </h1>
            <p className="max-w-[620px] text-[16px] leading-[1.6] text-ink-soft">
              Farah is the AI copilot behind every match, tailored resume,
              and interview-prep session on Talentrah. Ask her to help you
              prepare for a specific interview and she&apos;ll work through
              likely questions, talking points, and how to frame your own
              experience — in a real conversation, not a canned script.
            </p>
            <div className="mt-2">
              <FarahInterviewPrepCta />
            </div>
          </div>

          <div className="flex flex-col gap-5 border-t border-line pt-10">
            <EyebrowLabel>What Farah helps with</EyebrowLabel>
            <ul className="grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2">
              <li>
                <BorderedCard className="flex h-full flex-col gap-1.5 p-4">
                  <h2 className="font-body text-[14.5px] font-semibold text-ink">
                    Likely questions for the role
                  </h2>
                  <p className="text-[13.5px] leading-[1.5] text-ink-soft">
                    Talk through the kind of questions a specific role and
                    seniority level tend to raise, not a generic list of
                    &ldquo;top 10 interview questions.&rdquo;
                  </p>
                </BorderedCard>
              </li>
              <li>
                <BorderedCard className="flex h-full flex-col gap-1.5 p-4">
                  <h2 className="font-body text-[14.5px] font-semibold text-ink">
                    Framing your own experience
                  </h2>
                  <p className="text-[13.5px] leading-[1.5] text-ink-soft">
                    Work through how to talk about what you&apos;ve actually
                    done — Farah never invents experience you don&apos;t
                    have.
                  </p>
                </BorderedCard>
              </li>
              <li>
                <BorderedCard className="flex h-full flex-col gap-1.5 p-4">
                  <h2 className="font-body text-[14.5px] font-semibold text-ink">
                    Salary conversation talking points
                  </h2>
                  <p className="text-[13.5px] leading-[1.5] text-ink-soft">
                    Practice how to ask, how to justify a number you bring,
                    and how to handle a lowball — without Farah inventing a
                    market-rate figure she doesn&apos;t actually have.
                  </p>
                </BorderedCard>
              </li>
              <li>
                <BorderedCard className="flex h-full flex-col gap-1.5 p-4">
                  <h2 className="font-body text-[14.5px] font-semibold text-ink">
                    Knowing when to bring in a person
                  </h2>
                  <p className="text-[13.5px] leading-[1.5] text-ink-soft">
                    For a real offer or a final-round interview, Farah will
                    say plainly that a human is the better call and connect
                    you with a real mentor.
                  </p>
                </BorderedCard>
              </li>
            </ul>
          </div>

          <div className="flex flex-col gap-3 border-t border-line pt-10">
            <EyebrowLabel>Built for the Nigerian job market</EyebrowLabel>
            <p className="max-w-[640px] text-[15px] leading-[1.65] text-ink-soft">
              Farah is the same copilot behind Talentrah&apos;s job matching
              and resume tailoring — built around the roles and employers
              Nigerian and African job seekers actually interview with, not
              a US-market chatbot with a Nigeria-flavored prompt bolted on.
            </p>
          </div>

          <BorderedCard className="flex flex-col gap-3 p-8">
            <h2 className="font-display text-[20px] font-semibold">
              Want a real person for the interview that actually matters?
            </h2>
            <p className="max-w-[560px] text-[14px] text-ink-soft">
              For a mock interview with live feedback ahead of a final round,
              book a real mentor — Farah is the on-ramp to that, not a
              replacement for it.
            </p>
            <Link
              href="/mentorship"
              className="w-fit text-[13.5px] font-semibold text-rust underline underline-offset-2"
            >
              Find a mentor →
            </Link>
          </BorderedCard>
        </Container>
      </main>
      <MarketingFooter />
    </>
  );
}
