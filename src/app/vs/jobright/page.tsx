import type { Metadata } from "next";
import Link from "next/link";
import { pageMetadata } from "@/lib/seo/site";
import { MarketingMasthead } from "@/components/marketing/marketing-masthead";
import { MarketingFooter } from "@/components/marketing/marketing-footer";
import { Container, EyebrowLabel, BorderedCard, buttonClasses } from "@/components/ui";

/**
 * send-461 — comparison/alternative-seeking SEO content, the free half of
 * the founder's "show up more when people search competitor-adjacent terms"
 * goal (the paid half, competitor-keyword SEM bidding, is a separate
 * decision — no ad connector, no budget approved). This ranks for phrases
 * like "jobright alternative nigeria," not the bare "Jobright" brand term —
 * displacing a company's own site from its own branded search result
 * doesn't happen from content alone.
 *
 * ── EVERY JOBRIGHT CLAIM BELOW TRACES TO A SOURCE VERIFIED 2026-09-26 ──────
 *
 * - US-only, no workaround from outside the US: a third-party review
 *   (zplatform.ai) states Jobright "built around the American market,"
 *   defaults to US listings/salary data, has a dedicated H-1B visa filter,
 *   and returns nothing usable for searches from the UK, Europe, or India.
 *   Jobright said in June 2025 it would expand globally; as of this
 *   verification no countries or dates have been announced, and there is no
 *   Nigeria or Africa coverage today. Cited to Jobright directly (jobright.ai)
 *   for what it IS, and to the review for what it does NOT do — Jobright's
 *   own site doesn't state the negative.
 * - Reported pricing ($17.99/week, $39.99/month, $89.99/quarter for
 *   "Turbo") comes from third-party reviews (zplatform.ai, outapply.com),
 *   NOT a Jobright-published pricing page — labelled "reported" throughout,
 *   never presented as Jobright's own number.
 * - Feature list (AI Agent / "90% Job Search Automation," Resume AI
 *   Builder, AI Job Matching, Auto-Apply, interview prep, cover letters,
 *   job tracking, referral networking) is first-party, from
 *   jobright.ai/ai-agent.
 * - No claim appears here about anything Jobright's own sources didn't
 *   state — scholarships and mentorship aren't mentioned anywhere in
 *   Jobright's own material, so the table below states that plainly rather
 *   than inferring a permanent gap.
 *
 * Talentrah's own figures (NGN pricing, free weekly Auto-Apply allowance,
 * template/tailoring free tier) are pulled from src/lib/billing/catalog.ts,
 * docs/auto-apply.md, and billing/page.tsx's own copy — not restated from
 * memory. No competitor logos or scraped screenshots — text only, with
 * plain hyperlinks to Jobright's own site where a claim is sourced from it.
 */
export const metadata: Metadata = pageMetadata({
  title: "Jobright Alternative for Nigeria & Africa — Talentrah",
  description:
    "Jobright is a well-reviewed AI job search copilot built for the US market. Here's what actually works for job seekers searching from Nigeria and across Africa.",
  path: "/vs/jobright",
});

const COMPARISON_ROWS: { feature: string; jobright: string; talentrah: string }[] = [
  {
    feature: "Where it actually works",
    jobright: "Built for the US market — no usable results from outside the US, no Nigeria or Africa coverage today",
    talentrah: "Built for job seekers in Nigeria and across Africa",
  },
  {
    feature: "Pricing",
    jobright: "Reported: $17.99/week, $39.99/month, or $89.99/quarter (USD)",
    talentrah: "NGN credit packs from ₦2,500, or a Pass from ₦6,500 — priced for the Nigerian market",
  },
  {
    feature: "AI job matching",
    jobright: "Yes — AI Agent, described as \"90% Job Search Automation\"",
    talentrah: "Yes — every job scored against your resume, three plain match tiers (Excellent/Good/Fair)",
  },
  {
    feature: "Auto-Apply",
    jobright: "Yes — part of the AI Agent",
    talentrah: "Yes — review-before-submit by default, a free weekly allowance before it draws on credits",
  },
  {
    feature: "Resume tools",
    jobright: "Resume AI Builder",
    talentrah: "AI resume builder with industry-specific templates, plus JD-paste tailoring and an ATS score",
  },
  {
    feature: "Cover letters, interview prep",
    jobright: "Yes",
    talentrah: "Yes, via Farah — Talentrah's AI copilot",
  },
  {
    feature: "Scholarships",
    jobright: "Not part of Jobright's public feature set",
    talentrah: "Yes — a public, attributed catalog for Nigerian and African applicants",
  },
  {
    feature: "Human mentorship",
    jobright: "Not part of Jobright's public feature set",
    talentrah: "Yes — real mentors for mock interviews and negotiation, not just AI coaching",
  },
];

export default function JobrightAlternativePage() {
  return (
    <>
      <MarketingMasthead />
      <main id="main-content" className="py-20">
        <Container className="flex max-w-[860px] flex-col gap-14">
          <div className="flex flex-col gap-4">
            <EyebrowLabel>Jobright alternative</EyebrowLabel>
            <h1 className="font-display text-[36px] leading-[1.15]">
              Jobright doesn&apos;t work outside the US. Here&apos;s what does.
            </h1>
            <p className="max-w-[660px] text-[16px] leading-[1.6] text-ink-soft">
              <a
                href="https://jobright.ai"
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="font-semibold text-rust underline underline-offset-2"
              >
                Jobright
              </a>{" "}
              is a well-reviewed AI job search copilot — for the US market. If
              you&apos;re searching from Nigeria, it doesn&apos;t return usable
              results, and there&apos;s no workaround: it defaults to US
              listings and salary data and has no Nigeria or Africa coverage
              today. Talentrah is built for exactly that gap — AI job
              matching, resume tailoring, and Auto-Apply, priced and designed
              for the Nigerian and African job market.
            </p>
            <div className="mt-2">
              <Link href="/signup" className={buttonClasses("primary", "md", "no-underline w-fit")}>
                Create a free account
              </Link>
            </div>
          </div>

          <div className="flex flex-col gap-4 border-t border-line pt-10">
            <EyebrowLabel>Why Jobright doesn&apos;t work from Nigeria</EyebrowLabel>
            <p className="max-w-[660px] text-[15px] leading-[1.65] text-ink-soft">
              This isn&apos;t a subjective knock — it&apos;s a verifiable
              feature gap. A third-party review of Jobright describes it as
              &ldquo;built around the American market,&rdquo; noting it
              defaults to US job listings and salary data and ships a
              dedicated H-1B visa filter with no equivalent for anywhere
              else. The same review reports that searches from the UK,
              Europe, and India return nothing functional — there&apos;s no
              partial version that works outside the US. Jobright said in
              June 2025 it planned to expand globally; as of this writing, no
              countries or dates have been announced.
            </p>
          </div>

          <div className="flex flex-col gap-5 border-t border-line pt-10">
            <EyebrowLabel>Jobright vs. Talentrah</EyebrowLabel>
            <div className="overflow-x-auto border border-ink">
              <table className="w-full min-w-[640px] border-collapse text-left text-[13.5px]">
                <thead>
                  <tr className="border-b border-ink bg-paper-alt">
                    <th className="px-4 py-3 font-body text-[11.5px] font-bold uppercase tracking-[0.14em] text-ink-soft">
                      Feature
                    </th>
                    <th className="px-4 py-3 font-body text-[11.5px] font-bold uppercase tracking-[0.14em] text-ink-soft">
                      Jobright
                    </th>
                    <th className="px-4 py-3 font-body text-[11.5px] font-bold uppercase tracking-[0.14em] text-ink-soft">
                      Talentrah
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {COMPARISON_ROWS.map((row) => (
                    <tr key={row.feature} className="border-b border-line last:border-b-0">
                      <th scope="row" className="px-4 py-3 align-top font-body text-[13.5px] font-semibold text-ink">
                        {row.feature}
                      </th>
                      <td className="px-4 py-3 align-top text-ink-soft">{row.jobright}</td>
                      <td className="px-4 py-3 align-top text-ink-soft">{row.talentrah}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[12.5px] leading-[1.6] text-ink-soft">
              Jobright pricing is reported by third-party reviews (
              <a
                href="https://outapply.com"
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="underline underline-offset-2"
              >
                outapply.com
              </a>
              ), not published by Jobright itself. Talentrah pricing is from{" "}
              <Link href="/ai-resume-tailoring" className="underline underline-offset-2">
                Talentrah&apos;s own current catalog
              </Link>
              .
            </p>
          </div>

          <div className="flex flex-col gap-3 border-t border-line pt-10">
            <EyebrowLabel>See it for yourself</EyebrowLabel>
            <p className="max-w-[640px] text-[15px] leading-[1.65] text-ink-soft">
              Talentrah&apos;s{" "}
              <Link href="/how-auto-apply-works" className="font-semibold text-rust underline underline-offset-2">
                Auto-Apply
              </Link>{" "}
              queues your best matches for review instead of submitting
              silently, and the free weekly allowance means you don&apos;t
              need to pay anything to try it. If you&apos;re also weighing
              JobCopilot, an African-focused AI job copilot with broader
              continental reach, see{" "}
              <Link href="/vs/jobcopilot" className="font-semibold text-rust underline underline-offset-2">
                how Talentrah compares to JobCopilot →
              </Link>
            </p>
          </div>

          <BorderedCard className="flex flex-col gap-3 p-8">
            <h2 className="font-display text-[20px] font-semibold">
              Built for the market Jobright doesn&apos;t reach
            </h2>
            <p className="max-w-[560px] text-[14px] text-ink-soft">
              Create a free account, upload your resume, and see your first
              match score in Nigerian job listings — no US résumé conventions
              required.
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
