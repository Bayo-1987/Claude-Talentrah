import Link from "next/link";
import { requireEmployer } from "@/lib/employer/membership";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { searchTalentDirectory } from "@/lib/talent-directory/queries";
import { purchaseTalentDirectorySubscriptionAction } from "@/lib/talent-directory/subscription-actions";
import { EyebrowLabel, BorderedCard, Button } from "@/components/ui";

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
 */
export default async function EmployerTalentDirectoryPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; remote?: string; available?: string }>;
}) {
  const context = await requireEmployer();
  const { error, remote, available } = await searchParams;

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

  return (
    <div className="flex flex-col gap-8">
      <EyebrowLabel>Talent Directory</EyebrowLabel>
      <h1 className="font-display text-[28px] font-semibold">Search verified candidates.</h1>
      {error && <p className="text-[13.5px] text-rust">{error}</p>}

      {!subscription ? (
        <BorderedCard className="flex flex-col gap-4 p-6">
          <p className="text-[14.5px] text-ink-soft">
            Subscribe to search verified, opted-in seekers by availability and remote-readiness.
          </p>
          {(plans ?? []).map((plan) => (
            <form key={plan.id} action={purchaseTalentDirectorySubscriptionAction.bind(null, plan.id)}>
              <Button type="submit" variant="primary">
                Subscribe — {plan.name} (₦{plan.price_ngn.toLocaleString()}/mo)
              </Button>
            </form>
          ))}
        </BorderedCard>
      ) : (
        <>
          <p className="text-[13px] text-ink-soft">
            Subscription active until {new Date(subscription.expires_at).toLocaleDateString()}.
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
            <p className="text-[14px] text-ink-soft">No verified, opted-in candidates match yet.</p>
          ) : (
            <ul className="grid list-none grid-cols-1 gap-5 p-0 sm:grid-cols-2">
              {candidates.map((c) => (
                <li key={c.userId}>
                  <Link href={`/employer/talent-directory/${c.userId}`} className="no-underline">
                    <BorderedCard className="flex h-full flex-col gap-2 p-5">
                      <h2 className="font-display text-[18px] font-semibold text-ink">
                        {[c.firstName, c.lastName].filter(Boolean).join(" ") || "A Talentrah candidate"}
                      </h2>
                      <p className="text-[13px] text-ink-soft">
                        {c.country ?? "Location not given"}
                        {c.remoteReady && " · Remote-ready"}
                        {c.availableForHire && " · Available now"}
                      </p>
                      {c.verificationScore != null && (
                        <p className="text-[12.5px] font-semibold text-green">Verified — {c.verificationScore}/100</p>
                      )}
                    </BorderedCard>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
