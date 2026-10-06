import Link from "next/link";
import { BorderedCard, EyebrowLabel, buttonClasses } from "@/components/ui";

/**
 * The homepage's "Real human mentors" section (owner request, 6 Oct 2026). Its job: a first-time visitor sees what they get from a mentor BEFORE any money, and the section never contradicts "Get started for free".
 *
 * What it deliberately does NOT show, each one a hard rule pinned by tests/marketing/mentorship-section.test.tsx:
 *   - no price, currency or amount. Prices stay on /mentorship and the booking pages. (The previous version read the live price floor from the database at build time; this one reads nothing, so the homepage no longer
 *     depends on a service-role read to build.)
 *   - no session length. The card only says that lengths are shown before booking.
 *   - no mentor name, photo, company or count. /mentorship's signed-out page deliberately shows no mentor identity (send-385, components/mentorship/public-landing.tsx), and `mentor_profiles` is not readable by a signed-out
 *     visitor. This component takes no props and awaits nothing, so no mentor data can reach it; showing mentors publicly would need a separate opt-in decision.
 *   - no "never through credits". The old paragraph that restated Meet Farah's "a human is the better call" is gone, so the two neighbouring sections no longer say the same thing.
 *
 * The five session types are the ones the booking page offers (src/app/(app)/mentorship/[mentorId]/page.tsx SESSION_TYPES; "Offer negotiation" is `negotiation_strategy`, "Negotiation strategy for a specific offer" there). The quick question
 * comes first at the owner's request; it is named without its length ("Quick question (15 min)" on the booking page), because the section states no session length.
 *
 * ON A PHONE the card bleeds 20px past the text column on each side (-mx-5) and has less inner padding (p-5), so it is 320px wide at 360px with 280px for its text, instead of 280 and 224. The section's own gutters
 * (px-10, the same as its neighbours) are not touched; from 901px the card is back to its normal size.
 * No click events here: the app has no custom analytics call and its page-view analytics is not gated on cookie consent, so events are a separate decision.
 */
const SESSION_TYPES = [
  { label: "Quick question", line: "Get unstuck on one thing." },
  { label: "Mock interview", line: "Practise the real thing before it counts." },
  { label: "Offer negotiation", line: "Prepare for a specific offer." },
  { label: "Career strategy", line: "Talk through your next move." },
  { label: "Resume review", line: "A second opinion from someone who's hired." },
] as const;

const TRUST_LINES = [
  "Every mentor is reviewed by our team before they can take bookings.",
  "Farah is free to start. Mentors are optional — pay per session, no subscription.",
] as const;

function Tick() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16" className="mt-1 shrink-0 text-green" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square">
      <path d="M2.5 8.5 6.5 12.5 13.5 4" />
    </svg>
  );
}

export function MentorshipSection() {
  return (
    <section id="mentorship" aria-labelledby="mentors-heading" className="py-24">
      <div className="mx-auto grid max-w-[1120px] grid-cols-1 items-center gap-10 px-10 min-[901px]:grid-cols-[1fr_380px] min-[901px]:gap-16">
        <div className="flex flex-col gap-4.5">
          <EyebrowLabel>Real human mentors</EyebrowLabel>
          <h2 id="mentors-heading" className="text-[34px] leading-[1.2]">
            Some moments deserve a real person.
          </h2>
          <p className="max-w-[520px] text-[16px] text-ink-soft">
            Negotiating an offer or preparing for a final round goes better with someone who has done the job. Talk it through 1:1 with an experienced mentor.
          </p>
          <ul className="flex max-w-[520px] flex-col gap-3 text-[15px] text-ink">
            {TRUST_LINES.map((line) => (
              <li key={line} className="flex items-start gap-3">
                <Tick />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
        <BorderedCard className="-mx-5 flex flex-col gap-5 p-5 min-[901px]:mx-0 min-[901px]:p-7">
          <EyebrowLabel>1:1 mentor sessions</EyebrowLabel>
          <ul className="flex flex-col">
            {SESSION_TYPES.map((type) => (
              <li key={type.label} data-session-type className="flex flex-col gap-0.5 border-b border-line py-3.5 first:pt-0">
                <span className="font-body text-[16px] font-semibold text-ink">{type.label}</span>
                <span className="text-[14px] text-ink-soft">{type.line}</span>
              </li>
            ))}
          </ul>
          <p className="text-[14px] text-ink-soft">You&apos;ll see each mentor&apos;s session lengths before you book.</p>
          <Link href="/mentorship" className={buttonClasses("primary", "md", "w-full justify-center no-underline")}>
            Browse mentors
          </Link>
          <Link
            href="/mentorship/apply"
            className="flex min-h-11 items-center py-1 font-body text-[14px] text-ink underline underline-offset-2 hover:text-rust"
          >
            Experienced professional? Become a mentor →
          </Link>
        </BorderedCard>
      </div>
    </section>
  );
}
