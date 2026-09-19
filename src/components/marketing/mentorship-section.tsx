import Link from "next/link";
import { BorderedCard, EyebrowLabel, buttonClasses, NairaAmount } from "@/components/ui";

/**
 * send-389 — Mentorship's entire above-the-fold presence used to be one
 * clause of one sentence in meet-farah-section.tsx ("...connect you with a
 * real mentor"). Per CLAUDE.md's own differentiation thesis, real human
 * mentorship is the one thing an AI-only competitor structurally can't
 * offer — this is the section that actually shows it, rather than mentioning
 * it in passing.
 *
 * ── WHY NO NAMED MENTOR IS SHOWN ───────────────────────────────────────────
 *
 * Checked before writing any copy, not assumed. Two independent reasons,
 * either one alone would be sufficient:
 *
 * 1. `mentor_profiles`' own SELECT policy (0133) grants `authenticated`
 *    only — no `anon` row access at all — and `mentor_public_names()` (0167),
 *    the one function that exposes a mentor's name beyond the raw table,
 *    explicitly `revoke all ... from public, anon`. A signed-out homepage
 *    visitor's session cannot read an individual mentor's identity through
 *    any sanctioned path; naming one here would require reaching for the
 *    service-role client specifically to bypass that boundary, which is a
 *    real privacy call this section does not make unilaterally.
 * 2. Queried live (2026-09-19): exactly 2 approved mentors exist,
 *    priced at ₦15,000 and ₦20,000, and exactly 1 session has EVER been
 *    booked platform-wide, still not completed. Too thin a roster to single
 *    one out without it reading as spotlighting — and far too thin a number
 *    to cite as a session-count stat (build prompt §6.1: no invented social
 *    proof; a real-but-tiny number here would undercut the credibility
 *    argument rather than build it).
 *
 * So this section is deliberately role/moment-based, the way
 * meet-farah-section.tsx itself already is (it doesn't name a mentor
 * either) — never an invented individual, name, photo, or bio.
 *
 * ── THE PRICING ANCHOR ─────────────────────────────────────────────────────
 *
 * "From ₦15,000" is the real, current floor of the two live mentors' own
 * `base_price_ngn` (₦15,000 and ₦20,000) — queried directly against
 * production rather than copied from CLAUDE.md's own "₦5k–₦100k+" build-prompt
 * figure, which this section's own investigation found to be stale against
 * the real, current, much narrower distribution. Not the full range: a
 * ₦5k–₦100k+ spread reads as "could be anything" rather than reassuring, and
 * showing the low end of a range this narrow would currently be untrue for
 * both live mentors.
 */
export function MentorshipSection() {
  return (
    <div id="mentorship" className="py-24">
      <div className="mx-auto grid max-w-[1120px] grid-cols-1 items-center gap-10 px-10 min-[901px]:grid-cols-[1fr_380px] min-[901px]:gap-16">
        <div className="flex flex-col gap-4.5">
          <EyebrowLabel>Real human mentors</EyebrowLabel>
          <h2 className="text-[34px] leading-[1.2]">Some moments deserve a real person.</h2>
          <p className="max-w-[520px] text-[16px] text-ink-soft">
            Farah gets you ready on your own, day to day. But negotiating a real offer, or
            getting live feedback before a final-round interview, is a different kind of
            moment — one worth talking through with someone who has actually done the job
            you&apos;re going for.
          </p>
          <p className="max-w-[520px] text-[16px] text-ink-soft">
            Vetted mentors, booked and paid for directly — never through credits, never a
            surprise on price.
          </p>
        </div>
        <BorderedCard className="flex flex-col gap-5 p-7">
          <div className="flex flex-col gap-1.5">
            <span className="font-body text-[12px] font-bold uppercase tracking-[0.14em] text-rust">
              Sessions from
            </span>
            <span className="font-display text-[32px] leading-none">
              <NairaAmount amount={15000} />
            </span>
          </div>
          <p className="text-[14px] text-ink-soft">
            Mock interviews, offer negotiation, career strategy, and resume review — pick the
            moment, pick a mentor, book directly.
          </p>
          <Link
            href="/mentorship"
            className={buttonClasses("primary", "md", "w-full justify-center no-underline")}
          >
            Find a mentor
          </Link>
        </BorderedCard>
      </div>
    </div>
  );
}
