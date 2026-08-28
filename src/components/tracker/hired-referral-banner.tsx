import { getReferralUrl } from "@/lib/referrals/url";
import { ShareButtons } from "@/components/referrals/share-buttons";
import { logShareAction } from "@/lib/referrals/actions";

/**
 * Voice choice: Farah-voiced, not neutral-system. build-prompt §6.10 lists
 * "Referral conversion" as Farah-voiced but doesn't explicitly cover this
 * prompt-to-refer moment — judgment call: a "you got hired!" moment is
 * exactly the relationship-y, celebratory kind of notification §6.10
 * assigns to Farah, not a dry factual/B2B one. Inline banner, not a modal —
 * a modal would be the "disruptive interstitial" the M8 spec explicitly
 * warns against right after a real success moment.
 */
export async function HiredReferralBanner({
  jobTitle,
  referralCode,
}: {
  jobTitle: string;
  referralCode: string;
}) {
  const referralUrl = await getReferralUrl(referralCode);

  return (
    <div className="flex flex-col gap-3 border-[1.5px] border-ink bg-card p-5">
      <p className="font-display text-[17px] italic text-ink-soft">
        &ldquo;Congratulations on {jobTitle} — that&apos;s huge. If you know someone else
        job-hunting, this is the best time to send them your link — you&apos;ll both be glad
        you did.&rdquo;
      </p>
      <ShareButtons url={referralUrl} compact onShare={logShareAction} />
    </div>
  );
}
