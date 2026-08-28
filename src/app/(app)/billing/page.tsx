import { requireUser } from "@/lib/auth/require-user";
import { createClient } from "@/lib/supabase/server";
import { initiatePurchaseAction, cancelAutoRenewAction } from "@/lib/billing/actions";
import { EyebrowLabel, BorderedCard, Button } from "@/components/ui";

/**
 * What each product_type is called on a receipt.
 *
 * Spelled out rather than derived from the enum: `credit_pack` is a column
 * value, "Credit pack" is what a person recognises on a statement.
 * ad_wallet_topup can appear here for someone who is both a seeker and an
 * employer on one account, so it needs a label even though nothing in this
 * change emails about it.
 */
const PRODUCT_LABEL: Record<string, string> = {
  credit_pack: "Credit pack",
  pass: "Talentrah Pass",
  ad_wallet_topup: "Ad wallet top-up",
};

export const metadata = { title: "Credits & Passes — Talentrah" };

/**
 * next_renewal_date is a date-only column ("2026-08-31"), so it can't go
 * through `new Date(...).toLocaleDateString()` the way the timestamptz
 * expires_at does — that parses as UTC midnight and renders the previous
 * day for any viewer behind UTC. Build the date in local time from its
 * parts so both dates on this card read the same way.
 */
function formatDateOnly(value: string | null): string {
  if (!value) return "";
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString();
}

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { profile } = await requireUser();
  const supabase = await createClient();
  const { error } = await searchParams;

  const [{ data: packs }, { data: passes }, { data: activePasses }, { data: purchases }] =
    await Promise.all([
      supabase.from("credit_packs").select("*").eq("is_active", true).order("price_ngn"),
      supabase.from("passes").select("*").eq("is_active", true).order("price_ngn"),
      supabase
        .from("user_passes")
        .select("id, payment_method, auto_renew_status, next_renewal_date, expires_at, status, passes(name)")
        .eq("user_id", profile.id)
        .eq("status", "active")
        .order("expires_at", { ascending: false }),
      /*
       * The user's own receipts, through the NORMAL authenticated client.
       *
       * No service role: `payment_transactions` is owner-readable under RLS,
       * so the session is already scoped to this user and elevating would only
       * remove the guarantee that it is. The `.eq("user_id")` is belt and
       * braces — RLS is what actually enforces it.
       *
       * Rendered from the row's own columns, with no join to the product. The
       * FK cannot be followed: `product_id` points at `credit_packs` for one
       * product_type and `passes` for another (and at nothing at all for a
       * wallet top-up, nullable since 0050), so there is no single relation to
       * embed. The row already carries amount, currency, rail and reference —
       * everything a receipt line needs.
       */
      supabase
        .from("payment_transactions")
        .select("id, amount, currency, product_type, rail, channel, paystack_reference, created_at")
        .eq("user_id", profile.id)
        .eq("status", "success")
        .order("created_at", { ascending: false })
        .limit(10),
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
                      Auto-renews on {formatDateOnly(userPass.next_renewal_date)}. You&apos;ll get a reminder
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

      {/*
        Purchase history. Only successful ones — a pending row is a payment
        Paystack has not confirmed and a failed one is not a purchase, and
        listing either under "what you have bought" would be a receipt for
        something that did not happen.
      */}
      {(purchases ?? []).length > 0 && (
        <div className="flex flex-col gap-4">
          <EyebrowLabel size="sm">Purchase history</EyebrowLabel>
          <div className="flex flex-col">
            {(purchases ?? []).map((p) => (
              <div
                key={p.id}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line py-3"
              >
                <div className="flex min-w-0 flex-col">
                  <span className="font-body text-[14px] font-semibold text-ink">
                    {PRODUCT_LABEL[p.product_type] ?? p.product_type}
                  </span>
                  <span className="font-body text-[12.5px] text-ink-soft">
                    {new Date(p.created_at).toLocaleDateString("en-NG", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                    {p.channel ? ` · ${p.channel}` : p.rail ? ` · ${p.rail}` : ""}
                  </span>
                </div>
                <div className="flex flex-col items-end">
                  <span className="font-display text-[16px] text-ink">
                    ₦{p.amount.toLocaleString()}
                  </span>
                  {/*
                    The Paystack reference IS the receipt number — the same
                    string the confirmation email quotes, so a support question
                    can be matched to a row without the user knowing what
                    Paystack is.
                  */}
                  {p.paystack_reference && (
                    <span className="font-body text-[11.5px] text-ink-soft">
                      Receipt {p.paystack_reference}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
          <p className="font-display text-[12.5px] italic text-ink-soft">
            Showing your ten most recent purchases.
          </p>
        </div>
      )}
    </div>
  );
}
