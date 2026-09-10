import { requireUser } from "@/lib/auth/require-user";
import { createClient } from "@/lib/supabase/server";
import { getReferralUrl } from "@/lib/referrals/url";
import { EyebrowLabel, BorderedCard } from "@/components/ui";
import { ShareButtons } from "@/components/referrals/share-buttons";
import { LeaderboardOptIn } from "@/components/referrals/leaderboard-opt-in";
import { logShareAction } from "@/lib/referrals/actions";
import {
  REFERRAL_SIGNUP_BONUS_CREDITS,
  REFERRAL_ACTIVATION_BONUS_CREDITS,
  REFERRAL_ACTIVATION_BONUS_TAILORING_RUNS,
} from "@/lib/referrals/rewards";
import { isWithinRolloverGrace, monthRange } from "@/lib/referrals/leaderboard";

export const metadata = { title: "Refer a Friend — Talentrah" };

const STATUS_LABEL: Record<string, string> = {
  invited: "Invited",
  signed_up: "Signed up",
  activated: "Activated",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default async function ReferPage() {
  const { user, profile } = await requireUser();
  const supabase = await createClient();
  const referralUrl = await getReferralUrl(profile.referral_code);

  const now = new Date();
  const currentPeriod = monthRange(now);
  const showPreviousPeriod = isWithinRolloverGrace(now);
  const previousPeriod = showPreviousPeriod ? monthRange(now, 1) : null;

  const [{ data: referrals }, { count: sharesCount }, { data: currentLeaderboard }, { data: previousLeaderboard }] =
    await Promise.all([
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
    ]);

  const rows = referrals ?? [];
  const signedUpCount = rows.filter((r) => r.status === "signed_up" || r.status === "activated").length;
  const activatedCount = rows.filter((r) => r.status === "activated").length;
  const creditsEarned = rows.reduce((sum, r) => sum + r.reward_credits_referrer, 0);
  const creditsPending =
    rows.filter((r) => r.status === "signed_up").length * REFERRAL_ACTIVATION_BONUS_CREDITS;

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
        <h1 className="mt-1.5 text-[26px]">
          Bring a friend, earn {REFERRAL_ACTIVATION_BONUS_TAILORING_RUNS} free CV tailorings.
        </h1>
        {/*
          Leads with what the reward BUYS, not a credit count the reader has
          to convert into meaning — and states the actual cap once. It used
          to read "no cap on how many friends, up to 10 rewarded referrals
          every 30 days", which contradicts itself inside one sentence.
        */}
        <p className="mt-2 max-w-[560px] text-[14.5px] text-ink-soft">
          When a friend signs up with your link, you get {REFERRAL_SIGNUP_BONUS_CREDITS} credits.
          Once they get set up on Talentrah, you get {REFERRAL_ACTIVATION_BONUS_CREDITS} more —{" "}
          {REFERRAL_ACTIVATION_BONUS_TAILORING_RUNS} free CV tailorings, the real reward. Up to 10
          rewarded referrals every 30 days.
        </p>
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
          {creditsPending} more credits waiting once your pending referrals get set up on
          Talentrah.
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
            {rows.map((r) => (
              <div key={r.id} className="flex items-center justify-between py-3 text-[13.5px]">
                <span className="text-ink-soft">
                  {STATUS_LABEL[r.status]} · {formatDate(r.activated_at ?? r.created_at)}
                </span>
                <span className={r.reward_credits_referrer > 0 ? "font-semibold text-green" : "text-ink-soft"}>
                  {r.reward_credits_referrer > 0 ? `+${r.reward_credits_referrer} credits` : "—"}
                </span>
              </div>
            ))}
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
