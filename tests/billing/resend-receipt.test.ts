/**
 * "Email me this receipt": resendReceiptAction.
 *
 * Contract (each pinned below):
 *   1  sends to the signed-in user's PROFILE email and nowhere else
 *   2  only the user's own rows: another user's transaction is not found (the session read is RLS-scoped)
 *   3  only successful payments: pending and failed rows are refused
 *   4  only credit_pack and pass: every other product_type is refused
 *   5  5 a day per user, failing CLOSED: a denied or unreadable counter sends nothing
 *   6  the email is exactly the one the purchase sent (buildPurchaseReceiptEmail), with the product named from its row
 *   7  Resend missing or failing is an explicit outcome, never a silent success
 *   8  no database write of any kind (the counter row lives behind the consume_rate_limit RPC)
 *
 * Session client faked with a tiny filter engine that applies .eq() filters and models RLS (a row of another user is never returned).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const world = vi.hoisted(() => ({
  userId: "u1" as string | null,
  rows: {} as Record<string, Array<Record<string, unknown>>>,
  writes: [] as string[],
  send: vi.fn<(payload: Record<string, unknown>) => Promise<{ data: { id: string } | null; error: unknown }>>(async () => ({ data: { id: "m1" }, error: null })),
  resendConfigured: true,
  consume: vi.fn<(userId: string, bucket: string) => Promise<{ allowed: boolean; used: number; resetsAt: string | null }>>(async () => ({ allowed: true, used: 1, resetsAt: null })),
  serviceRoleUsed: false,
}));

class Redirect extends Error {
  constructor(public url: string) {
    super(`REDIRECT:${url}`);
  }
}
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Redirect(url);
  },
}));
vi.mock("@/lib/resend/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/resend/client")>()),
  getResendClient: () => (world.resendConfigured ? { emails: { send: world.send } } : null),
}));
vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => {
    world.serviceRoleUsed = true;
    throw new Error("the receipt action must not use the service role");
  },
}));
vi.mock("@/lib/api/rate-limit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/rate-limit")>("@/lib/api/rate-limit");
  return { ...actual, consumeRateLimit: world.consume };
});
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: world.userId ? { id: world.userId, email: "auth@example.test" } : null } }) },
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      const chain: Record<string, unknown> = {};
      const rowsNow = () =>
        (world.rows[table] ?? []).filter((r) => {
          // RLS: a user's own rows only, on the owner-scoped tables.
          if ((table === "payment_transactions" || table === "profiles") && (r.user_id ?? r.id) !== world.userId) return false;
          return filters.every(([c, v]) => r[c] === v);
        });
      for (const m of ["select", "order", "limit", "in", "is"]) chain[m] = () => chain;
      chain.eq = (c: string, v: unknown) => (filters.push([c, v]), chain);
      for (const m of ["insert", "update", "delete", "upsert"]) chain[m] = () => (world.writes.push(`${table}.${m}`), chain);
      chain.maybeSingle = async () => ({ data: rowsNow()[0] ?? null, error: null });
      chain.single = async () => ({ data: rowsNow()[0] ?? null, error: rowsNow()[0] ? null : { message: "no rows" } });
      return chain;
    },
  }),
}));

import { resendReceiptAction } from "@/lib/billing/receipt-actions";
import { RATE_LIMITS } from "@/lib/api/rate-limit";
import { buildPurchaseReceiptEmail } from "@/lib/billing/receipt-email";

const REF = "credit_pack_678586c1-9f2e-4c3a-8d11-0a1b2c3d4e5f";
const tx = (over: Record<string, unknown> = {}) => ({
  id: "t1", user_id: "u1", status: "success", product_type: "credit_pack", product_id: "pk2", amount: 5000, currency: "NGN", paystack_reference: REF, ...over,
});

async function call(id = "t1"): Promise<string> {
  try {
    await resendReceiptAction(id);
  } catch (e) {
    if (e instanceof Redirect) return e.url;
    throw e;
  }
  throw new Error("the action must always end in a redirect");
}
const code = (url: string) => new URL(url, "http://x").searchParams.get("receipt");

beforeEach(() => {
  world.userId = "u1";
  world.writes = [];
  world.send.mockClear();
  world.send.mockImplementation(async () => ({ data: { id: "m1" }, error: null }));
  world.consume.mockClear();
  world.consume.mockImplementation(async () => ({ allowed: true, used: 1, resetsAt: null }));
  world.resendConfigured = true;
  world.serviceRoleUsed = false;
  world.rows = {
    payment_transactions: [tx()],
    profiles: [{ id: "u1", email: "me@example.test", first_name: "Ada" }],
    credit_packs: [{ id: "pk2", name: "Plus", credits: 50, price_ngn: 5000 }],
    passes: [{ id: "ps30", name: "30-Day Pass", duration_days: 30, price_ngn: 13500 }],
  };
});

describe("1: recipient", () => {
  it("sends once, to the profile email, and says it was sent", async () => {
    const url = await call();
    expect(url).toBe("/billing?receipt=sent");
    expect(world.send).toHaveBeenCalledTimes(1);
    expect(world.send.mock.calls[0][0]).toMatchObject({ to: "me@example.test", from: "Talentrah <billing@talentrah.com>" });
  });

  it("uses the profile email, not the auth email, and nothing the caller can pass", async () => {
    await call();
    expect(world.send.mock.calls[0][0].to).not.toBe("auth@example.test");
    expect(resendReceiptAction.length).toBe(1);
  });

  it("signed out goes to login and sends nothing", async () => {
    world.userId = null;
    expect(await call()).toBe("/login");
    expect(world.send).not.toHaveBeenCalled();
  });
});

describe("2: own rows only", () => {
  it("another user's transaction is not found and nothing is sent", async () => {
    world.rows.payment_transactions = [tx({ user_id: "someone-else" })];
    expect(code(await call())).toBe("not_found");
    expect(world.send).not.toHaveBeenCalled();
    expect(world.consume).not.toHaveBeenCalled();
  });
  it("an unknown id is not found", async () => {
    expect(code(await call("nope"))).toBe("not_found");
    expect(world.send).not.toHaveBeenCalled();
  });
});

describe("3: successful payments only", () => {
  for (const status of ["pending", "failed", "needs_refund", "awaiting_confirmation"]) {
    it(`${status} is refused`, async () => {
      world.rows.payment_transactions = [tx({ status })];
      expect(code(await call())).toBe("not_found");
      expect(world.send).not.toHaveBeenCalled();
    });
  }
  it("a row with no Paystack reference is refused", async () => {
    world.rows.payment_transactions = [tx({ paystack_reference: null })];
    expect(code(await call())).toBe("not_found");
    expect(world.send).not.toHaveBeenCalled();
  });
});

describe("4: credit_pack and pass only", () => {
  for (const product_type of ["ad_wallet_topup", "mentor_session", "talent_directory_subscription", "something_new"]) {
    it(`${product_type} is refused`, async () => {
      world.rows.payment_transactions = [tx({ product_type })];
      expect(code(await call())).toBe("not_found");
      expect(world.send).not.toHaveBeenCalled();
    });
  }
  it("a pass is allowed and named from the passes row", async () => {
    world.rows.payment_transactions = [tx({ product_type: "pass", product_id: "ps30", amount: 13500 })];
    expect(code(await call())).toBe("sent");
    expect(String(world.send.mock.calls[0][0].subject)).toContain("30-Day Pass");
  });
});

describe("5: five a day, failing closed", () => {
  it("the bucket is 5 per user per 24 hours", () => {
    expect(RATE_LIMITS.receiptResend).toEqual({ limit: 5, windowSeconds: 60 * 60 * 24 });
  });
  it("asks the counter for this user and bucket before sending", async () => {
    await call();
    expect(world.consume).toHaveBeenCalledWith("u1", "receiptResend");
  });
  it("a denied counter says limited and sends nothing", async () => {
    world.consume.mockImplementation(async () => ({ allowed: false, used: 5, resetsAt: null }));
    expect(code(await call())).toBe("limited");
    expect(world.send).not.toHaveBeenCalled();
  });
  it("the real counter fails closed when the database call errors", async () => {
    vi.resetModules();
    vi.doMock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({ rpc: async () => ({ data: null, error: { message: "boom" } }) }) }));
    const real = await vi.importActual<typeof import("@/lib/api/rate-limit")>("@/lib/api/rate-limit");
    const out = await real.consumeRateLimit("u1", "receiptResend");
    expect(out.allowed).toBe(false);
    vi.doUnmock("@/lib/supabase/service-role");
  });
});

describe("6: the email is the purchase email", () => {
  it("subject, text and html equal buildPurchaseReceiptEmail for the same purchase", async () => {
    await call();
    const expected = buildPurchaseReceiptEmail({ greeting: "Ada", productName: "Plus", productType: "credit_pack", amountNgn: 5000, reference: REF });
    expect(world.send.mock.calls[0][0]).toMatchObject({ subject: expected.subject, text: expected.text, html: expected.html });
  });
  it("a retired pack, not in the lookup, falls back to the generic product label", async () => {
    world.rows.credit_packs = [];
    await call();
    expect(String(world.send.mock.calls[0][0].subject)).toContain("Credit pack");
  });
});

describe("7: Resend missing or failing is explicit", () => {
  it("not configured: says unavailable, sends nothing, spends none of the day's five", async () => {
    world.resendConfigured = false;
    expect(code(await call())).toBe("unavailable");
    expect(world.send).not.toHaveBeenCalled();
    expect(world.consume).not.toHaveBeenCalled();
  });
  it("Resend returns an error: says failed", async () => {
    world.send.mockImplementation(async () => ({ data: null, error: { message: "nope" } }));
    expect(code(await call())).toBe("failed");
  });
  it("Resend throws: says failed (never an unhandled error)", async () => {
    world.send.mockImplementation(async () => {
      throw new Error("network");
    });
    expect(code(await call())).toBe("failed");
  });
});

describe("8: no writes", () => {
  it("makes no insert, update, delete or upsert, and never uses the service role", async () => {
    await call();
    expect(world.writes).toEqual([]);
    expect(world.serviceRoleUsed).toBe(false);
  });
});
