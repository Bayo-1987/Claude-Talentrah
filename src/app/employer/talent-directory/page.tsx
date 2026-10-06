import Link from "next/link";
import { requireEmployer } from "@/lib/employer/membership";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getTalentDirectoryPreview, searchTalentDirectory } from "@/lib/talent-directory/queries";
import { purchaseTalentDirectorySubscriptionAction } from "@/lib/talent-directory/subscription-actions";
import { joinTalentDirectoryWaitlistAction } from "@/lib/talent-directory/waitlist-actions";
import { isOnTalentDirectoryWaitlist } from "@/lib/talent-directory/waitlist-runner";
import { TalentDirectoryPreviewPanel } from "@/components/employer/talent-directory-preview-panel";
import { EyebrowLabel, BorderedCard, Button } from "@/components/ui";
import { ResumeReviewedBadge } from "@/components/talent-directory/resume-reviewed-badge";
import { HOW_WE_REVIEW_PATH, reviewMethodFromScore } from "@/lib/talent-directory/review-badge";
import { formatDate } from "@/lib/format/datetime";

export const metadata = { title: "Talent Directory — Talentrah" };

/**
 * Employer-facing directory (send-139, build-prompt §6.13 v1 slice). LOCAL
 * employers only — enforced by omission, not a flag (0135's own header):
 * this slice builds exactly one billing path (NGN via Paystack), so a
 * diaspora org simply has no route to an active subscription.
 *
 * BOTH READS BELOW GO THROUGH THE SECURITY DEFINER FUNCTIONS, never a direct
 * table query — a caller with no active subscription gets an empty result,
 * not an error, from `searchTalentDirectory` itself. This page adds a
 * friendlier "subscribe to search" state on top of that, but the actual gate
 * is inside the function.
 *
 * NO SUBSCRIPTION (EMP-1 / E1): the free preview (live count, up to three
 * anonymised samples) from `talent_directory_preview()`, which shares the paid
 * search's gate (0206). Below TALENT_DIRECTORY_MIN_LISTED candidates the
 * Subscribe button is replaced by a free waitlist (0205), and the purchase
 * action refuses on its own so the hidden button is not the only gate.
 */
export default async function EmployerTalentDirectoryPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; remote?: string; available?: string; waitlist?: string }>;
}) {
  const context = await requireEmployer();
  const { error, remote, available, waitlist } = await searchParams;

  const serviceClient = createServiceRoleClient();
  const [{ data: subscription }, { data: plans }] = await Promise.all([
    serviceClient
      .from("talent_directory_subscriptions")
      .select("status, expires_at")
      .eq("organization_id", context.organization.id)
      .eq("status", "active")
      .maybeSingle(),
    serviceClient.from("talent_directory_plans").select("id, name, price_ngn").eq("is_active", true),
  ]);

  const candidates = subscription
    ? await searchTalentDirectory({
        remoteReady: remote === "1" ? true : undefined,
        availableForHire: available === "1" ? true : undefined,
      })
    : [];

  // No subscription: the free preview (EMP-1 / E1). Its count and cards come from talent_directory_preview(), which applies the same
  // gate as the paid search; below TALENT_DIRECTORY_MIN_LISTED the panel offers a waitlist instead of Subscribe.
  const [preview, onWaitlist] = subscription
    ? [null, false]
    : await Promise.all([
        getTalentDirectoryPreview(),
        isOnTalentDirectoryWaitlist(serviceClient, context.organization.id),
      ]);

  return (
    <div className="flex flex-col gap-8">
      <EyebrowLabel>Talent Directory</EyebrowLabel>
      <h1 className="font-display text-[28px] font-semibold">Search candidates with a reviewed resume.</h1>
      <p className="text-[13px] text-ink-soft">
        Each candidate&apos;s resume was reviewed by Farah (AI) or a Talentrah mentor.{" "}
        <Link href={HOW_WE_REVIEW_PATH} className="font-semibold text-rust underline underline-offset-2">
          How we review
        </Link>
      </p>
      {error && <p className="text-[13.5px] text-rust">{error}</p>}

      {!subscription ? (
        preview && (
          <TalentDirectoryPreviewPanel
            preview={preview}
            plans={plans ?? []}
            joinedWaitlist={onWaitlist || waitlist === "joined"}
            joinAction={joinTalentDirectoryWaitlistAction}
            purchaseAction={purchaseTalentDirectorySubscriptionAction}
          />
        )
      ) : (
        <>
          <p className="text-[13px] text-ink-soft">
            Subscription active until {formatDate(subscription.expires_at)}.
          </p>

          <form className="flex flex-wrap items-center gap-4" method="get">
            <label className="flex items-center gap-2 text-[13.5px] text-ink">
              <input type="checkbox" name="remote" value="1" defaultChecked={remote === "1"} /> Remote-ready
            </label>
            <label className="flex items-center gap-2 text-[13.5px] text-ink">
              <input type="checkbox" name="available" value="1" defaultChecked={available === "1"} /> Available now
            </label>
            <Button type="submit" variant="secondary" size="sm">
              Filter
            </Button>
          </form>

          {candidates.length === 0 ? (
            <p className="text-[14px] text-ink-soft">No opted-in candidates with a reviewed resume match yet.</p>
          ) : (
            <ul className="grid list-none grid-cols-1 gap-5 p-0 sm:grid-cols-2">
              {candidates.map((c) => (
                <li key={c.userId}>
                  {/* The card is not one big link: the badge carries a "What this means" control, and a control cannot sit inside a link. The title is the link and
                      stretches over the card; the badge sits above that stretch so it can be opened. The score the database returns is turned into a method here, on the
                      server, and goes no further: nothing below takes a score. */}
                  <BorderedCard className="relative flex h-full flex-col gap-2 p-5">
                    <h2 className="font-display text-[18px] font-semibold text-ink">
                      <Link href={`/employer/talent-directory/${c.userId}`} className="no-underline after:absolute after:inset-0 after:content-['']">
                        {[c.firstName, c.lastName].filter(Boolean).join(" ") || "A Talentrah candidate"}
                      </Link>
                    </h2>
                    <p className="text-[13px] text-ink-soft">
                      {c.country ?? "Location not given"}
                      {c.remoteReady && " · Remote-ready"}
                      {c.availableForHire && " · Available now"}
                    </p>
                    <ResumeReviewedBadge method={reviewMethodFromScore(c.verificationScore)} reviewedAt={c.verifiedAt} className="relative z-10" />
                  </BorderedCard>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
