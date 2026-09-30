import Link from "next/link";
import { EyebrowLabel, buttonClasses } from "@/components/ui";
import { MATCH_TIER_TEXT_CLASS } from "@/lib/match-tier";

/**
 * Illustrative rows — NOT real postings, and their scores are not computed from
 * anything. They deliberately carry NO company field: this block used to name
 * Flutterwave, Paystack and Andela, none of which has a posting in our data,
 * and a fictional company name would still read as a real employer. The block
 * is labelled "Example listings" above and in the footnote below.
 *
 * tests/marketing/no-unlabelled-social-proof.test.ts (case 3) enforces this:
 * adding any field outside its allowlist — a company, most obviously — fails.
 *
 * Scores stay 92/78/63, one per tier, so this still shows all three match tiers
 * and stays consistent with the note in src/lib/match-tier.ts.
 */
const SAMPLE_LISTINGS = [
  {
    score: 92,
    tier: "excellent" as const,
    role: "Senior Product Manager",
    industry: "Fintech",
    location: "Lagos, Nigeria",
    workType: "Remote",
  },
  {
    score: 78,
    tier: "good" as const,
    role: "Product Manager, Growth",
    industry: "Fintech",
    location: "Lagos, Nigeria",
    workType: "Hybrid",
  },
  {
    score: 63,
    tier: "fair" as const,
    role: "Product Manager",
    industry: "E-commerce",
    location: "Remote",
    workType: "sourced externally",
  },
];

const TIER_LABEL = { excellent: "Excellent", good: "Good", fair: "Fair" };

export function JobBoardPreview() {
  return (
    <div id="jobs" className="border-t border-line py-22">
      <div className="mx-auto max-w-[1120px] px-10">
        <div className="mb-10 flex flex-wrap items-end justify-between gap-6">
          <div className="flex max-w-[620px] flex-col gap-4">
            <EyebrowLabel>Example listings</EyebrowLabel>
            <h2 className="text-[32px] leading-[1.25]">
              Talentrah is a live job board, too — not just a matching tool.
            </h2>
            <p className="text-[16px] text-ink-soft">
              Open roles from companies hiring across Nigeria and Africa, updated daily. Create a
              free account to browse them, each one scored against your own resume.
            </p>
          </div>
          <Link href="/jobs" className={buttonClasses("secondary", "md", "flex-shrink-0 no-underline")}>
            Browse all jobs →
          </Link>
        </div>

        <div className="flex flex-col border-t border-line">
          {SAMPLE_LISTINGS.map((listing) => (
            <div
              key={listing.role}
              className="flex items-baseline gap-6 border-b border-line py-5"
            >
              <span className="w-15 flex-shrink-0 font-display text-[26px] text-ink">
                {listing.score}%
              </span>
              <div className="flex-1">
                <span className="font-display text-[17px] font-semibold text-ink">
                  {listing.role}
                </span>
                <span className="text-[13.5px] text-ink-soft">
                  {" "}· {listing.industry} · {listing.location} · {listing.workType}
                </span>
              </div>
              <span
                className={`flex-shrink-0 font-body text-[12px] font-bold uppercase tracking-[0.14em] ${MATCH_TIER_TEXT_CLASS[listing.tier]}`}
              >
                {TIER_LABEL[listing.tier]}
              </span>
            </div>
          ))}
        </div>

        <p className="mt-4.5 font-display text-[13px] italic text-ink-soft">
          Example listings for illustration only. The roles and match scores are fictional. Create a
          free account and real listings are scored against your own resume.
        </p>
      </div>
    </div>
  );
}
