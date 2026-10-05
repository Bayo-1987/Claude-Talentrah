/**
 * What the billing page shows, worked out from the rows it already reads. Pure: no I/O, no clock of its own, no Supabase.
 *
 * Kept out of page.tsx so the decisions (which pass is "the" pass, whether a pass has ended, what an activity row is called, which
 * row is tagged Active) can be tested without rendering, and so the page itself stays markup.
 *
 * ── EXPIRY ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
 * `user_passes.status` is never flipped away from 'active' when `expires_at` passes (src/lib/passes/entitlement.ts explains why), so
 * the page's query returns ended passes too. A pass is LIVE only while `expires_at` is in the future: the same rule `hasActivePass`
 * and `getActivePass` apply. The page used to skip that check and show an ended pass as "active".
 */
import { formatCalendarDate, formatDate } from "@/lib/format/datetime";

export interface UserPassRow {
  id: string;
  pass_id: string;
  payment_method: "card" | "mobile_money";
  auto_renew_status: "active" | "canceled" | "lapsed" | null;
  next_renewal_date: string | null;
  expires_at: string;
  started_at: string;
  payment_transaction_id: string | null;
  passes: { name: string } | null;
}

export interface PurchaseRow {
  id: string;
  amount: number;
  currency: string;
  product_type: string;
  product_id: string | null;
  rail: string;
  channel: string | null;
  paystack_reference: string | null;
  created_at: string;
}

export interface PackRow {
  id: string;
  name: string;
  credits: number;
}

export interface PassProductRow {
  id: string;
  name: string;
  duration_days: number;
  price_ngn: number;
}

/** What each product_type is called when no pack or pass can be named (a retired pack, a wallet top-up). */
export const PRODUCT_LABEL: Record<string, string> = {
  credit_pack: "Credit pack",
  pass: "Talentrah Pass",
  ad_wallet_topup: "Ad wallet top-up",
};

export interface PassSplit {
  /** Passes still running, furthest expiry first (the order the page's query returns). */
  live: UserPassRow[];
  /** The one the page leads with: the one that expires last. */
  leading: UserPassRow | null;
  /** How many more are running besides the leading one. */
  otherLive: UserPassRow[];
  /** The most recently ended pass, when nothing is running. */
  lastEnded: UserPassRow | null;
}

export function splitPasses(rows: readonly UserPassRow[], now: number): PassSplit {
  const live = rows.filter((r) => new Date(r.expires_at).getTime() > now);
  const ended = rows.filter((r) => new Date(r.expires_at).getTime() <= now);
  const leading = live[0] ?? null;
  return { live, leading, otherLive: live.slice(1), lastEnded: leading ? null : (ended[0] ?? null) };
}

/**
 * What a second pass does to the first: nothing is added on. fulfill_credit_pack_or_pass (0159) sets `expires_at = now() + duration` and never
 * reads existing passes, so a new pass starts today and runs ALONGSIDE the running one. This says so, naming the pass whose coverage runs
 * longest (the one the page leads with) and its end date. It describes how the purchase already works; it changes nothing about it.
 */
export function passOverlapNotice(leading: UserPassRow): string {
  return `Your ${leading.passes?.name ?? "Pass"} is active until ${formatDate(leading.expires_at)}. A new pass starts today and runs alongside it; the time left on your current pass isn't added on.`;
}

export type PassNotice = "reminder" | "canceled" | "lapsed" | null;

export interface PassDateLine {
  /** "Renews 22 Oct 2026" or "Ends 22 Oct 2026". */
  text: string;
  kind: "renews" | "ends";
  /** A card-paid pass that is still set to renew can be cancelled (cancelAutoRenewAction). */
  canCancel: boolean;
  notice: PassNotice;
}

/**
 * Renews only while auto-renew is active (card-paid); everything else ends on its expiry date, which is the truthful word for a
 * mobile-money pass (one-time), a cancelled one (runs out) and a lapsed one (the renewal charge failed).
 */
export function passDateLine(pass: UserPassRow): PassDateLine {
  if (pass.auto_renew_status === "active") {
    const date = pass.next_renewal_date ? formatCalendarDate(pass.next_renewal_date) : formatDate(pass.expires_at);
    return { text: `Renews ${date}`, kind: "renews", canCancel: true, notice: "reminder" };
  }
  return {
    text: `Ends ${formatDate(pass.expires_at)}`,
    kind: "ends",
    canCancel: false,
    notice: pass.auto_renew_status === "canceled" ? "canceled" : pass.auto_renew_status === "lapsed" ? "lapsed" : null,
  };
}

export interface ActivityRow {
  id: string;
  date: string;
  item: string;
  /** "card", "bank", the rail: what the old list showed under the date. */
  via: string | null;
  amount: number;
  reference: string | null;
  productType: string;
  /** This payment started a pass that is still running. */
  active: boolean;
  /** A credit pack or a pass with a Paystack reference: the only rows "Email me this receipt" is offered on (resendReceiptAction accepts the same). */
  resendable: boolean;
}

export function activityRows(
  purchases: readonly PurchaseRow[],
  packs: readonly PackRow[],
  passes: readonly PassProductRow[],
  livePasses: readonly UserPassRow[],
): ActivityRow[] {
  const liveTransactions = new Set(livePasses.map((p) => p.payment_transaction_id).filter((v): v is string => !!v));
  return purchases.map((p) => {
    let item = PRODUCT_LABEL[p.product_type] ?? p.product_type;
    if (p.product_type === "credit_pack") {
      const pack = packs.find((x) => x.id === p.product_id);
      if (pack) item = `${pack.name} pack · ${pack.credits} credits`;
    } else if (p.product_type === "pass") {
      const pass = passes.find((x) => x.id === p.product_id);
      if (pass) item = pass.name;
    }
    return {
      id: p.id,
      date: formatDate(p.created_at),
      item,
      via: p.channel ?? p.rail ?? null,
      amount: p.amount,
      reference: p.paystack_reference,
      productType: p.product_type,
      active: liveTransactions.has(p.id),
      resendable: !!p.paystack_reference && (p.product_type === "credit_pack" || p.product_type === "pass"),
    };
  });
}
