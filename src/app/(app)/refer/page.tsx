import { requireUser } from "@/lib/auth/require-user";
import { createClient } from "@/lib/supabase/server";
import { getReferralUrl } from "@/lib/referrals/url";
import { EyebrowLabel, BorderedCard } from "@/components/ui";
import { ShareButtons } from "@/components/referrals/share-buttons";
import { logShareAction } from "@/lib/referrals/actions";

export const metadata = { title: "Refer a Friend — Talentrah" };

const ACTIVATION_BONUS = 20;

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

  const [{ data: referrals }, { count: sharesCount }] = await Promise.all([
    supabase
      .from("referrals")
      .select("id, status, reward_credits_referrer, created_at, activated_at")
      .eq("referrer_id", user.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("referral_shares")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id),
  ]);

  const rows = referrals ?? [];
  const signedUpCount = rows.filter((r) => r.status === "signed_up" || r.status === "activated").length;
  const activatedCount = rows.filter((r) => r.status === "activated").length;
  const creditsEarned = rows.reduce((sum, r) => sum + r.reward_credits_referrer, 0);
  const creditsPending = rows.filter((r) => r.status === "signed_up").length * ACTIVATION_BONUS;

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
        <h1 className="mt-1.5 text-[26px]">Bring a friend, earn credits.</h1>
        <p className="mt-2 max-w-[560px] text-[14.5px] text-ink-soft">
          You get {5} credits when a friend signs up with your link, and{" "}
          {ACTIVATION_BONUS} more once they get set up on Talentrah — no cap on how many
          friends, up to 10 rewarded referrals every 30 days.
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
