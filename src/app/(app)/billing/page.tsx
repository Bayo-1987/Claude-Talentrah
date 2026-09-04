import Link from "next/link";
import { requireUser } from "@/lib/auth/require-user";
import { createClient } from "@/lib/supabase/server";
import {
  initiatePurchaseAction,
  cancelAutoRenewAction,
} from "@/lib/billing/actions";
import { EyebrowLabel, BorderedCard, Button } from "@/components/ui";
import { PASS_DAILY_ACTION_CAP } from "@/lib/passes/entitlement";

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

/**
 * Where each purchase actually gets spent.
 *
 * The confirmation used to offer "Back to Credits & Passes" — a link to the
 * page the reader is already on, from a screen whose entire job is to say
 * "now go and use it". Credits and Passes both exist to pay for AI actions,
 * and tailoring is the first one anybody reaches for, so that is the
 * destination rather than a generic bounce to the feed.
 *
 * A wallet top-up is the employer side of the same account and belongs
 * nowhere near /tailor.
 */
const PRODUCT_NEXT: Record<string, { href: string; label: string }> = {
  credit_pack: { href: "/tailor", label: "Tailor my resume" },
  pass: { href: "/tailor", label: "Tailor my resume" },
  ad_wallet_topup: { href: "/employer", label: "Go to your job postings" },
};

/**
 * What each credit pack's price is worth in plain terms, keyed by name —
 * matching scripts/seed.ts's own two packs. "Credits never expire" is a
 * verified claim, not marketing copy: grep src/lib/credits/ finds no
 * expiry logic anywhere, and this line only exists because of that check —
 * if that ever stops being true, this line has to go with it, not stay as
 * a claim nothing backs.
 */
const PACK_DESCRIPTION: Record<string, string> = {
  Starter: "1 CV tailoring · credits never expire",
  Plus: "2 tailorings + a cover letter, or a Directory verification · never expire",
};

/**
 * Pass copy, keyed by name — matching scripts/seed.ts's three passes.
 * Every pass states the same three things, in the same order: what
 * "unlimited" actually means here, what stays credit-only regardless, and
 * the fair-use ceiling nobody legitimate should ever reach (PASS_DAILY_ACTION_CAP,
 * src/lib/passes/entitlement.ts).
 */
const PASS_HEADLINE: Record<string, string> = {
  "7-Day Sprint Pass": "Unlimited for 7 days",
  "30-Day Pass": "Unlimited for 30 days",
  "90-Day Pass": "Unlimited for 90 days",
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
  searchParams: Promise<{ error?: string; purchased?: string }>;
}) {
  const { profile } = await requireUser();
  const supabase = await createClient();
  const { error, purchased } = await searchParams;

  const [
    { data: packs },
    { data: passes },
    { data: activePasses },
    { data: purchases },
  ] = await Promise.all([
    supabase
      .from("credit_packs")
      .select("*")
      .eq("is_active", true)
      .order("price_ngn"),
    supabase
      .from("passes")
      .select("*")
      .eq("is_active", true)
      .order("price_ngn"),
    supabase
      .from("user_passes")
      .select(
        "id, payment_method, auto_renew_status, next_renewal_date, expires_at, status, passes(name)",
      )
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
      .select(
        "id, amount, currency, product_type, rail, channel, paystack_reference, created_at",
      )
      .eq("user_id", profile.id)
      .eq("status", "success")
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  const paystackConfigured = !!process.env.PAYSTACK_SECRET_KEY;

  /*
   * Leads the page when true: an active-Pass holder's first impression here
   * must be the Pass, not a possibly-zero credit balance that reads like
   * their purchase did nothing. `activePasses` is already ordered by
   * expires_at desc (furthest-out coverage first), matching the same choice
   * getActivePass makes for the masthead.
   */
  const leadingPass = (activePasses ?? [])[0] ?? null;

  /*
   * The purchase this confirmation is about: the newest successful row, which
   * the receipts query above already ordered that way. No extra round trip and
   * no reference in the URL to look one up with.
   */
  const justPurchased = purchased ? (purchases ?? [])[0] : undefined;
  const purchasedNext = (justPurchased &&
    PRODUCT_NEXT[justPurchased.product_type]) ??
    // Nothing to go on — the feed is the one destination that is right for
    // any account, seeker or employer.
    { href: "/jobs", label: "Browse jobs" };

  return (
    <div className="flex flex-col gap-10">
      <div>
        <EyebrowLabel>{leadingPass ? "Your Pass" : "Talentrah Credits"}</EyebrowLabel>
        <h1 className="mt-2 font-display text-[28px]">
          {leadingPass
            ? `${leadingPass.passes?.name ?? "Your Pass"} is active`
            : `Your balance: ${profile.credits_balance} credits`}
        </h1>
        <p className="mt-1 text-[14.5px] text-ink-soft">
          {leadingPass
            ? `Tailoring, cover letters, bullet rewrites, Auto-Apply beyond your free weekly runs, and scholarship checks are covered at zero credit cost. You also have ${profile.credits_balance} credits for template unlocks and Talent Directory verification, which stay credit-only.`
            : "Credits cover AI tailoring runs, cover letters, and premium templates beyond your free trial."}
        </p>
        {/*
          THE CONFIRMATION, rendered here rather than on the callback page.
          /billing/callback redirects here after fulfilment precisely so this
          balance and this banner are read in the SAME request, strictly after
          the grant — see the note there for what that fixes.

          Built from the receipt row the page already fetched, so it names what
          was bought, for how much, and quotes the reference support would ask
          for. The old copy said "Your credits or pass have been added",
          hedging between two products because it had no idea which one it was
          confirming.

          `justPurchased` can be undefined if someone hits ?purchased=1 by
          hand or the row is not visible yet; the banner degrades to the plain
          confirmation rather than rendering an empty receipt.
        */}
        {purchased && (
          <div className="mt-4 max-w-[560px] border-[1.5px] border-ink bg-card px-5 py-4">
            <EyebrowLabel size="sm">Payment received</EyebrowLabel>
            <p className="mt-1.5 font-display text-[20px] text-ink">
              You&apos;re all set.
            </p>
            {justPurchased ? (
              <>
                <p className="mt-1 text-[13.5px] text-ink-soft">
                  {PRODUCT_LABEL[justPurchased.product_type] ??
                    justPurchased.product_type}{" "}
                  · ₦{justPurchased.amount.toLocaleString()}
                  {justPurchased.paystack_reference
                    ? ` · Receipt ${justPurchased.paystack_reference}`
                    : ""}
                </p>
                <p className="mt-0.5 text-[13.5px] text-ink-soft">
                  Your balance above is up to date.
                </p>
              </>
            ) : (
              <p className="mt-1 text-[13.5px] text-ink-soft">
                Your balance above is up to date.
              </p>
            )}
            <Link
              href={purchasedNext.href}
              className="mt-3.5 inline-flex min-h-10 items-center justify-center border-none bg-ink px-[18px] py-[10px] font-body text-[13.5px] font-semibold text-paper no-underline transition-colors hover:bg-rust"
            >
              {purchasedNext.label}
            </Link>
          </div>
        )}
        {error === "payments_unavailable" && (
          <p className="mt-3 max-w-[560px] border-[1.5px] border-rust bg-rust-soft px-4 py-3 text-[13.5px] text-rust">
            That purchase couldn&apos;t start — payments aren&apos;t configured
            yet in this environment.
          </p>
        )}
        {!paystackConfigured && (
          <p
            className="mt-3 max-w-[560px] border-[1.5px] border-amber bg-[oklch(96%_0.03_70)] px-4 py-3 text-[13.5px]"
            style={{ color: "var(--amber)" }}
          >
            Payments aren&apos;t configured yet in this environment — buying
            will fail until Paystack keys are set.
          </p>
        )}
      </div>

      {(activePasses ?? []).length > 0 && (
        <div className="flex flex-col gap-4">
          <EyebrowLabel size="sm">Your active passes</EyebrowLabel>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {activePasses!.map((userPass) => (
              <BorderedCard
                key={userPass.id}
                className="flex flex-col gap-3 p-5"
              >
                <h3 className="text-[17px]">
                  {userPass.passes?.name ?? "Pass"}
                </h3>
                <p className="text-[13.5px] text-ink-soft">
                  Active until{" "}
                  {new Date(userPass.expires_at).toLocaleDateString()} · paid by{" "}
                  {userPass.payment_method === "card"
                    ? "card"
                    : "mobile money / bank"}
                </p>
                {userPass.auto_renew_status === "active" && (
                  <>
                    <p className="text-[13.5px] text-ink-soft">
                      Auto-renews on{" "}
                      {formatDateOnly(userPass.next_renewal_date)}. You&apos;ll
                      get a reminder before you&apos;re charged.
                    </p>
                    <form
                      action={cancelAutoRenewAction.bind(null, userPass.id)}
                    >
                      <Button type="submit" size="sm" variant="secondary">
                        Cancel auto-renewal
                      </Button>
                    </form>
                  </>
                )}
                {userPass.auto_renew_status === "canceled" && (
                  <p className="text-[13.5px] text-ink-soft">
                    Auto-renewal canceled — access continues until it expires,
                    then this Pass won&apos;t renew.
                  </p>
                )}
                {userPass.auto_renew_status === "lapsed" && (
                  <p className="max-w-[420px] border-[1.5px] border-rust bg-rust-soft px-3 py-2 text-[13px] text-rust">
                    A renewal charge failed, so this Pass won&apos;t auto-renew.
                    Buy a new one below to keep access after it expires.
                  </p>
                )}
                {userPass.payment_method === "mobile_money" &&
                  !userPass.auto_renew_status && (
                    <p className="text-[13.5px] text-ink-soft">
                      One-time — mobile money and bank rails don&apos;t support
                      auto-renewal.
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
              <p className="text-[13.5px] text-ink-soft">
                {pack.credits} credits
              </p>
              {PACK_DESCRIPTION[pack.name] && (
                <p className="text-[13px] text-ink-soft">{PACK_DESCRIPTION[pack.name]}</p>
              )}
              <p className="font-display text-[24px]">
                ₦{pack.price_ngn.toLocaleString()}
              </p>
              <form
                action={initiatePurchaseAction.bind(
                  null,
                  "credit_pack",
                  pack.id,
                )}
              >
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
                {PASS_HEADLINE[pass.name] ?? `Unlimited access for ${pass.duration_days} days`}
              </p>
              <p className="text-[13px] text-ink-soft">
                Covers tailoring, cover letters, bullet rewrites, Auto-Apply
                beyond your free weekly runs, and scholarship eligibility
                checks and SOP drafts — all at zero credit cost, up to{" "}
                {PASS_DAILY_ACTION_CAP} actions a day. Template unlocks and
                Talent Directory verification are sold separately, credits
                only. Auto-renews if paid by card; one-time if paid by mobile
                money.
              </p>
              <p className="font-display text-[24px]">
                ₦{pass.price_ngn.toLocaleString()}
              </p>
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
                    {p.channel
                      ? ` · ${p.channel}`
                      : p.rail
                        ? ` · ${p.rail}`
                        : ""}
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
