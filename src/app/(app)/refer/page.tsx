import { getOptionalUser, requireUser } from "@/lib/auth/require-user";
import { createClient } from "@/lib/supabase/server";
import { getReferralUrl } from "@/lib/referrals/url";
import { EyebrowLabel, BorderedCard } from "@/components/ui";
import { ShareButtons } from "@/components/referrals/share-buttons";
import { LeaderboardOptIn } from "@/components/referrals/leaderboard-opt-in";
import { logShareAction } from "@/lib/referrals/actions";
import { REFERRAL_CAP } from "@/lib/referrals/rewards";
import {
  ACTIVATED_MEANING,
  SELF_REFERRAL_LINE,
  pendingCredits,
  referralCapReachedMessage,
  referralCapSentence,
  referralRewardHeadline,
  referralRewardWorth,
  referralRowStatus,
} from "@/lib/referrals/copy";
import { ReferPublicLanding } from "@/components/referrals/refer-public-landing";
import { isWithinRolloverGrace, monthRange } from "@/lib/referrals/leaderboard";
import { formatDate } from "@/lib/format/datetime";
import { pageMetadata } from "@/lib/seo/site";

/**
 * Refer & Earn (send-515) — /refer used to redirect every signed-out visitor to /login (a 307 from proxy.ts). It is now a real public
 * landing page for them, so its metadata branches on auth state exactly as /tracker's and /scholarships' do. A signed-in visitor keeps the
 * plain title this page always had, deep-equal-tested in tests/referrals/page-metadata-and-loading.test.tsx. No searchParams: the
 * canonical is the bare path.
 */
export async function generateMetadata() {
  const session = await getOptionalUser();
  if (session) return { title: "Refer a Friend — Talentrah" };

  return pageMetadata({
    title: "Refer & Earn: Bring a Friend, Get Credits — Talentrah",
    description:
      "Share your link with a friend who is job hunting. When they get set up on Talentrah, you are paid in credits. Free with an account.",
    path: "/refer",
  });
}

const DAY_MS = 86_400_000;

export default async function ReferPage() {
  /*
   * Signed-out branch, ABOVE everything else and BEFORE any query: static copy, nothing to fetch, and in particular NO call to
   * referral_leaderboard (anon has no EXECUTE on it after 0211). A session with no profile row degrades to "signed out" here
   * (getOptionalUser's documented behaviour) rather than redirecting.
   */
  if (!(await getOptionalUser())) return <ReferPublicLanding />;

  const { user, profile } = await requireUser();
  const supabase = await createClient();
  const referralUrl = await getReferralUrl(profile.referral_code);

  const now = new Date();
  const currentPeriod = monthRange(now);
  const showPreviousPeriod = isWithinRolloverGrace(now);
  const previousPeriod = showPreviousPeriod ? monthRange(now, 1) : null;

  const windowStart = new Date(now.getTime() - REFERRAL_CAP.windowDays * DAY_MS).toISOString();

  const [
    { data: referrals },
    { count: sharesCount },
    { data: currentLeaderboard },
    { data: previousLeaderboard },
    { data: rewardedInWindowRows },
  ] = await Promise.all([
      supabase
        .from("referrals")
        .select("id, status, reward_credits_referrer, created_at, activated_at")
        .eq("referrer_id", user.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("referral_shares")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id),
      supabase.rpc("referral_leaderboard", {
        p_period_start: currentPeriod.start,
        p_period_end: currentPeriod.end,
      }),
      previousPeriod
        ? supabase.rpc("referral_leaderboard", {
            p_period_start: previousPeriod.start,
            p_period_end: previousPeriod.end,
          })
        : Promise.resolve({ data: null, error: null }),
      // The cap counts DISTINCT referrals paid in the rolling window, read from the referrer's own ledger rows (what
      // count_rewarded_referrals_last_30d reads, which the session cannot call). Used only to say "you are at the limit".
      supabase
        .from("credit_ledger")
        .select("related_entity_id")
        .eq("user_id", user.id)
        .in("reason", ["referral_signup_bonus", "referral_activation_bonus"])
        .gte("created_at", windowStart),
    ]);

  const rows = referrals ?? [];
  const signedUpCount = rows.filter((r) => r.status === "signed_up" || r.status === "activated").length;
  const activatedCount = rows.filter((r) => r.status === "activated").length;
  const creditsEarned = rows.reduce((sum, r) => sum + r.reward_credits_referrer, 0);
  const creditsPending = pendingCredits(rows);
  const rewardedInWindow = new Set((rewardedInWindowRows ?? []).map((r) => r.related_entity_id)).size;
  const atCap = rewardedInWindow >= REFERRAL_CAP.referrals;

  const stats = [
    { label: "Shares sent", value: sharesCount ?? 0 },
    { label: "Signed up", value: signedUpCount },
    { label: "Activated", value: activatedCount },
    { label: "Credits earned", value: creditsEarned },
  ];

  return (
    <div className="flex flex-col gap-8">
      <div>
        <EyebrowLabel>Refer & earn</EyebrowLabel>
        <h1 className="mt-1.5 text-[26px]">{referralRewardHeadline()}</h1>
        {/*
          Every number below comes from src/lib/referrals (copy.ts / rewards.ts), never typed here. Since 0215 a friend's signup pays
          nothing and ACTIVATION pays the whole reward; the cap is stated once with its real unit (referrals, in any rolling window).
        */}
        <p className="mt-2 max-w-[560px] text-[14.5px] text-ink-soft">
          You are paid when a friend activates: {referralRewardWorth()}. {ACTIVATED_MEANING} A signup on its own pays nothing.{" "}
          {referralCapSentence()} {SELF_REFERRAL_LINE}
        </p>
        {atCap && (
          <p role="status" className="mt-3 max-w-[560px] border-[1.5px] border-line bg-card px-4 py-3 text-[13.5px] text-ink">
            {referralCapReachedMessage(rewardedInWindow)}
          </p>
        )}
      </div>

      <BorderedCard className="flex flex-col gap-4 p-5">
        <EyebrowLabel size="sm">Your link</EyebrowLabel>
        <p className="break-all font-display text-[16px] italic text-ink-soft">{referralUrl}</p>
        <ShareButtons url={referralUrl} onShare={logShareAction} />
      </BorderedCard>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {stats.map((s) => (
          <BorderedCard key={s.label} className="flex flex-col gap-1 p-4">
            <span className="font-display text-[26px]">{s.value}</span>
            <span className="text-[12.5px] text-ink-soft">{s.label}</span>
          </BorderedCard>
        ))}
      </div>

      {creditsPending > 0 && (
        <p className="text-[13px] text-ink-soft">
          {creditsPending} more credits will arrive as your signed-up friends activate.
        </p>
      )}

      {/*
        send-140. Ranked by ACTIVATED referrals this calendar month, reusing
        the exact column the reward system itself pays out on — see
        0130's own header for why that, and not a raw invite count, is the
        metric. During the first few days of a new month the previous
        month's frozen standings show too, so someone who just missed the
        cutoff doesn't wonder why the board reset under them.
      */}
      <BorderedCard className="flex flex-col gap-4 p-5">
        <div>
          <EyebrowLabel size="sm">Leaderboard — this month</EyebrowLabel>
          <p className="mt-1 font-body text-[13px] text-ink-soft">
            Ranked by referrals that activated, not invites sent.
          </p>
        </div>
        <LeaderboardTable rows={currentLeaderboard ?? []} />

        {showPreviousPeriod && previousLeaderboard && previousLeaderboard.length > 0 && (
          <div className="border-t border-line pt-4">
            <EyebrowLabel size="sm">Last month&rsquo;s final standings</EyebrowLabel>
            <div className="mt-2">
              <LeaderboardTable rows={previousLeaderboard} />
            </div>
          </div>
        )}

        <LeaderboardOptIn
          optedIn={profile.referral_leaderboard_opt_in}
          displayName={profile.referral_leaderboard_display_name}
        />
      </BorderedCard>

      <div className="flex flex-col gap-3">
        <EyebrowLabel size="sm">Your referrals</EyebrowLabel>
        {rows.length === 0 ? (
          <p className="py-8 text-center text-[14.5px] text-ink-soft">
            No referrals yet — share your link above to get started.
          </p>
        ) : (
          <div className="flex flex-col divide-y divide-line border-y border-line">
            {rows.map((r) => {
              const status = referralRowStatus(r);
              return (
                <div key={r.id} className="flex items-start justify-between gap-4 py-3 text-[13.5px]">
                  <span className="text-ink-soft">
                    {status.label} · {formatDate(r.activated_at ?? r.created_at)}
                    {status.detail && (
                      <span className={`mt-0.5 block text-[12.5px] ${status.tone === "withheld" ? "text-ink" : "text-ink-soft"}`}>
                        {status.detail}
                      </span>
                    )}
                  </span>
                  <span className={r.reward_credits_referrer > 0 ? "flex-shrink-0 font-semibold text-green" : "flex-shrink-0 text-ink-soft"}>
                    {r.reward_credits_referrer > 0 ? `+${r.reward_credits_referrer} credits` : "—"}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

interface LeaderboardRow {
  rank: number;
  display_name: string;
  activated_count: number;
}

/**
 * Only render an active fact, never an absent one — the same restraint
 * CLAUDE.md states for FilterChip/badges, applied here: an empty leaderboard
 * (nobody has opted in yet, or nobody has activated a referral this month)
 * says so plainly rather than rendering an empty table with headers and
 * nothing under them.
 */
function LeaderboardTable({ rows }: { rows: LeaderboardRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="py-4 text-center font-body text-[13.5px] text-ink-soft">
        Nobody&rsquo;s on the board yet this month — activate a referral and opt in below to be first.
      </p>
    );
  }

  return (
    <div className="flex flex-col divide-y divide-line border-y border-line">
      {rows.map((r) => (
        <div key={`${r.rank}-${r.display_name}`} className="flex items-center gap-3 py-2.5 text-[13.5px]">
          <span className="w-6 flex-shrink-0 text-right font-display text-[16px] text-ink-soft">{r.rank}</span>
          <span className="min-w-0 flex-1 truncate text-ink">{r.display_name}</span>
          <span className="flex-shrink-0 font-semibold text-ink">
            {r.activated_count} {r.activated_count === 1 ? "referral" : "referrals"}
          </span>
        </div>
      ))}
    </div>
  );
}
