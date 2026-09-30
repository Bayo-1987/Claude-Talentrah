import type { Metadata } from "next";
import type { ReactNode } from "react";
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
 * ── SOURCES, CHECKED 2026-09-30 (send-478) ─────────────────────────────────
 *
 * Every competitor fact on this page is dated on the page and linked to where
 * it came from, and none is stated as an absolute: a source saw certain places
 * on a certain date. Nothing here is something we tested ourselves.
 *
 * - "US-only in practice", the H-1B filter, US listings/salary defaults, and
 *   "searches from the UK, Europe and India return nothing usable": the
 *   zPlatform review (zplatform.ai/ai-reviews/jobright-ai/, updated
 *   2026-09-24, checked by them 2026-09-14). NO source tested Nigeria, so the
 *   page says "built for the US market" and never that Jobright does not work
 *   from Nigeria. The Jobright pages we checked (jobright.ai/, /ai-agent)
 *   contain no mention of Nigeria or Africa; Jobright's own FAQ answer on
 *   country coverage is rendered client-side and could not be read.
 * - June 2025 "expanding into new markets": Jobright's own funding release
 *   (finance.yahoo.com/news/jobright-launches-first-ai-agent-120000547.html);
 *   no countries or dates since, per zPlatform as of 2026-09-14.
 * - Reported pricing ($17.99/week, $39.99/month, $89.99/quarter): third-party
 *   reviews (outapply.com/blog/jobright-ai-pricing and zPlatform; also
 *   FavTutor and careerkit). Jobright publishes no pricing page — /pricing,
 *   /plans and /upgrade all 404 (2026-09-30) — and one review reports a 33%
 *   rise from $29.99, so these move: they are labelled "reported, September
 *   2026".
 * - "90% Job Search Automation" and Auto-Apply: first-party, jobright.ai/ai-agent.
 * - Human coaching: Turbo is reported to include live career-coach
 *   consultations (zPlatform, Wobo), so the mentorship row says "not a mentor
 *   marketplace", not "no human help".
 * - No "well-reviewed" and no rating: dropped rather than cited, because the
 *   same sources also report billing complaints.
 *
 * quarterly re-check: every competitor fact above (see the follow-up in the
 * send-478 PR).
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
    "Jobright is an AI job search copilot built for the US market. Here's what works for job seekers searching from Nigeria and across Africa.",
  path: "/vs/jobright",
});

const ZPLATFORM_REVIEW = "https://zplatform.ai/ai-reviews/jobright-ai/";
const OUTAPPLY_PRICING = "https://outapply.com/blog/jobright-ai-pricing";
const JUNE_2025_RELEASE = "https://finance.yahoo.com/news/jobright-launches-first-ai-agent-120000547.html";

const SOURCE_LINK_CLASS = "underline underline-offset-2";

const COMPARISON_ROWS: { feature: string; jobright: ReactNode; talentrah: string }[] = [
  {
    feature: "Where it actually works",
    jobright: (
      <>
        Built for the US market; reported as US-only in practice (
        <a href={ZPLATFORM_REVIEW} target="_blank" rel="noopener noreferrer nofollow" className={SOURCE_LINK_CLASS}>
          zPlatform
        </a>
        , September 2026)
      </>
    ),
    talentrah: "Built for job seekers in Nigeria and across Africa",
  },
  {
    feature: "Pricing",
    jobright: (
      <>
        Reported by third-party reviews, September 2026: $17.99/week, $39.99/month or $89.99/quarter (USD) (
        <a href={OUTAPPLY_PRICING} target="_blank" rel="noopener noreferrer nofollow" className={SOURCE_LINK_CLASS}>
          OutApply
        </a>
        ,{" "}
        <a href={ZPLATFORM_REVIEW} target="_blank" rel="noopener noreferrer nofollow" className={SOURCE_LINK_CLASS}>
          zPlatform
        </a>
        ). Jobright publishes no pricing page.
      </>
    ),
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
    jobright: (
      <>
        Not a mentor marketplace. Turbo is reported to include live career-coach consultations (
        <a href={ZPLATFORM_REVIEW} target="_blank" rel="noopener noreferrer nofollow" className={SOURCE_LINK_CLASS}>
          zPlatform
        </a>
        , September 2026)
      </>
    ),
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
              Looking for a Jobright alternative in Nigeria? Jobright is built for the US market.
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
              is an AI job search copilot built for the US market. Its search
              defaults to US listings and salary data, and the Jobright pages
              we checked in September 2026 don&apos;t mention Nigeria or
              Africa. Talentrah is built for job seekers in Nigeria and across
              Africa — AI job matching, resume tailoring, and Auto-Apply,
              priced and designed for that market.
            </p>
            <div className="mt-2">
              <Link href="/signup" className={buttonClasses("primary", "md", "no-underline w-fit")}>
                Create a free account
              </Link>
            </div>
          </div>

          <div className="flex flex-col gap-4 border-t border-line pt-10">
            <EyebrowLabel>What reviews say about Jobright&apos;s coverage</EyebrowLabel>
            <p className="max-w-[660px] text-[15px] leading-[1.65] text-ink-soft">
              An independent review (
              <a
                href={ZPLATFORM_REVIEW}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className={SOURCE_LINK_CLASS}
              >
                zPlatform, updated September 2026
              </a>
              ) describes Jobright as &ldquo;built around the American
              market&rdquo;: its job search defaults to the United States, and
              it ships a dedicated H-1B visa filter. It reports that searches
              from the UK, Europe and India return nothing usable. Jobright
              said in its{" "}
              <a
                href={JUNE_2025_RELEASE}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className={SOURCE_LINK_CLASS}
              >
                June 2025 funding announcement
              </a>{" "}
              that it is &ldquo;expanding into new markets&rdquo;; no countries
              or dates had been named as of September 2026.
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
              Jobright publishes no pricing page; the figures above are reported
              by third-party reviews (
              <a
                href={OUTAPPLY_PRICING}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className={SOURCE_LINK_CLASS}
              >
                OutApply
              </a>
              ,{" "}
              <a
                href={ZPLATFORM_REVIEW}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className={SOURCE_LINK_CLASS}
              >
                zPlatform
              </a>
              ), September 2026. Talentrah pricing is from{" "}
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
              FreshTalent JobCopilot, an African-focused AI job copilot with broader
              continental reach, see{" "}
              <Link href="/vs/jobcopilot" className="font-semibold text-rust underline underline-offset-2">
                how Talentrah compares to FreshTalent JobCopilot →
              </Link>
            </p>
          </div>

          <BorderedCard className="flex flex-col gap-3 p-8">
            <h2 className="font-display text-[20px] font-semibold">
              Built for job seekers in Nigeria and across Africa
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
