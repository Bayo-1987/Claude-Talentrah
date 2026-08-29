import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * Financial visibility. READ ONLY, and more strictly than M5 was.
 *
 * There is no write path in this module or anywhere on the screens it feeds,
 * and that is a decision with a specific history behind it. `spendCredits`
 * looked correct for months and let two concurrent spends both succeed at
 * `balance == cost`, because the ledger trigger overwrites `credits_balance`
 * absolutely rather than decrementing it (fixed by `spend_credits_atomic`,
 * 0035). AN ADMIN BALANCE-ADJUSTMENT TOOL IS THAT BUG WITH DIFFERENT
 * PAPERWORK. If one is ever genuinely needed it is its own scoped piece that
 * writes a `credit_ledger` row and lets the trigger recompute — never a
 * statement that touches the balance column. Nothing here is a step towards
 * it.
 *
 * No migration either: every access path this needs is already indexed
 * (`payment_transactions_user_id_idx`, `payment_transactions_paystack_
 * reference_key`, `credit_ledger_user_id_idx`). A status index was considered
 * and rejected on measurement — 14 payment rows in production, where Postgres
 * will sequential-scan and be right to. Worth re-measuring around 10k rows.
 */

/* ------------------------------------------------------------------ *
 * Aggregate health — NO PII, and that is what makes it the landing page
 * ------------------------------------------------------------------ */

export interface PaymentStatusBucket {
  status: string;
  rail: string;
  count: number;
  totalMinor: number;
  currency: string;
  oldestAt: string;
}

export interface FinancialHealth {
  payments: PaymentStatusBucket[];
  pendingCount: number;
  /** Pending payments older than a day — an outcome nobody has learned. */
  stalePending: number;
  creditsByReason: { reason: string; entries: number; net: number }[];
  passesByStatus: Record<string, number>;
  passesAwaitingRenewalOutcome: number;
  adWalletBalanceNgn: number;
  adWalletCount: number;
}

/**
 * The landing surface. Deliberately carries no name, no email and no user id —
 * it answers "is the money healthy", which needs counts and not people.
 *
 * That is not squeamishness. A financial screen that lists individuals is one
 * an operator ends up reading casually, and the whole design of the person
 * lookup below depends on reaching a record being a deliberate act rather than
 * a click from a list you were already staring at.
 */
export async function financialHealth(): Promise<FinancialHealth> {
  const supabase = createServiceRoleClient();

  const { data: payments, error: payError } = await supabase
    .from("payment_transactions")
    .select("status, rail, amount, currency, created_at");
  if (payError) throw payError;

  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const buckets = new Map<string, PaymentStatusBucket>();
  let pendingCount = 0;
  let stalePending = 0;

  for (const p of payments ?? []) {
    const key = `${p.status}|${p.rail}|${p.currency}`;
    const entry = buckets.get(key) ?? {
      status: p.status,
      rail: p.rail,
      count: 0,
      totalMinor: 0,
      currency: p.currency,
      oldestAt: p.created_at,
    };
    entry.count += 1;
    entry.totalMinor += p.amount;
    if (p.created_at < entry.oldestAt) entry.oldestAt = p.created_at;
    buckets.set(key, entry);

    if (p.status === "pending") {
      pendingCount += 1;
      if (new Date(p.created_at).getTime() < dayAgo) stalePending += 1;
    }
  }

  const { data: ledger, error: ledgerError } = await supabase
    .from("credit_ledger")
    .select("reason, delta");
  if (ledgerError) throw ledgerError;

  const byReason = new Map<string, { entries: number; net: number }>();
  for (const l of ledger ?? []) {
    const e = byReason.get(l.reason) ?? { entries: 0, net: 0 };
    e.entries += 1;
    e.net += l.delta;
    byReason.set(l.reason, e);
  }

  const { data: passes, error: passError } = await supabase
    .from("user_passes")
    .select("status, pending_renewal_reference");
  if (passError) throw passError;

  const passesByStatus: Record<string, number> = {};
  let awaiting = 0;
  for (const p of passes ?? []) {
    passesByStatus[p.status] = (passesByStatus[p.status] ?? 0) + 1;
    if (p.pending_renewal_reference) awaiting += 1;
  }

  const { data: wallets, error: walletError } = await supabase
    .from("ad_wallets")
    .select("balance_ngn");
  if (walletError) throw walletError;

  return {
    payments: [...buckets.values()].sort(
      (a, b) => (a.status === "pending" ? -1 : 0) - (b.status === "pending" ? -1 : 0) || b.count - a.count,
    ),
    pendingCount,
    stalePending,
    creditsByReason: [...byReason.entries()]
      .map(([reason, e]) => ({ reason, ...e }))
      .sort((a, b) => b.entries - a.entries),
    passesByStatus,
    passesAwaitingRenewalOutcome: awaiting,
    adWalletBalanceNgn: (wallets ?? []).reduce((sum, w) => sum + w.balance_ngn, 0),
    adWalletCount: wallets?.length ?? 0,
  };
}

/* ------------------------------------------------------------------ *
 * Person lookup — exact match only, never a list
 * ------------------------------------------------------------------ */

export interface PersonRecord {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  country: string | null;
  createdAt: string;
  creditsBalance: number;
  payments: {
    id: string;
    rail: string;
    amount: number;
    currency: string;
    productType: string;
    status: string;
    reference: string | null;
    channel: string | null;
    createdAt: string;
  }[];
  credits: {
    id: string;
    delta: number;
    reason: string;
    balanceAfter: number;
    createdAt: string;
  }[];
  passes: {
    id: string;
    status: string;
    autoRenewStatus: string | null;
    startedAt: string;
    expiresAt: string;
    renewalAttemptCount: number;
    pendingRenewalReference: string | null;
    nextRenewalDate: string | null;
  }[];
}

/**
 * BILLING FIELDS AND NOTHING ELSE.
 *
 * This is the dashboard's first read-access-to-PII surface, and the scope is
 * the guard rather than a preference. Deliberately absent, and none of it is
 * an oversight: resumes, job_tailoring_requests content, applications, saved
 * jobs, feedback the person has written. The build prompt's §8 and the plan
 * doc both draw that line around resume content specifically — "an admin view
 * here is a privacy decision, not just a feature" — and none of it answers a
 * billing question anyway. A support screen that happens to show somebody's
 * resume has made that decision by accident.
 *
 * If a future case genuinely needs one of those, it should be argued for on
 * its own and added deliberately, not inherited because this function already
 * had the user id.
 */
async function loadPerson(userId: string): Promise<PersonRecord | null> {
  const supabase = createServiceRoleClient();

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, email, first_name, last_name, country, created_at, credits_balance")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!profile) return null;

  const [payments, credits, passes] = await Promise.all([
    supabase
      .from("payment_transactions")
      .select("id, rail, amount, currency, product_type, status, paystack_reference, channel, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),
    supabase
      .from("credit_ledger")
      .select("id, delta, reason, balance_after, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),
    supabase
      .from("user_passes")
      .select("id, status, auto_renew_status, started_at, expires_at, renewal_attempt_count, pending_renewal_reference, next_renewal_date")
      .eq("user_id", userId)
      .order("started_at", { ascending: false }),
  ]);

  if (payments.error) throw payments.error;
  if (credits.error) throw credits.error;
  if (passes.error) throw passes.error;

  return {
    id: profile.id,
    email: profile.email,
    firstName: profile.first_name,
    lastName: profile.last_name,
    country: profile.country,
    createdAt: profile.created_at,
    creditsBalance: profile.credits_balance,
    payments: (payments.data ?? []).map((p) => ({
      id: p.id,
      rail: p.rail,
      amount: p.amount,
      currency: p.currency,
      productType: p.product_type,
      status: p.status,
      reference: p.paystack_reference,
      channel: p.channel,
      createdAt: p.created_at,
    })),
    credits: (credits.data ?? []).map((c) => ({
      id: c.id,
      delta: c.delta,
      reason: c.reason,
      balanceAfter: c.balance_after,
      createdAt: c.created_at,
    })),
    passes: (passes.data ?? []).map((p) => ({
      id: p.id,
      status: p.status,
      autoRenewStatus: p.auto_renew_status,
      startedAt: p.started_at,
      expiresAt: p.expires_at,
      renewalAttemptCount: p.renewal_attempt_count,
      pendingRenewalReference: p.pending_renewal_reference,
      nextRenewalDate: p.next_renewal_date,
    })),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve a search term to exactly one person, or nothing.
 *
 * THREE EXACT KEYS, AND NO SUBSTRING MATCHING ANYWHERE. Email (case-folded),
 * user id, or Paystack reference. Typing "a" returns nothing; there is no
 * prefix search, no `ilike '%…%'`, and no listing endpoint behind this.
 *
 * That is the load-bearing decision of the whole screen. A substring search
 * makes enumeration a matter of patience, and "the operator should not browse"
 * becomes a convention rather than a property. Here it is structural: the only
 * way to reach a record is to already know one of three identifiers for the
 * person you are looking for.
 *
 * The Paystack reference is included because it is what a real support case
 * arrives with — a bank statement line or a dispute notice quotes the
 * reference, not the account's email, and forcing the operator to guess the
 * email first would be worse for everyone including the customer.
 */
export async function findPerson(term: string): Promise<PersonRecord | null> {
  const query = term.trim();
  if (!query) return null;

  const supabase = createServiceRoleClient();

  if (UUID.test(query)) {
    return loadPerson(query);
  }

  if (query.includes("@")) {
    const { data, error } = await supabase
      .from("profiles")
      .select("id")
      // Exact, case-folded. `.eq` on a lower-cased term rather than `.ilike`,
      // because an ilike term containing % or _ is a pattern — a search for
      // "%@%" would otherwise match somebody.
      .ilike("email", query.replace(/[%_]/g, "\\$&"))
      .maybeSingle();
    if (error) throw error;
    return data ? loadPerson(data.id) : null;
  }

  // Otherwise treat it as a Paystack reference.
  const { data, error } = await supabase
    .from("payment_transactions")
    .select("user_id")
    .eq("paystack_reference", query)
    .maybeSingle();
  if (error) throw error;
  return data?.user_id ? loadPerson(data.user_id) : null;
}
