import { requireUser } from "@/lib/auth/require-user";
import { createClient } from "@/lib/supabase/server";
import { initiatePurchaseAction, cancelAutoRenewAction } from "@/lib/billing/actions";
import { EyebrowLabel, BorderedCard, Button } from "@/components/ui";

export const metadata = { title: "Credits & Passes — Talentrah" };

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { profile } = await requireUser();
  const supabase = await createClient();
  const { error } = await searchParams;

  const [{ data: packs }, { data: passes }, { data: activePasses }] = await Promise.all([
    supabase.from("credit_packs").select("*").eq("is_active", true).order("price_ngn"),
    supabase.from("passes").select("*").eq("is_active", true).order("price_ngn"),
    supabase
      .from("user_passes")
      .select("id, payment_method, auto_renew_status, next_renewal_date, expires_at, status, passes(name)")
      .eq("user_id", profile.id)
      .eq("status", "active")
      .order("expires_at", { ascending: false }),
  ]);

  const paystackConfigured = !!process.env.PAYSTACK_SECRET_KEY;

  return (
    <div className="flex flex-col gap-10">
      <div>
        <EyebrowLabel>Talentrah Credits</EyebrowLabel>
        <h1 className="mt-2 font-display text-[28px]">
          Your balance: {profile.credits_balance} credits
        </h1>
        <p className="mt-1 text-[14.5px] text-ink-soft">
          Credits cover AI tailoring runs, cover letters, and premium
          templates beyond your free trial.
        </p>
        {error === "payments_unavailable" && (
          <p className="mt-3 max-w-[560px] border-[1.5px] border-rust bg-rust-soft px-4 py-3 text-[13.5px] text-rust">
            That purchase couldn&apos;t start — payments aren&apos;t configured yet in this environment.
          </p>
        )}
        {!paystackConfigured && (
          <p className="mt-3 max-w-[560px] border-[1.5px] border-amber bg-[oklch(96%_0.03_70)] px-4 py-3 text-[13.5px]" style={{ color: "var(--amber)" }}>
            Payments aren&apos;t configured yet in this environment — buying will fail until Paystack keys are set.
          </p>
        )}
      </div>

      {(activePasses ?? []).length > 0 && (
        <div className="flex flex-col gap-4">
          <EyebrowLabel size="sm">Your active passes</EyebrowLabel>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {activePasses!.map((userPass) => (
              <BorderedCard key={userPass.id} className="flex flex-col gap-3 p-5">
                <h3 className="text-[17px]">{userPass.passes?.name ?? "Pass"}</h3>
                <p className="text-[13.5px] text-ink-soft">
                  Active until {new Date(userPass.expires_at).toLocaleDateString()} · paid by{" "}
                  {userPass.payment_method === "card" ? "card" : "mobile money / bank"}
                </p>
                {userPass.auto_renew_status === "active" && (
                  <>
                    <p className="text-[13.5px] text-ink-soft">
                      Auto-renews on {userPass.next_renewal_date}. You&apos;ll get a reminder
                      before you&apos;re charged.
                    </p>
                    <form action={cancelAutoRenewAction.bind(null, userPass.id)}>
                      <Button type="submit" size="sm" variant="secondary">
                        Cancel auto-renewal
                      </Button>
                    </form>
                  </>
                )}
                {userPass.auto_renew_status === "canceled" && (
                  <p className="text-[13.5px] text-ink-soft">
                    Auto-renewal canceled — access continues until it expires, then this Pass
                    won&apos;t renew.
                  </p>
                )}
                {userPass.auto_renew_status === "lapsed" && (
                  <p className="max-w-[420px] border-[1.5px] border-rust bg-rust-soft px-3 py-2 text-[13px] text-rust">
                    A renewal charge failed, so this Pass won&apos;t auto-renew. Buy a new one
                    below to keep access after it expires.
                  </p>
                )}
                {userPass.payment_method === "mobile_money" && !userPass.auto_renew_status && (
                  <p className="text-[13.5px] text-ink-soft">
                    One-time — mobile money and bank rails don&apos;t support auto-renewal.
                  </p>
                )}
              </BorderedCard>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-4">
        <EyebrowLabel size="sm">Credit packs</EyebrowLabel>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {(packs ?? []).map((pack) => (
            <BorderedCard key={pack.id} className="flex flex-col gap-3 p-5">
              <h3 className="text-[17px]">{pack.name}</h3>
              <p className="text-[13.5px] text-ink-soft">{pack.credits} credits</p>
              <p className="font-display text-[24px]">₦{pack.price_ngn.toLocaleString()}</p>
              <form action={initiatePurchaseAction.bind(null, "credit_pack", pack.id)}>
                <Button type="submit" size="sm">
                  Buy
                </Button>
              </form>
            </BorderedCard>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <EyebrowLabel size="sm">Passes</EyebrowLabel>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {(passes ?? []).map((pass) => (
            <BorderedCard key={pass.id} className="flex flex-col gap-3 p-5">
              <h3 className="text-[17px]">{pass.name}</h3>
              <p className="text-[13.5px] text-ink-soft">
                Unlimited access for {pass.duration_days} days. Auto-renews if paid by
                card; one-time if paid by mobile money.
              </p>
              <p className="font-display text-[24px]">₦{pass.price_ngn.toLocaleString()}</p>
              <form action={initiatePurchaseAction.bind(null, "pass", pass.id)}>
                <Button type="submit" size="sm">
                  Buy
                </Button>
              </form>
            </BorderedCard>
          ))}
        </div>
      </div>
    </div>
  );
}
