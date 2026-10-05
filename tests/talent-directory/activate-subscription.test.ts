/**
 * activate_talent_directory_subscription (0228) against the REAL database (CI only: it needs the local Supabase stack, like the other
 * tests/rls and tests/talent-directory suites). The same cases were run on a production-like schema locally before this file was written;
 * the in-memory file next to it (subscription-lifecycle.test.ts) covers the TypeScript that calls the function.
 *
 *   - activation sets expires_at = now() + the plan's duration at CONFIRMATION, whatever expires_at the pending row was created with;
 *   - an ended, non-renewing 'active' row is lapsed and no longer blocks; an ended row still waiting on its automatic renewal is NOT
 *     lapsed and holds the slot (reason already_active, nothing raised, the new row stays pending);
 *   - a second call is a no-op (not_pending); an unknown id is not_found;
 *   - EXECUTE is service_role only: a signed-in user cannot activate anything.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { admin, createTestUser, deleteTestUsers, sessionFor } from "../support/auth";
import { deleteTestOrgs } from "../support/cleanup";

const DAY = 86_400_000;
let ownerId: string;
let ownerEmail: string;
let planId: string;
let planDays: number;
const orgIds: string[] = [];

async function newOrg(): Promise<string> {
  const { data, error } = await admin
    .from("organizations")
    .insert({ name: `Activate Subscription Org ${randomUUID().slice(0, 8)}`, created_by: ownerId, verified: true })
    .select("id")
    .single();
  if (error || !data) throw new Error(`fixture org: ${error?.message}`);
  orgIds.push(data.id);
  return data.id;
}

async function newSub(
  orgId: string,
  status: "pending_payment" | "active",
  over: { expires?: number; started?: number; auto?: "active" | "canceled" | null } = {},
): Promise<string> {
  const { data, error } = await admin
    .from("talent_directory_subscriptions")
    .insert({
      organization_id: orgId,
      plan_id: planId,
      status,
      started_at: new Date(Date.now() + (over.started ?? 0)).toISOString(),
      expires_at: new Date(Date.now() + (over.expires ?? planDays * DAY)).toISOString(),
      auto_renew_status: over.auto ?? null,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`fixture subscription: ${error?.message}`);
  return data.id;
}

const activate = async (id: string, auto = false, code?: string) => {
  const { data, error } = await admin.rpc("activate_talent_directory_subscription", {
    p_subscription_id: id,
    p_auto_renew: auto,
    p_authorization_code: code,
    p_payment_transaction_id: undefined as unknown as string,
  });
  expect(error).toBeNull();
  return data![0];
};
const row = async (id: string) => (await admin.from("talent_directory_subscriptions").select("*").eq("id", id).single()).data!;

beforeAll(async () => {
  const owner = await createTestUser("activate-subscription-owner");
  ownerId = owner.id;
  ownerEmail = owner.email;
  const { data: plan } = await admin.from("talent_directory_plans").select("id, duration_days").limit(1).single();
  planId = plan!.id;
  planDays = plan!.duration_days;
}, 60_000);

afterAll(async () => {
  await deleteTestOrgs(orgIds);
  await deleteTestUsers([ownerId]);
}, 60_000);

describe("activation", () => {
  it("sets expires_at to now plus the plan's duration at confirmation, overwriting a click-time value from three hours earlier", async () => {
    const org = await newOrg();
    const pending = await newSub(org, "pending_payment", { started: -3 * 3600_000, expires: planDays * DAY - 3 * 3600_000 });
    const out = await activate(pending);
    expect(out.activated).toBe(true);
    const sub = await row(pending);
    expect(sub.status).toBe("active");
    expect(Math.abs(new Date(sub.expires_at).getTime() - (Date.now() + planDays * DAY))).toBeLessThan(60_000);
  });

  it("a card payment records the renewal fields: auto_renew_status active, next_renewal_date the UTC date of the real expiry, the token", async () => {
    const org = await newOrg();
    const pending = await newSub(org, "pending_payment");
    await activate(pending, true, "AUTH_ci");
    const sub = await row(pending);
    expect(sub.auto_renew_status).toBe("active");
    expect(sub.authorization_code).toBe("AUTH_ci");
    expect(sub.next_renewal_date).toBe(new Date(sub.expires_at).toISOString().slice(0, 10));
  });
});

describe("the one active slot", () => {
  it("an ended, non-renewing active row is lapsed and the new row activates", async () => {
    const org = await newOrg();
    const old = await newSub(org, "active", { started: -40 * DAY, expires: -10 * DAY });
    const pending = await newSub(org, "pending_payment");
    expect((await activate(pending)).activated).toBe(true);
    expect((await row(old)).status).toBe("lapsed");
    const { count } = await admin.from("talent_directory_subscriptions").select("id", { count: "exact", head: true }).eq("organization_id", org).eq("status", "active");
    expect(count).toBe(1);
  });

  it("an ended row still waiting on its automatic renewal is NOT lapsed, and the new row is not activated (already_active), nothing raised", async () => {
    const org = await newOrg();
    const renewing = await newSub(org, "active", { expires: -2 * 3600_000, auto: "active" });
    const pending = await newSub(org, "pending_payment");
    const out = await activate(pending);
    expect(out.activated).toBe(false);
    expect(out.reason).toBe("already_active");
    expect((await row(renewing)).status).toBe("active");
    expect((await row(pending)).status).toBe("pending_payment");
  });

  it("a running row holds the slot", async () => {
    const org = await newOrg();
    await newSub(org, "active");
    const pending = await newSub(org, "pending_payment");
    expect((await activate(pending)).reason).toBe("already_active");
  });

  it("another organisation's ended row is untouched", async () => {
    const a = await newOrg();
    const b = await newOrg();
    const other = await newSub(b, "active", { expires: -5 * DAY });
    await activate(await newSub(a, "pending_payment"));
    expect((await row(other)).status).toBe("active");
  });
});

describe("idempotence and permissions", () => {
  it("a second call is a no-op (not_pending) and leaves expires_at alone; an unknown id is not_found", async () => {
    const org = await newOrg();
    const pending = await newSub(org, "pending_payment");
    await activate(pending);
    const first = await row(pending);
    const again = await activate(pending);
    expect(again.reason).toBe("not_pending");
    expect((await row(pending)).expires_at).toBe(first.expires_at);
    expect((await activate("00000000-0000-0000-0000-000000000000")).reason).toBe("not_found");
  });

  it("its search_path is pinned to public, pg_temp (temporary objects are searched last)", async () => {
    const { data, error } = await admin.rpc("function_search_path_audit");
    expect(error).toBeNull();
    const fn = (data ?? []).find((f) => f.function_name === "activate_talent_directory_subscription");
    expect(fn, "the function is not in the audit").toBeDefined();
    expect(fn!.security_definer).toBe(true);
    expect(fn!.search_path_config).toBe("search_path=public, pg_temp");
  });

  it("a signed-in user cannot call it", async () => {
    const org = await newOrg();
    const pending = await newSub(org, "pending_payment");
    const session = await sessionFor(ownerEmail, ownerId);
    const { error } = await session.rpc("activate_talent_directory_subscription", {
      p_subscription_id: pending,
      p_auto_renew: false,
      p_authorization_code: undefined,
      p_payment_transaction_id: undefined as unknown as string,
    });
    expect(error, "an authenticated user was allowed to activate a subscription").not.toBeNull();
    expect((await row(pending)).status).toBe("pending_payment");
  });
});
