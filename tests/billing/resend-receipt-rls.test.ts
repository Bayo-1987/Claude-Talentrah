/**
 * "Email me this receipt" against the REAL database (CI only: it needs the local Supabase stack, like the other tests/rls suites).
 *
 * The unit file (resend-receipt.test.ts) fakes the session client and models row-level security itself, so it cannot tell whether the
 * action's own `.eq("user_id")` filter or the database is what keeps one user from emailing themselves another user's receipt. This one
 * can: another user's REAL purchase id, asked for by a REAL authenticated session, must come back as "We couldn't find that purchase."
 * and send nothing. The positive controls (the owner, and the first user's own purchase, both get an email) are what make that
 * negative mean something: the same code path, the same kind of row, a different caller.
 *
 * Only the pieces that are not the point are replaced: the Resend client (a spy), the redirect (so the outcome can be read), and the rate
 * counter (the pool reuses users across runs, so a real counter would accumulate toward the 5-a-day limit). `auth.getUser()` on the
 * minted-token client is pinned to the minted subject; every table read still goes through the real PostgREST + RLS session.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { admin, createTestUser, deleteTestUsers, sessionFor, type DB } from "../support/auth";

vi.mock("server-only", () => ({}));

const world = vi.hoisted(() => ({
  client: null as unknown,
  send: vi.fn<(payload: Record<string, unknown>) => Promise<{ data: { id: string } | null; error: unknown }>>(async () => ({ data: { id: "m1" }, error: null })),
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
vi.mock("@/lib/resend/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/resend/client")>()), getResendClient: () => ({ emails: { send: world.send } }) }));
vi.mock("@/lib/api/rate-limit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/rate-limit")>("@/lib/api/rate-limit");
  return { ...actual, consumeRateLimit: async () => ({ allowed: true, used: 1, resetsAt: null }) };
});
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => world.client }));

import { resendReceiptAction } from "@/lib/billing/receipt-actions";
import { RECEIPT_MESSAGE } from "@/lib/billing/receipt-messages";

let a: { id: string; email: string };
let b: { id: string; email: string };
let packId: string;
const txIds: string[] = [];
let bTx: string;
let aTx: string;

/** The real RLS session for `user`, with only auth.getUser() pinned to the minted subject. */
async function sessionAs(user: { id: string; email: string }): Promise<DB> {
  const real = await sessionFor(user.email, user.id);
  return new Proxy(real, {
    get(target, prop, receiver) {
      if (prop === "auth") return { getUser: async () => ({ data: { user: { id: user.id, email: user.email } }, error: null }) };
      return Reflect.get(target, prop, receiver);
    },
  }) as DB;
}

async function call(id: string): Promise<string> {
  try {
    await resendReceiptAction(id);
  } catch (e) {
    if (e instanceof Redirect) return e.url;
    throw e;
  }
  throw new Error("the action must always end in a redirect");
}

async function purchase(userId: string): Promise<string> {
  const { data, error } = await admin
    .from("payment_transactions")
    .insert({
      user_id: userId,
      rail: "paystack",
      amount: 2500,
      currency: "NGN",
      product_type: "credit_pack",
      product_id: packId,
      paystack_reference: `credit_pack_${randomUUID()}`,
      status: "success",
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`fixture purchase: ${error?.message}`);
  txIds.push(data.id);
  return data.id;
}

beforeAll(async () => {
  a = await createTestUser("receiptrlsa");
  b = await createTestUser("receiptrlsb");
  const { data: pack, error } = await admin.from("credit_packs").select("id").limit(1).single();
  if (error || !pack) throw new Error("No credit packs seeded: run `npm run seed`.");
  packId = pack.id;
  aTx = await purchase(a.id);
  bTx = await purchase(b.id);
}, 90_000);

afterAll(async () => {
  if (txIds.length) {
    const { error } = await admin.from("payment_transactions").delete().in("id", txIds);
    if (error) console.error("[resend-receipt-rls cleanup]", error.message);
  }
  await deleteTestUsers([a?.id, b?.id].filter(Boolean) as string[]);
}, 90_000);

beforeEach(() => {
  world.send.mockClear();
});

describe("another user's real purchase", () => {
  it("is 'We couldn't find that purchase.' for a different signed-in user, and nothing is sent", async () => {
    world.client = await sessionAs(a);
    const url = await call(bTx);
    expect(url).toBe("/billing?receipt=not_found");
    expect(RECEIPT_MESSAGE.not_found).toBe("We couldn't find that purchase.");
    expect(world.send).not.toHaveBeenCalled();
  });

  it("is hidden by the database itself, not only by the action's own user_id filter", async () => {
    const session = (await sessionFor(a.email, a.id)) as DB;
    const { data, error } = await session.from("payment_transactions").select("id").eq("id", bTx).eq("status", "success").maybeSingle();
    expect(error).toBeNull();
    expect(data, "row-level security must hide another user's transaction even with no user_id filter").toBeNull();
  });
});

describe("positive controls: the same code path does send when the caller owns the row", () => {
  it("the owner of that purchase gets one email, to their own profile address", async () => {
    world.client = await sessionAs(b);
    expect(await call(bTx)).toBe("/billing?receipt=sent");
    expect(world.send).toHaveBeenCalledTimes(1);
    expect(world.send.mock.calls[0][0].to).toBe(b.email);
  });

  it("the first user's own purchase is sent to the first user, not the second", async () => {
    world.client = await sessionAs(a);
    expect(await call(aTx)).toBe("/billing?receipt=sent");
    expect(world.send).toHaveBeenCalledTimes(1);
    expect(world.send.mock.calls[0][0].to).toBe(a.email);
  });
});
