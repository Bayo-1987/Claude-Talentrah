import Link from "next/link";
import { EyebrowLabel, BorderedCard, buttonClasses } from "@/components/ui";
import {
  ACTIVATED_MEANING,
  HOW_IT_WORKS,
  SELF_REFERRAL_LINE,
  referralCapSentence,
  referralRewardHeadline,
  referralRewardWorth,
} from "@/lib/referrals/copy";

/**
 * Refer & Earn (send-515) — the signed-out visitor's entry point at `/refer`, following the pattern #607 set for /jobs and /tracker.
 *
 * STATIC: no props, no database, no Supabase client. It deliberately shows NO leaderboard and calls no RPC: 0211 revokes anon's EXECUTE on
 * the leaderboard function, so a signed-out page that read it would error (tests/referrals/public-landing.test.tsx pins both). Every number
 * comes from src/lib/referrals/copy.ts, which reads the reward constants and CREDIT_COSTS: nothing here is typed, so it cannot say anything
 * other than what the database pays. No statistics, testimonials or user counts: none exist to quote.
 *
 * WHY THE GUTTERS ARE NOT `Container`: see components/jobs/public-landing.tsx.
 */

const SIGNUP_HREF = `/signup?redirectTo=${encodeURIComponent("/refer")}`;
const LOGIN_HREF = `/login?redirectTo=${encodeURIComponent("/refer")}`;

const SECTION = "flex flex-col gap-5 border-t border-line pt-10";

export function ReferPublicLanding() {
  return (
    <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-14 py-6 sm:py-10">
      {/* A — hero */}
      <div className="flex flex-col gap-5">
        <EyebrowLabel>Refer &amp; Earn</EyebrowLabel>
        <h1 className="max-w-[820px] font-display text-[30px] leading-[1.15] sm:text-[36px]">{referralRewardHeadline()}</h1>
        <p className="max-w-[640px] text-[16px] leading-[1.6] text-ink-soft">
          Share your link with a friend who is job hunting. When they get set up on Talentrah, {referralRewardWorth()} arrives in your account.
        </p>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <Link href={SIGNUP_HREF} className={buttonClasses("primary", "md", "no-underline")}>
            Create a free account to get your link
          </Link>
          <Link
            href={LOGIN_HREF}
            className="inline-flex min-h-11 items-center text-[14px] font-semibold text-ink underline underline-offset-2 hover:text-rust"
          >
            Already have one? Log in
          </Link>
        </div>
        <p className="max-w-[560px] font-display text-[14.5px] italic leading-[1.55] text-ink-soft">
          Reading this page needs no account. Your link and the reward need a free account.
        </p>
      </div>

      {/* B — how it works */}
      <section className={SECTION}>
        <EyebrowLabel>How it works</EyebrowLabel>
        <h2 className="font-display text-[24px] leading-[1.2]">Three steps, and you are paid at the last one.</h2>
        <ol className="grid list-none gap-4 p-0 md:grid-cols-3">
          {HOW_IT_WORKS.map((s, i) => (
            <li key={s.title}>
              <BorderedCard className="flex h-full flex-col gap-3 p-5">
                <span className="font-display text-[22px] text-ink-soft" aria-hidden="true">
                  {i + 1}
                </span>
                <h3 className="font-display text-[18px] font-semibold">{s.title}</h3>
                <p className="text-[14px] leading-[1.55] text-ink-soft">{s.text}</p>
              </BorderedCard>
            </li>
          ))}
        </ol>
      </section>

      {/* C — the reward, when it pays, the limit */}
      <section className={SECTION}>
        <EyebrowLabel>The reward</EyebrowLabel>
        <h2 className="font-display text-[24px] leading-[1.2]">What you get, and when.</h2>
        <div className="grid gap-4 md:grid-cols-3">
          <BorderedCard className="flex flex-col gap-3 p-5">
            <h3 className="font-display text-[18px] font-semibold">The reward</h3>
            <p className="text-[14px] leading-[1.55] text-ink-soft">{referralRewardWorth()}, for each friend who activates.</p>
          </BorderedCard>
          <BorderedCard className="flex flex-col gap-3 p-5">
            <h3 className="font-display text-[18px] font-semibold">When it pays</h3>
            <p className="text-[14px] leading-[1.55] text-ink-soft">{ACTIVATED_MEANING}</p>
          </BorderedCard>
          <BorderedCard className="flex flex-col gap-3 p-5">
            <h3 className="font-display text-[18px] font-semibold">The limit</h3>
            <p className="text-[14px] leading-[1.55] text-ink-soft">
              {referralCapSentence()} {SELF_REFERRAL_LINE}
            </p>
          </BorderedCard>
        </div>
      </section>

      {/* D — closing card */}
      <BorderedCard borderWidth="2" className="flex flex-col items-start gap-4 p-8">
        <h2 className="font-display text-[22px] font-semibold">Get your link.</h2>
        <p className="max-w-[560px] text-[14.5px] leading-[1.55] text-ink-soft">
          Create a free account and your personal link is waiting on this page, ready to share on WhatsApp.
        </p>
        <Link href={SIGNUP_HREF} className={buttonClasses("primary", "md", "no-underline")}>
          Create a free account to get your link
        </Link>
      </BorderedCard>
    </div>
  );
}
