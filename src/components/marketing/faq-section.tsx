import { EyebrowLabel } from "@/components/ui";

/**
 * The public FAQ.
 *
 * ── NO FAQPage STRUCTURED DATA HERE, DELIBERATELY ─────────────────────────
 *
 * Adding it was planned and then checked against Google's current
 * documentation rather than shipped on memory. FAQ rich results were narrowed
 * to "well-known, authoritative government and health websites" in September
 * 2023, and in June 2026 Google removed the feature's documentation outright:
 * "The FAQ rich result feature is no longer shown in Google Search results."
 *
 * So the markup would render nothing anywhere, while costing a duplicate copy
 * of every answer on each homepage load and a second place for the wording to
 * drift out of sync. This project has an explicit payload budget for low-end
 * Android on expensive data; dead structured data spends it for no return.
 *
 * ── THE ANSWERS STILL GO STALE, WHICH IS THE REAL RISK ────────────────────
 *
 * The employer answer here read "Not through the site yet — self-serve job
 * posting is in development" long after self-serve posting shipped. Nothing
 * catches that: it is a true-sounding sentence about a feature, and the only
 * signal is someone reading it next to the product. Answers describing what is
 * and is not live need re-reading whenever the thing they describe ships.
 */
const FAQS = [
  {
    q: "Is Talentrah free to use?",
    a: "Checking your match score and previewing a tailored resume needs no account. Deeper AI actions — full tailoring, applying, interview prep — use credits: you get a free allotment when you create a free account, with more available if you need them.",
  },
  {
    q: "What's the difference between Farah and a human mentor?",
    a: "Day-to-day, Farah handles the matching, tailoring, and coaching, and that's what's live today. When the stakes are highest — negotiating pay, or prepping for a final round — she'll tell you a human is the better call. Hand-off to a real mentor is planned, not yet available.",
  },
  {
    q: "Is human mentorship available yet?",
    a: "Not yet — mentorship is planned, not live. Farah handles the coaching available today. When mentorship launches, sessions will be paid directly to the mentor rather than through credits.",
  },
  {
    q: "Can employers post jobs on Talentrah?",
    a: "Yes, and it's free while we build out the employer tools. Create a free account, set up your company, and confirm a work email on your company's domain — your roles appear in the job feed once the company is verified. If you'd rather we worked a role with you directly, get in touch.",
  },
];

export function FaqSection() {
  return (
    <div id="faqs" className="border-t border-line py-24">
      <div className="mx-auto max-w-[1120px] px-10">
        <div className="mb-12 flex max-w-[560px] flex-col gap-4">
          <EyebrowLabel>Frequently asked</EyebrowLabel>
          <h2 className="text-[32px] leading-[1.25]">Questions, answered plainly.</h2>
        </div>
        <div className="flex max-w-[760px] flex-col border-t border-line">
          {FAQS.map((faq) => (
            <div
              key={faq.q}
              className="flex flex-col gap-3 border-b border-line py-6 min-[901px]:flex-row min-[901px]:gap-8"
            >
              <h3 className="text-[17px] min-[901px]:w-65 min-[901px]:flex-shrink-0">{faq.q}</h3>
              <p className="flex-1 text-[15px] text-ink-soft">{faq.a}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
