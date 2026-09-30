import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { pageMetadata } from "@/lib/seo/site";
import { MarketingMasthead } from "@/components/marketing/marketing-masthead";
import { MarketingFooter } from "@/components/marketing/marketing-footer";
import { Container, EyebrowLabel, BorderedCard, buttonClasses } from "@/components/ui";

/**
 * send-461 — the second of two comparison/alternative-seeking SEO pages (see
 * /vs/jobright's own header for the broader "why this exists" context: free
 * comparison content, not the paid competitor-keyword SEM bidding half of
 * the founder's goal, which is a separate decision).
 *
 * ── WHY THIS ONE IS WRITTEN DIFFERENTLY FROM /vs/jobright ──────────────────
 *
 * JobCopilot (FreshTalent's product — this page is named and written around
 * "JobCopilot," the actual competing product, not "FreshTalent") is a real,
 * comparably-featured AI copilot with genuine African coverage, not a weak
 * comparison. This is a fair, feature-by-feature page, not a takedown:
 * both products are named plainly where they do the same thing, and
 * JobCopilot's real advantage (broader continental + global reach) is
 * stated rather than omitted.
 *
 * ── SOURCES, CHECKED 2026-09-30 (send-478) ─────────────────────────────────
 *
 * The product is "FreshTalent JobCopilot" throughout, exactly as FreshTalent
 * brands it. A different product, jobcopilot.com, exists, and FreshTalent's
 * own sign-up host is recruitmentroom.jobcopilot.com; the relationship between
 * them is not established here, so no claim depends on it.
 *
 * jobcopilot.freshtalent.africa (home, /pricing, sitemap):
 * - 54 African countries, roles in 150+ countries, 500,000+ career pages:
 *   homepage and FAQ.
 * - Automatic applications: paid plans only (FAQ); 5/day Basic, 20/day
 *   Premium, up to 50/day Elite (/pricing). FAQ: you can require approval
 *   before each submission. Interview prep is on paid plans; the resume
 *   builder is on the free plan.
 * - Prices ARE published, per region (/pricing). Nigeria, NGN: Basic
 *   ₦2,900/week or ₦8,000/month; Premium ₦7,000/₦21,000; Elite ₦9,000/₦27,000;
 *   Career Intelligence ₦21,000/year; 30-day money-back. This page used to say
 *   the paid price was "not published"; that stopped being true. Basic costs
 *   less than our 7-Day Pass, and the page says so.
 * - Scholarships / mentorship: absent from the homepage's 12 features and from
 *   the sitemap (12,845 URLs; none of the 452 non-listing pages mention
 *   scholarship, mentor, coach or advisor). Caveat: the Elite plan lists "AI
 *   offer negotiation and career advisors" and the pricing page does not say
 *   who the advisors are, so the page quotes it and claims neither AI nor
 *   human. Signed-in features cannot be checked from outside.
 *
 * quarterly re-check: every competitor fact above (see the follow-up in the
 * send-478 PR).
 *
 * Talentrah's own job-sourcing scope is deliberately NOT overstated as
 * "Nigeria-specific" — src/lib/jobs/country.ts's own audit shows the feed
 * mixes four tracked African countries (Nigeria, Ghana, Kenya, South
 * Africa) with a large share of global/remote postings, not a
 * Nigeria-only board. The differentiation drawn here is NGN pricing, a free
 * Auto-Apply allowance, and scholarships/mentorship — not sourcing breadth,
 * where JobCopilot's own reach is broader and said so plainly below.
 */
export const metadata: Metadata = pageMetadata({
  title: "Talentrah vs. FreshTalent JobCopilot — AI Job Search Compared",
  description:
    "How Talentrah compares to FreshTalent JobCopilot: AI job matching, Auto-Apply, resume tools, and interview prep — feature by feature, with what each one doesn't offer.",
  path: "/vs/jobcopilot",
});

const FRESHTALENT_HOME = "https://jobcopilot.freshtalent.africa";
const FRESHTALENT_PRICING = "https://jobcopilot.freshtalent.africa/pricing";
const ZPLATFORM_REVIEW = "https://zplatform.ai/ai-reviews/jobright-ai/";

const SOURCE_LINK_CLASS = "underline underline-offset-2";

const COMPARISON_ROWS: { feature: string; jobcopilot: ReactNode; talentrah: string }[] = [
  {
    feature: "Coverage",
    jobcopilot: "All 54 African countries, matching roles in 150+ countries globally — its clearest advantage",
    talentrah: "Nigeria, Ghana, Kenya, and South Africa tracked directly, alongside global remote postings",
  },
  {
    feature: "AI job matching",
    jobcopilot: "Yes — scans 500,000+ company career pages plus job boards",
    talentrah: "Yes — every job scored against your resume, three plain match tiers (Excellent/Good/Fair)",
  },
  {
    feature: "Auto-Apply",
    jobcopilot:
      "Automatic applications on paid plans only: 5/day (Basic), 20/day (Premium), up to 50/day (Elite); approval before submitting is optional",
    talentrah:
      "Matches wait in a review queue for your confirmation before anything is submitted; a free weekly allowance before it draws on credits — no plan required to start",
  },
  {
    feature: "Resume tools",
    jobcopilot: "AI resume builder (free plan); unlimited ATS scans (paid plans)",
    talentrah: "AI resume builder with industry templates, plus JD-paste tailoring and an ATS score",
  },
  {
    feature: "Interview prep",
    jobcopilot: "Role-specific mock interviews (STAR method) with instant feedback (paid plans)",
    talentrah: "Conversational prep with Farah — talking points and practice Q&A for a specific role",
  },
  {
    feature: "Application tracking",
    jobcopilot: "Centralized tracker with funnel analytics",
    talentrah: "Job Tracker with Saved / Applied / Interviewing / Offer / Rejected stages, manual entries allowed",
  },
  {
    feature: "Pricing",
    jobcopilot: (
      <>
        Free plan, no card required. Paid plans in Nigeria, per{" "}
        <a href={FRESHTALENT_PRICING} target="_blank" rel="noopener noreferrer nofollow" className={SOURCE_LINK_CLASS}>
          its pricing page
        </a>
        , September 2026: Basic ₦2,900/week or ₦8,000/month; Premium ₦7,000/week or ₦21,000/month; Elite ₦9,000/week
        or ₦27,000/month; Career Intelligence ₦21,000/year
      </>
    ),
    talentrah: "Free trial + free weekly Auto-Apply, then NGN credit packs from ₦2,500 or a Pass from ₦6,500",
  },
  {
    feature: "Scholarships",
    jobcopilot: "Not on FreshTalent JobCopilot's public pages as of September 2026",
    talentrah: "Yes — a public, attributed catalog for Nigerian and African applicants",
  },
  {
    feature: "Human mentorship",
    jobcopilot: (
      <>
        No mentor marketplace on its public pages as of September 2026. Its Elite plan lists &ldquo;AI offer
        negotiation and career advisors&rdquo;; its{" "}
        <a href={FRESHTALENT_PRICING} target="_blank" rel="noopener noreferrer nofollow" className={SOURCE_LINK_CLASS}>
          pricing page
        </a>{" "}
        doesn&apos;t say more.
      </>
    ),
    talentrah: "Yes — real mentors for mock interviews and negotiation, not just AI coaching",
  },
];

export default function JobCopilotComparisonPage() {
  return (
    <>
      <MarketingMasthead />
      <main id="main-content" className="py-20">
        <Container className="flex max-w-[860px] flex-col gap-14">
          <div className="flex flex-col gap-4">
            <EyebrowLabel>Talentrah vs. FreshTalent JobCopilot</EyebrowLabel>
            <h1 className="font-display text-[36px] leading-[1.15]">
              Two AI job copilots built for Africa. Here&apos;s how they differ.
            </h1>
            <p className="max-w-[660px] text-[16px] leading-[1.6] text-ink-soft">
              <a
                href={FRESHTALENT_HOME}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="font-semibold text-rust underline underline-offset-2"
              >
                FreshTalent JobCopilot
              </a>{" "}
              and Talentrah both offer AI job matching, Auto-Apply, resume
              tools, interview prep, and application tracking. This is a
              genuine overlap, not a stretch — so this page compares them
              feature by feature rather than pretending one is obviously
              better.
            </p>
            <div className="mt-2">
              <Link href="/signup" className={buttonClasses("primary", "md", "no-underline w-fit")}>
                Create a free account
              </Link>
            </div>
          </div>

          <div className="flex flex-col gap-4 border-t border-line pt-10">
            <EyebrowLabel>Where FreshTalent JobCopilot has the edge</EyebrowLabel>
            <p className="max-w-[660px] text-[15px] leading-[1.65] text-ink-soft">
              FreshTalent JobCopilot covers all 54 African countries and matches roles in
              150+ countries globally, with a real emphasis on
              global-remote employers and visa-sponsorship roles. If broad
              continental and international reach is what you&apos;re
              optimizing for, that&apos;s a real strength worth knowing about
              up front.
            </p>
          </div>

          <div className="flex flex-col gap-4 border-t border-line pt-10">
            <EyebrowLabel>Where Talentrah differs</EyebrowLabel>
            <p className="max-w-[660px] text-[15px] leading-[1.65] text-ink-soft">
              Talentrah adds two things that aren&apos;t part of FreshTalent
              JobCopilot&apos;s current public feature set:{" "}
              <Link href="/scholarships/apply-now" className="font-semibold text-rust underline underline-offset-2">
                scholarships
              </Link>{" "}
              and{" "}
              <Link href="/mentorship" className="font-semibold text-rust underline underline-offset-2">
                human mentorship
              </Link>{" "}
              — real mentors for mock interviews and offer negotiation, not
              just AI coaching. Auto-Apply works differently too: Talentrah
              holds matches in a review queue for your confirmation before
              anything is submitted, while FreshTalent JobCopilot&apos;s own
              FAQ says approval before each submission is something you can
              choose to require. On the free tier, FreshTalent JobCopilot&apos;s
              free plan doesn&apos;t include automatic applications;
              Talentrah&apos;s does, up to a weekly allowance, before drawing on
              credits. On price, FreshTalent JobCopilot&apos;s cheapest paid
              plan (Basic, ₦2,900 a week in Nigeria, per{" "}
              <a
                href={FRESHTALENT_PRICING}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="underline underline-offset-2"
              >
                its pricing page
              </a>
              , September 2026) costs less than our 7-Day Pass (₦6,500) — so
              compare what each includes, not just the number.
            </p>
          </div>

          <div className="flex flex-col gap-5 border-t border-line pt-10">
            <EyebrowLabel>Feature by feature</EyebrowLabel>
            <div className="overflow-x-auto border border-ink">
              <table className="w-full min-w-[640px] border-collapse text-left text-[13.5px]">
                <thead>
                  <tr className="border-b border-ink bg-paper-alt">
                    <th className="px-4 py-3 font-body text-[11.5px] font-bold uppercase tracking-[0.14em] text-ink-soft">
                      Feature
                    </th>
                    <th className="px-4 py-3 font-body text-[11.5px] font-bold uppercase tracking-[0.14em] text-ink-soft">
                      FreshTalent JobCopilot
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
                      <td className="px-4 py-3 align-top text-ink-soft">{row.jobcopilot}</td>
                      <td className="px-4 py-3 align-top text-ink-soft">{row.talentrah}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[12.5px] leading-[1.6] text-ink-soft">
              FreshTalent JobCopilot details are from{" "}
              <a
                href={FRESHTALENT_HOME}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="underline underline-offset-2"
              >
                jobcopilot.freshtalent.africa
              </a>{" "}
              and{" "}
              <a
                href={FRESHTALENT_PRICING}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="underline underline-offset-2"
              >
                its pricing page
              </a>
              , checked September 2026. Talentrah pricing is from{" "}
              <Link href="/ai-resume-tailoring" className="underline underline-offset-2">
                Talentrah&apos;s own current catalog
              </Link>
              .
            </p>
          </div>

          <div className="flex flex-col gap-3 border-t border-line pt-10">
            <EyebrowLabel>Also weighing US-market tools?</EyebrowLabel>
            <p className="max-w-[640px] text-[15px] leading-[1.65] text-ink-soft">
              Some AI job copilots, like Jobright, are built for the US market
              and are reported to return nothing usable outside it (
              <a
                href={ZPLATFORM_REVIEW}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="underline underline-offset-2"
              >
                zPlatform, September 2026
              </a>
              ) — a different comparison than this one. See{" "}
              <Link href="/vs/jobright" className="font-semibold text-rust underline underline-offset-2">
                how Talentrah compares to Jobright →
              </Link>
            </p>
          </div>

          <BorderedCard className="flex flex-col gap-3 p-8">
            <h2 className="font-display text-[20px] font-semibold">
              See your own match scores, free
            </h2>
            <p className="max-w-[560px] text-[14px] text-ink-soft">
              Create a free account, upload your resume, and try Auto-Apply
              on your first matches without spending a credit.
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
