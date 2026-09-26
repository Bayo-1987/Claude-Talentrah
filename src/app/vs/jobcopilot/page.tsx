import type { Metadata } from "next";
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
 * ── EVERY JOBCOPILOT CLAIM BELOW TRACES TO ITS OWN SITE, VERIFIED 2026-09-26 ──
 *
 * jobcopilot.freshtalent.africa (first-party): covers all 54 African
 * countries, matches roles in 150+ countries globally, with explicit
 * emphasis on global-remote employers and visa-sponsorship roles. Scans
 * 500,000+ company career pages plus job boards; up to 50 automatic
 * applications/day with role-specific CV variants and generated cover
 * letters (paid plan); AI resume builder + ATS checker; role-specific mock
 * interviews (STAR method) with instant feedback; centralized application
 * tracker with funnel analytics. Free plan: AI job search, match scores,
 * resume builder, application tracker, no card required. Paid plan adds
 * automatic applications, unlimited ATS scans, AI cover letters, interview
 * coaching, salary insights — exact paid price is NOT published on their
 * site, so no number for it appears here. No mention anywhere on their
 * public pages of scholarships or mentorship — stated below as "not offered
 * ... as of this writing," not as a permanent gap, since absence of a
 * mention today doesn't prove it never will exist.
 *
 * The one comparative claim made here — "JobCopilot's free plan doesn't
 * include automatic applications; Talentrah's does" — is checked against
 * both sides' own public copy before being written: JobCopilot's own
 * pricing page states automatic applications are a paid-plan feature;
 * Talentrah's docs/auto-apply.md states a free weekly allowance (5 free /
 * rolling 7 days) before Auto-Apply draws on credits — no account tier or
 * payment required to use it at all. No price comparison is made beyond
 * that, because JobCopilot's paid price isn't published.
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
  title: "Talentrah vs. JobCopilot — AI Job Search Compared",
  description:
    "How Talentrah compares to FreshTalent's JobCopilot: AI job matching, Auto-Apply, resume tools, and interview prep — feature by feature, with what each one doesn't offer.",
  path: "/vs/jobcopilot",
});

const COMPARISON_ROWS: { feature: string; jobcopilot: string; talentrah: string }[] = [
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
    jobcopilot: "Up to 50 automatic applications/day with role-specific CV variants (paid plan only)",
    talentrah: "Review-before-submit by default; free weekly allowance before it draws on credits — no plan required to start",
  },
  {
    feature: "Resume tools",
    jobcopilot: "AI resume builder, unlimited ATS scans (paid plan)",
    talentrah: "AI resume builder with industry templates, plus JD-paste tailoring and an ATS score",
  },
  {
    feature: "Interview prep",
    jobcopilot: "Role-specific mock interviews (STAR method) with instant feedback",
    talentrah: "Conversational prep with Farah — talking points and practice Q&A for a specific role",
  },
  {
    feature: "Application tracking",
    jobcopilot: "Centralized tracker with funnel analytics",
    talentrah: "Job Tracker with Saved / Applied / Interviewing / Offer / Rejected stages, manual entries allowed",
  },
  {
    feature: "Pricing",
    jobcopilot: "Free plan, no card required; paid plan's price is not published",
    talentrah: "Free trial + free weekly Auto-Apply, then NGN credit packs from ₦2,500 or a Pass from ₦6,500",
  },
  {
    feature: "Scholarships",
    jobcopilot: "Not offered on JobCopilot's public pages as of this writing",
    talentrah: "Yes — a public, attributed catalog for Nigerian and African applicants",
  },
  {
    feature: "Human mentorship",
    jobcopilot: "Not offered on JobCopilot's public pages as of this writing",
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
            <EyebrowLabel>Talentrah vs. JobCopilot</EyebrowLabel>
            <h1 className="font-display text-[36px] leading-[1.15]">
              Two AI job copilots built for Africa. Here&apos;s how they differ.
            </h1>
            <p className="max-w-[660px] text-[16px] leading-[1.6] text-ink-soft">
              <a
                href="https://jobcopilot.freshtalent.africa"
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="font-semibold text-rust underline underline-offset-2"
              >
                JobCopilot
              </a>
              , FreshTalent&apos;s AI job search product, and Talentrah both
              offer AI job matching, Auto-Apply, resume tools, interview
              prep, and application tracking. This is a genuine overlap, not
              a stretch — so this page compares them feature by feature
              rather than pretending one is obviously better.
            </p>
            <div className="mt-2">
              <Link href="/signup" className={buttonClasses("primary", "md", "no-underline w-fit")}>
                Create a free account
              </Link>
            </div>
          </div>

          <div className="flex flex-col gap-4 border-t border-line pt-10">
            <EyebrowLabel>Where JobCopilot has the edge</EyebrowLabel>
            <p className="max-w-[660px] text-[15px] leading-[1.65] text-ink-soft">
              JobCopilot covers all 54 African countries and matches roles in
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
              Talentrah adds two things that aren&apos;t part of
              JobCopilot&apos;s current public feature set:{" "}
              <Link href="/scholarships/apply-now" className="font-semibold text-rust underline underline-offset-2">
                scholarships
              </Link>{" "}
              and{" "}
              <Link href="/mentorship" className="font-semibold text-rust underline underline-offset-2">
                human mentorship
              </Link>{" "}
              — real mentors for mock interviews and offer negotiation, not
              just AI coaching. On pricing, JobCopilot&apos;s free plan
              doesn&apos;t include automatic applications; Talentrah&apos;s
              free tier does, up to a weekly allowance, before drawing on
              credits — no plan required to start.
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
                      JobCopilot
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
              JobCopilot details are from{" "}
              <a
                href="https://jobcopilot.freshtalent.africa"
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="underline underline-offset-2"
              >
                jobcopilot.freshtalent.africa
              </a>
              , its own site — including that its paid-plan price isn&apos;t
              published, which is why no price comparison is made beyond
              what each free plan includes. Talentrah pricing is from{" "}
              <Link href="/ai-resume-tailoring" className="underline underline-offset-2">
                Talentrah&apos;s own current catalog
              </Link>
              .
            </p>
          </div>

          <div className="flex flex-col gap-3 border-t border-line pt-10">
            <EyebrowLabel>Also weighing US-market tools?</EyebrowLabel>
            <p className="max-w-[640px] text-[15px] leading-[1.65] text-ink-soft">
              Some AI job copilots, like Jobright, are built for the US
              market and don&apos;t return usable results from Nigeria at
              all — a different comparison than this one. See{" "}
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
