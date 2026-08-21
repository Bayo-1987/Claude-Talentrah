import { requireUser } from "@/lib/auth/require-user";
import { createClient } from "@/lib/supabase/server";
import { initiatePurchaseAction } from "@/lib/billing/actions";
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

  const [{ data: packs }, { data: passes }] = await Promise.all([
    supabase.from("credit_packs").select("*").eq("is_active", true).order("price_ngn"),
    supabase.from("passes").select("*").eq("is_active", true).order("price_ngn"),
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
