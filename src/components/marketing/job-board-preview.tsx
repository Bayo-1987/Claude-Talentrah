import Link from "next/link";
import { EyebrowLabel, buttonClasses } from "@/components/ui";
import { MATCH_TIER_TEXT_CLASS } from "@/lib/match-tier";

const SAMPLE_LISTINGS = [
  {
    score: 92,
    tier: "excellent" as const,
    title: "Senior Product Manager",
    meta: "Flutterwave · Lagos, Nigeria · Remote",
  },
  {
    score: 78,
    tier: "good" as const,
    title: "Product Manager, Growth",
    meta: "Paystack · Lagos, Nigeria · Hybrid",
  },
  {
    score: 63,
    tier: "fair" as const,
    title: "Product Manager",
    meta: "Andela · Remote · sourced externally",
  },
];

const TIER_LABEL = { excellent: "Excellent", good: "Good", fair: "Fair" };

export function JobBoardPreview() {
  return (
    <div id="jobs" className="border-t border-line py-22">
      <div className="mx-auto max-w-[1120px] px-10">
        <div className="mb-10 flex flex-wrap items-end justify-between gap-6">
          <div className="flex max-w-[620px] flex-col gap-4">
            <EyebrowLabel>On the board today</EyebrowLabel>
            <h2 className="text-[32px] leading-[1.25]">
              Talentrah is a live job board, too — not just a matching tool.
            </h2>
            <p className="text-[16px] text-ink-soft">
              Real openings from Flutterwave, Paystack, Andela and hundreds of other companies
              hiring across Nigeria and Africa, updated daily and scored against your resume once
              you create a free account.
            </p>
          </div>
          <Link href="/jobs" className={buttonClasses("secondary", "md", "flex-shrink-0 no-underline")}>
            Browse all jobs →
          </Link>
        </div>

        <div className="flex flex-col border-t border-line">
          {SAMPLE_LISTINGS.map((listing) => (
            <div
              key={listing.title}
              className="flex items-baseline gap-6 border-b border-line py-5"
            >
              <span className="w-15 flex-shrink-0 font-display text-[26px] text-ink">
                {listing.score}%
              </span>
              <div className="flex-1">
                <span className="font-display text-[17px] font-semibold text-ink">
                  {listing.title}
                </span>
                <span className="text-[13.5px] text-ink-soft"> — {listing.meta}</span>
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
          Match scores shown are calculated against a sample resume — yours will be scored against
          your own once you create a free account.
        </p>
      </div>
    </div>
  );
}
