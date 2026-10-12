/**
 * The Talent Directory subscription lifecycle, as an employer would meet it. Two bugs, written first and red, now fixed (0228):
 *
 *   (a) An EXPIRED subscription that was not paid by a reusable card (so no renewal job ever touches it) stays status = 'active'. Nothing
 *       flips it. The purchase action then refuses ("already has an active subscription"), and if the check were bypassed the partial
 *       unique index (one 'active' row per organisation, 0135) would refuse the new row's activation AFTER Paystack has taken the money,
 *       leaving a paid, pending subscription and a payment marked success.
 *   (b) expires_at is fixed when Subscribe is PRESSED (subscription-actions.ts), not when payment is confirmed, so every minute spent on
 *       the Paystack page, and every hour before a delayed webhook, is taken off the 30 days the employer paid for.
 *
 * The assertions describe the behaviour the employer should get, not a particular fix. The database is modelled in memory with the one
 * rule that matters here, copied from 0135: at most one row per organisation may have status = 'active', whatever its expires_at (a
 * partial-index predicate cannot use now()). The Paystack call and the clock are mocked; fulfillPayment, the purchase action and the daily
 * lapse are real. The activation function is a MODEL of activate_talent_directory_subscription (0228) written beside the fake table: this
 * file proves the TypeScript around it (what it passes, how it treats each outcome, the purchase check, the sweep). The SQL itself is
 * proven separately: against a production-like schema locally, and by tests/talent-directory/activate-subscription.test.ts in CI.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const world = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  paystackCalls: 0,
  verify: { status: "success", amount: 20_000_000, currency: "NGN", channel: "bank", authorization: null as null | { reusable: boolean; authorization_code: string } },
  nextId: 1,
  refundAlerts: [] as Array<{ reference: string; reason: string }>,
  /** When set, the activation RPC answers this instead of the model (a race outcome, an empty answer, a database error). */
  activateOverride: null as null | { data: unknown; error: null | { message: string } },
  /** The arguments of every activation call as they travel over the wire: JSON, which DROPS a property whose value is undefined (PostgREST then cannot find a function that has no default for it). */
  activateWire: [] as Array<Record<string, unknown>>,
}));

/** A model of public.activate_talent_directory_subscription (0228): the same four outcomes and the same rules, over the in-memory rows. */
function activate(args: Record<string, unknown>): { activated: boolean; reason: string; expires_at: string | null; plan_name: string | null } {
  const subsRows = (world.tables.talent_directory_subscriptions ??= []);
  const sub = subsRows.find((r) => r.id === args.p_subscription_id);
  const no = (reason: string) => ({ activated: false, reason, expires_at: null, plan_name: null });
  if (!sub) return no("not_found");
  if (sub.status !== "pending_payment") return no("not_pending");
  const plan = (world.tables.talent_directory_plans ?? []).find((p) => p.id === sub.plan_id);
  if (!plan) return no("plan_missing");
  const now = Date.now();
  for (const o of subsRows) {
    if (o !== sub && o.organization_id === sub.organization_id && o.status === "active" && new Date(String(o.expires_at)).getTime() <= now && o.auto_renew_status !== "active") o.status = "lapsed";
  }
  if (subsRows.some((o) => o !== sub && o.organization_id === sub.organization_id && o.status === "active")) return no("already_active");
  const expires = new Date(now + Number(plan.duration_days) * 86_400_000);
  Object.assign(sub, {
    status: "active",
    started_at: new Date(now).toISOString(),
    expires_at: expires.toISOString(),
    auto_renew_status: args.p_auto_renew ? "active" : null,
    next_renewal_date: args.p_auto_renew ? expires.toISOString().slice(0, 10) : null,
    authorization_code: args.p_authorization_code ?? null,
    payment_transaction_id: args.p_payment_transaction_id ?? null,
  });
  return { activated: true, reason: "activated", expires_at: expires.toISOString(), plan_name: String(plan.name) };
}

vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: "localhost:3000" }) }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
vi.mock("@/lib/employer/membership", () => ({
  requireEmployer: async () => ({ userId: "user-1", userEmail: "owner@example.test", emailConfirmed: true, organization: { id: "org-1" }, role: "owner" }),
}));
vi.mock("@/lib/paystack/client", () => ({
  NGN_CHANNELS: ["card"],
  initializeTransaction: async () => {
    world.paystackCalls += 1;
    return { authorization_url: "https://paystack.example/checkout" };
  },
  verifyTransaction: async () => ({ ...world.verify }),
}));
vi.mock("@/lib/resend/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/resend/client")>()), getResendClient: () => null }));
vi.mock("@/lib/analytics/posthog", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/analytics/posthog")>()), captureEvent: () => {} }));
vi.mock("@/lib/mentorship/refund-alert", () => ({
  alertDeletedUserPayment: async () => {},
  alertPaymentNeedsRefund: async () => {},
  alertSubscriptionPaymentNeedsRefund: async (a: { reference: string; reason: string }) => {
    world.refundAlerts.push({ reference: a.reference, reason: a.reason });
  },
}));

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    rpc: async (name: string, args?: Record<string, unknown>) => {
      if (name === "talent_directory_listed_count") return { data: 25, error: null };
      if (name === "activate_talent_directory_subscription") world.activateWire.push(JSON.parse(JSON.stringify(args ?? {})));
      if (name === "activate_talent_directory_subscription") return world.activateOverride ?? { data: [activate(args ?? {})], error: null };
      return { data: null, error: { message: `unexpected rpc ${name}` } };
    },
    from: (table: string) => {
      const rows = () => (world.tables[table] ??= []);
      type Pred = (r: Row) => boolean;
      const preds: Pred[] = [];
      let mode: "select" | "insert" | "update" | "delete" = "select";
      let payload: Row = {};
      let orderBy: [string, boolean] | null = null;
      let max = Infinity;
      const matched = () => {
        let out = rows().filter((r) => preds.every((p) => p(r)));
        if (orderBy) out = [...out].sort((a, b) => (String(a[orderBy![0]]) < String(b[orderBy![0]]) ? -1 : 1) * (orderBy![1] ? 1 : -1));
        return out.slice(0, max);
      };
      /** The only constraint this suite needs: 0135's partial unique index. */
      const violatesOneActivePerOrg = (candidate: Row, self?: Row) =>
        table === "talent_directory_subscriptions" &&
        candidate.status === "active" &&
        rows().some((o) => o !== self && o.organization_id === candidate.organization_id && o.status === "active");
      const run = (): { data: Row[]; error: null | { code: string; message: string } } => {
        if (mode === "insert") {
          const row: Row = { id: `${table}-${world.nextId++}`, status: table === "talent_directory_subscriptions" ? "pending_payment" : "pending", started_at: new Date().toISOString(), ...payload };
          if (violatesOneActivePerOrg(row)) return { data: [], error: { code: "23505", message: "duplicate key value violates unique constraint talent_directory_subscriptions_one_active_per_org" } };
          rows().push(row);
          return { data: [row], error: null };
        }
        if (mode === "update") {
          const hit = matched();
          for (const r of hit) if (violatesOneActivePerOrg({ ...r, ...payload }, r)) return { data: [], error: { code: "23505", message: "duplicate key value violates unique constraint talent_directory_subscriptions_one_active_per_org" } };
          for (const r of hit) Object.assign(r, payload);
          return { data: hit, error: null };
        }
        const hit = matched();
        return { data: table === "talent_directory_subscriptions" ? hit.map((r) => ({ ...r, talent_directory_plans: { name: "Local Sourcing — Monthly" } })) : hit, error: null };
      };
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.insert = (row: Row) => ((mode = "insert"), (payload = row), q);
      q.update = (row: Row) => ((mode = "update"), (payload = row), q);
      q.delete = () => ((mode = "delete"), q);
      const add = (name: string, make: (c: string, v: unknown) => Pred) => (q[name] = (c: string, v: unknown) => (preds.push(make(c, v)), q));
      add("eq", (c, v) => (r) => r[c] === v);
      add("neq", (c, v) => (r) => r[c] !== v);
      add("gt", (c, v) => (r) => String(r[c]) > String(v));
      add("gte", (c, v) => (r) => String(r[c]) >= String(v));
      add("lt", (c, v) => (r) => String(r[c]) < String(v));
      add("lte", (c, v) => (r) => String(r[c]) <= String(v));
      q.or = (expr: string) => {
        preds.push((r) =>
          expr.split(",").some((clause) => {
            const [col, op, ...rest] = clause.split(".");
            const val = rest.join(".");
            if (op === "gt") return String(r[col]) > val;
            if (op === "eq") return String(r[col]) === val;
            if (op === "neq") return String(r[col]) !== val;
            if (op === "is") return val === "null" ? r[col] == null : r[col] != null;
            throw new Error(`or(): unsupported clause ${clause}`);
          }),
        );
        return q;
      };
      q.order = (c: string, o?: { ascending?: boolean }) => ((orderBy = [c, o?.ascending !== false]), q);
      q.limit = (n: number) => ((max = n), q);
      q.single = async () => { const { data, error } = run(); return { data: data[0] ?? null, error: data[0] ? error : error ?? { code: "PGRST116", message: "no rows" } }; };
      q.maybeSingle = async () => { const { data, error } = run(); return { data: data[0] ?? null, error }; };
      q.then = (resolve: (v: unknown) => void) => resolve(run());
      return q;
    },
  }),
}));

import { purchaseTalentDirectorySubscriptionAction } from "@/lib/talent-directory/subscription-actions";
import { fulfillPayment } from "@/lib/billing/fulfill";
import { lapseEndedTalentDirectorySubscriptions } from "@/lib/talent-directory/renewals";

const DAY = 86_400_000;
const T0 = Date.parse("2026-11-03T09:00:00.000Z");

const subs = () => world.tables.talent_directory_subscriptions ?? [];
const txns = () => world.tables.payment_transactions ?? [];
async function click(): Promise<string> {
  try {
    await purchaseTalentDirectorySubscriptionAction("plan-1");
  } catch (e) {
    return (e as Error).message;
  }
  return "RETURNED";
}
function activeRow(over: Row = {}): Row {
  return { id: "old-sub", organization_id: "org-1", plan_id: "plan-1", status: "active", started_at: new Date(T0 - 40 * DAY).toISOString(), expires_at: new Date(T0 - 10 * DAY).toISOString(), auto_renew_status: null, next_renewal_date: null, authorization_code: null, ...over };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  world.tables = { talent_directory_plans: [{ id: "plan-1", name: "Local Sourcing — Monthly", price_ngn: 200000, duration_days: 30, is_active: true }], talent_directory_subscriptions: [], payment_transactions: [] };
  world.paystackCalls = 0;
  world.refundAlerts = [];
  world.activateOverride = null;
  world.activateWire = [];
  world.verify = { status: "success", amount: 20_000_000, currency: "NGN", channel: "bank", authorization: null };
});
afterEach(() => vi.useRealTimers());

describe("(a) an expired subscription does not block a new one", () => {
  it("an organisation whose only 'active' subscription ended 10 days ago can subscribe again: a pending row, a pending payment, the Paystack redirect", async () => {
    subs().push(activeRow());
    const outcome = await click();
    expect(outcome, "the purchase was refused although the old subscription ended").toBe("REDIRECT:https://paystack.example/checkout");
    expect(subs().filter((s) => s.status === "pending_payment")).toHaveLength(1);
    expect(world.paystackCalls).toBe(1);
  });

  it("control: a subscription that is still running DOES block a second one (the guard is not simply removed)", async () => {
    subs().push(activeRow({ expires_at: new Date(T0 + 5 * DAY).toISOString() }));
    const outcome = await click();
    expect(decodeURIComponent(outcome)).toMatch(/already has an active subscription/i);
    expect(subs()).toHaveLength(1);
    expect(world.paystackCalls).toBe(0);
  });

  it("paying for the new one activates it, even though an old row still says 'active': the new row becomes active and the old one no longer does", async () => {
    subs().push(activeRow());
    await click().catch(() => undefined);
    const pending = subs().find((s) => s.status === "pending_payment");
    expect(pending, "no pending row to pay for (the purchase was refused)").toBeDefined();
    const txn = txns()[0];
    const result = await fulfillPayment(String(txn?.paystack_reference ?? "missing"));
    expect(result.status).toBe("success");
    expect(pending!.status, "paid, but the subscription never became active").toBe("active");
    expect(subs().filter((s) => s.organization_id === "org-1" && s.status === "active")).toHaveLength(1);
  });
});

describe("(a) the hazard behind the purchase check: a payment for a pending row while an expired row still says 'active'", () => {
  it("the customer paid (payment marked success), so the new subscription must be active, not left pending behind the old row", async () => {
    subs().push(activeRow());
    subs().push({ id: "new-sub", organization_id: "org-1", plan_id: "plan-1", status: "pending_payment", started_at: new Date(T0).toISOString(), expires_at: new Date(T0 + 30 * DAY).toISOString() });
    txns().push({ id: "txn-1", user_id: "user-1", organization_id: "org-1", status: "pending", amount: 200000, currency: "NGN", product_type: "talent_directory_subscription", product_id: "new-sub", paystack_reference: "talent_directory_subscription_x" });
    const result = await fulfillPayment("talent_directory_subscription_x");
    expect(txns()[0].status, "the payment is recorded as taken").toBe("success");
    expect(result.status).toBe("success");
    expect(subs().find((s) => s.id === "new-sub")!.status, "money taken, subscription never activated (the unique index refused it)").toBe("active");
  });
});

describe("(b) the paid period starts when payment is confirmed, not when Subscribe was pressed", () => {
  it("pressed at 09:00, confirmed three hours later: expires 30 days after the confirmation", async () => {
    await click().catch(() => undefined);
    const txn = txns()[0];
    expect(txn, "the purchase did not create a payment row").toBeDefined();
    vi.setSystemTime(T0 + 3 * 3600_000);
    const result = await fulfillPayment(String(txn.paystack_reference));
    expect(result.status).toBe("success");
    const sub = subs()[0];
    expect(sub.status).toBe("active");
    const expected = T0 + 3 * 3600_000 + 30 * DAY;
    expect(Math.abs(new Date(String(sub.expires_at)).getTime() - expected), "expires_at was fixed at the click, so three hours of the paid month were lost").toBeLessThan(5_000);
  });

  it("the activation call carries ALL FOUR arguments over the wire, including for a payment with no card token (null, never undefined): a dropped argument is PGRST202 after the money is taken", async () => {
    // A mobile-money or bank-transfer payment has no reusable authorization, so authorizationCode is null. JSON drops an undefined property, and the function (0228) has no defaults,
    // so an omitted p_authorization_code is "function not found" and the confirmation would throw for ever while the customer has paid.
    world.verify = { ...world.verify, channel: "mobile_money", authorization: null };
    await click().catch(() => undefined);
    await fulfillPayment(String(txns()[0].paystack_reference));
    expect(world.activateWire).toHaveLength(1);
    expect(Object.keys(world.activateWire[0]).sort()).toEqual(["p_authorization_code", "p_auto_renew", "p_payment_transaction_id", "p_subscription_id"]);
    expect(world.activateWire[0].p_authorization_code).toBeNull();
    expect(world.activateWire[0].p_auto_renew).toBe(false);
  });

  it("a card payment that renews automatically: next_renewal_date is the day the period really ends", async () => {
    world.verify = { ...world.verify, channel: "card", authorization: { reusable: true, authorization_code: "AUTH_x" } };
    await click().catch(() => undefined);
    vi.setSystemTime(T0 + 2 * DAY);
    await fulfillPayment(String(txns()[0].paystack_reference));
    const sub = subs()[0];
    expect(String(sub.next_renewal_date)).toBe(new Date(T0 + 2 * DAY + 30 * DAY).toISOString().slice(0, 10));
  });

  it("a row nobody paid for grants nothing and has no running period (still pending_payment)", async () => {
    await click().catch(() => undefined);
    expect(subs()[0].status).toBe("pending_payment");
  });
});

describe("(a) the purchase check keeps its real job: no second subscription beside one that is running or about to renew", () => {
  it("an ENDED row that is still waiting on its automatic renewal blocks a new subscription (no double charge on a due renewal)", async () => {
    subs().push(activeRow({ expires_at: new Date(T0 - 2 * 3600_000).toISOString(), auto_renew_status: "active", next_renewal_date: new Date(T0).toISOString().slice(0, 10) }));
    const outcome = await click();
    expect(decodeURIComponent(outcome)).toMatch(/already has an active subscription/i);
    expect(world.paystackCalls, "a second subscription was started beside a renewal that is about to be charged").toBe(0);
    expect(subs()).toHaveLength(1);
  });

  it("an ended row whose auto-renewal was cancelled does NOT block", async () => {
    subs().push(activeRow({ auto_renew_status: "canceled" }));
    expect(await click()).toBe("REDIRECT:https://paystack.example/checkout");
  });
});

describe("(a) a payment that cannot be activated is never left as 'success' beside a pending subscription", () => {
  it("another subscription holds the active slot (running): the payment is needs_refund, an alert goes out, the row stays pending", async () => {
    subs().push(activeRow({ expires_at: new Date(T0 + 20 * DAY).toISOString() }));
    subs().push({ id: "new-sub", organization_id: "org-1", plan_id: "plan-1", status: "pending_payment", started_at: new Date(T0).toISOString(), expires_at: new Date(T0 + 30 * DAY).toISOString() });
    txns().push({ id: "txn-9", user_id: "user-1", organization_id: "org-1", status: "pending", amount: 200000, currency: "NGN", product_type: "talent_directory_subscription", product_id: "new-sub", paystack_reference: "talent_directory_subscription_y" });
    const result = await fulfillPayment("talent_directory_subscription_y");
    expect(result.status).toBe("needs_refund");
    expect(txns()[0].status).toBe("needs_refund");
    expect(subs().find((x) => x.id === "new-sub")!.status).toBe("pending_payment");
    expect(world.refundAlerts).toEqual([{ reference: "talent_directory_subscription_y", reason: "already_active" }]);
  });

  it("the activation answers not_pending (a concurrent delivery already activated it): not a refund case, the payment is recorded as success, no alert", async () => {
    await click().catch(() => undefined);
    world.activateOverride = { data: [{ activated: false, reason: "not_pending", expires_at: null, plan_name: null }], error: null };
    const result = await fulfillPayment(String(txns()[0].paystack_reference));
    expect(result.status).toBe("success");
    expect(txns()[0].status).toBe("success");
    expect(world.refundAlerts).toEqual([]);
  });

  it("the activation answers nothing at all: the payment is needs_refund and the alert says why, never silently success", async () => {
    await click().catch(() => undefined);
    world.activateOverride = { data: [], error: null };
    const result = await fulfillPayment(String(txns()[0].paystack_reference));
    expect(result.status).toBe("needs_refund");
    expect(txns()[0].status).toBe("needs_refund");
    expect(world.refundAlerts).toEqual([{ reference: String(txns()[0].paystack_reference), reason: "no result" }]);
  });

  it("the activation call itself fails (database error): fulfilment throws, so the webhook is retried; the payment stays pending, no alert", async () => {
    await click().catch(() => undefined);
    world.activateOverride = { data: null, error: { message: "connection reset" } };
    await expect(fulfillPayment(String(txns()[0].paystack_reference))).rejects.toThrow(/activate_talent_directory_subscription failed.*connection reset/);
    expect(txns()[0].status).toBe("pending");
    expect(subs()[0].status).toBe("pending_payment");
    expect(world.refundAlerts).toEqual([]);
  });

  it("a redelivery after a successful activation changes nothing (not_pending is a no-op, the payment stays success)", async () => {
    await click().catch(() => undefined);
    const ref = String(txns()[0].paystack_reference);
    await fulfillPayment(ref);
    const first = { ...subs()[0] };
    const again = await fulfillPayment(ref);
    expect(again.status).toBe("already_processed");
    expect(subs()[0].expires_at).toBe(first.expires_at);
    expect(world.refundAlerts).toEqual([]);
  });
});

describe("the daily lapse", () => {
  it("lapses an ended row that is not renewing (never paid by a reusable card, or cancelled) and frees the slot", async () => {
    subs().push(activeRow({ id: "a", organization_id: "org-a" }), activeRow({ id: "b", organization_id: "org-b", auto_renew_status: "canceled" }));
    const out = await lapseEndedTalentDirectorySubscriptions();
    expect(out).toEqual({ lapsed: 2, error: null });
    expect(subs().map((x) => x.status)).toEqual(["lapsed", "lapsed"]);
  });

  it("is idempotent: a second run right after the first lapses nothing and changes no row", async () => {
    subs().push(
      activeRow({ id: "a", organization_id: "org-a" }),
      activeRow({ id: "renewing", organization_id: "org-b", auto_renew_status: "active", expires_at: new Date(T0 - 2 * 3600_000).toISOString() }),
    );
    expect((await lapseEndedTalentDirectorySubscriptions()).lapsed).toBe(1);
    const afterFirst = JSON.stringify(subs());
    expect(await lapseEndedTalentDirectorySubscriptions()).toEqual({ lapsed: 0, error: null });
    expect(JSON.stringify(subs())).toBe(afterFirst);
    expect(subs().map((x) => x.status)).toEqual(["lapsed", "active"]);
  });

  it("does NOT lapse a row that is waiting on its automatic renewal, nor one that is still running", async () => {
    subs().push(
      activeRow({ id: "renewing", organization_id: "org-a", auto_renew_status: "active", expires_at: new Date(T0 - 2 * 3600_000).toISOString() }),
      activeRow({ id: "running", organization_id: "org-b", expires_at: new Date(T0 + 3 * DAY).toISOString() }),
      { id: "pending", organization_id: "org-c", plan_id: "plan-1", status: "pending_payment", expires_at: new Date(T0 - DAY).toISOString() },
    );
    const out = await lapseEndedTalentDirectorySubscriptions();
    expect(out.lapsed).toBe(0);
    expect(subs().map((x) => x.status)).toEqual(["active", "active", "pending_payment"]);
  });
});
