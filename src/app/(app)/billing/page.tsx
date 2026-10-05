import Link from "next/link";
import { requireUser } from "@/lib/auth/require-user";
import { createClient } from "@/lib/supabase/server";
import { EyebrowLabel } from "@/components/ui";
import { receiptNumber } from "@/lib/billing/receipt-number";
import { activityRows, PRODUCT_LABEL, splitPasses, type UserPassRow } from "@/lib/billing/billing-view";
import { nowMs } from "@/lib/passes/pass-timing";
import { RECEIPT_MESSAGE } from "@/lib/billing/receipt-messages";
import { BillingContent } from "@/components/billing/billing-content";
import { PaymentReference } from "@/components/billing/payment-reference";

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

export const metadata = { title: "Credits & Passes — Talentrah" };

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; purchased?: string; receipt?: string }>;
}) {
  const { profile } = await requireUser();
  const supabase = await createClient();
  const { error, purchased, receipt } = await searchParams;

  const [
    { data: packs },
    { data: passes },
    { data: userPasses },
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
    /*
     * Every pass whose status is still 'active', furthest expiry first. That is NOT the same as "running": nothing ever flips `status`
     * when `expires_at` passes (src/lib/passes/entitlement.ts), so ended passes come back too, and splitPasses() decides which are live.
     * The card-token column (`authorization_code`) is deliberately not selected: nothing on this page needs it.
     */
    supabase
      .from("user_passes")
      .select(
        "id, pass_id, payment_method, auto_renew_status, next_renewal_date, expires_at, started_at, payment_transaction_id, status, passes(name)",
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
     * `product_id` is read only to NAME the product (a pack or a pass from the lists above) in the activity table. The FK cannot be
     * followed: it points at `credit_packs` for one product_type and `passes` for another (and at nothing at all for a wallet top-up,
     * nullable since 0050), so there is no single relation to embed. A row whose product is not in the active lists (a retired pack)
     * falls back to its generic label.
     */
    supabase
      .from("payment_transactions")
      .select(
        "id, amount, currency, product_type, product_id, rail, channel, paystack_reference, created_at",
      )
      .eq("user_id", profile.id)
      .eq("status", "success")
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  const paystackConfigured = !!process.env.PAYSTACK_SECRET_KEY;

  const now = nowMs();
  const split = splitPasses((userPasses ?? []) as unknown as UserPassRow[], now);
  const passList = passes ?? [];
  const packList = packs ?? [];
  const rows = activityRows(purchases ?? [], packList, passList, split.live);

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

  /* What "Email me this receipt" came back with (resendReceiptAction redirects here with ?receipt=<outcome>). Unknown values say nothing. */
  const receiptMessage = receipt && Object.hasOwn(RECEIPT_MESSAGE, receipt) ? RECEIPT_MESSAGE[receipt as keyof typeof RECEIPT_MESSAGE] : undefined;

  return (
    <div data-billing-page className="@container flex flex-col gap-10">
      <div>
        <EyebrowLabel size="sm">Talentrah billing</EyebrowLabel>
        <h1 className="mt-2 font-display text-[28px]">Billing</h1>
        {/*
          THE CONFIRMATION, rendered here rather than on the callback page.
          /billing/callback redirects here after fulfilment precisely so this
          balance and this banner are read in the SAME request, strictly after
          the grant — see the note there for what that fixes.

          Built from the receipt row the page already fetched, so it names what
          was bought, for how much, and quotes the reference support would ask
          for. `justPurchased` can be undefined if someone hits ?purchased=1 by
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
                  {/* One string: the sign and the amount are a single text node (send-503). */}
                  {`${PRODUCT_LABEL[justPurchased.product_type] ?? justPurchased.product_type} · ₦${justPurchased.amount.toLocaleString("en-NG")}${
                    justPurchased.paystack_reference
                      ? ` · Receipt ${receiptNumber(justPurchased.product_type, justPurchased.paystack_reference)}`
                      : ""
                  }`}
                </p>
                {justPurchased.paystack_reference && (
                  <PaymentReference reference={justPurchased.paystack_reference} />
                )}
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
              className="mt-3.5 inline-flex min-h-11 items-center justify-center border-none bg-ink px-[18px] py-[10px] font-body text-[13.5px] font-semibold text-paper no-underline transition-colors hover:bg-rust"
            >
              {purchasedNext.label}
            </Link>
          </div>
        )}
        {receiptMessage && (
          <p role="status" className="mt-3 max-w-[560px] border-[1.5px] border-ink bg-card px-4 py-3 text-[13.5px] text-ink">
            {receiptMessage}
          </p>
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

      <BillingContent balance={profile.credits_balance} packs={packList} passes={passList} split={split} rows={rows} now={now} />
    </div>
  );
}
