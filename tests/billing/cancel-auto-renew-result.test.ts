/**
 * cancelPassAutoRenewal (src/lib/billing/renewals.ts) returns a typed result, so a cancel that did not take is never shown as one that did (PAYOUT-RENEWAL-UNCHECKED-WRITES-1, PR-B).
 *
 * Real database; the service-role client is wrapped so the update can fail (tests/support/faulty-service-client.ts).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { createTestUser, deleteTestUsers } from "../support/auth";
import { createFaultyClient, type FaultyClient } from "../support/faulty-service-client";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
  if (!process.env[key]) throw new Error(`Cancel-result test cannot run: ${key} is not set.`);
}
const admin: SupabaseClient<Database> = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const holder = vi.hoisted(() => ({ faulty: null as null | { client: unknown } }));
vi.mock("@/lib/supabase/service-role", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/service-role")>();
  return { ...actual, createServiceRoleClient: () => (holder.faulty ? (holder.faulty.client as ReturnType<typeof actual.createServiceRoleClient>) : actual.createServiceRoleClient()) };
});

let userId: string;
let passId: string;
let userPassId = "NOT_SET";
let faulty: FaultyClient<ReturnType<typeof import("@/lib/supabase/service-role").createServiceRoleClient>>;

beforeAll(async () => {
  userId = (await createTestUser("cancelres")).id;
  const { data, error } = await admin.from("passes").select("id").limit(1).single();
  if (error || !data) throw new Error("No passes seeded — run `npm run seed`.");
  passId = data.id;
}, 120_000);

beforeEach(async () => {
  const actual = await vi.importActual<typeof import("@/lib/supabase/service-role")>("@/lib/supabase/service-role");
  faulty = createFaultyClient(actual.createServiceRoleClient());
  holder.faulty = faulty;
});

afterEach(async () => {
  holder.faulty = null;
  vi.restoreAllMocks();
  if (userPassId !== "NOT_SET") await admin.from("user_passes").delete().eq("id", userPassId);
  userPassId = "NOT_SET";
});

afterAll(async () => {
  if (userId) {
    await admin.from("user_passes").delete().eq("user_id", userId);
    await deleteTestUsers([userId]);
  }
}, 60_000);

async function makePass(status: "active" | "canceled" | "lapsed") {
  const { data, error } = await admin
    .from("user_passes")
    .insert({
      user_id: userId,
      pass_id: passId,
      started_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 10 * 86_400_000).toISOString(),
      payment_method: "card",
      auto_renew: status === "active",
      auto_renew_status: status,
      next_renewal_date: status === "active" ? new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10) : null,
      authorization_code: status === "active" ? "AUTH_cancel_test" : null,
    })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("no pass");
  userPassId = data.id;
  return data.id;
}
const row = async () => (await admin.from("user_passes").select("auto_renew, auto_renew_status, next_renewal_date, authorization_code").eq("id", userPassId).single()).data!;
const cancel = async () => (await import("@/lib/billing/renewals")).cancelPassAutoRenewal(userPassId);

describe("cancelPassAutoRenewal returns a typed result", () => {
  it("an active Pass: { ok: true } and the four columns change together", async () => {
    await makePass("active");
    expect(await cancel()).toEqual({ ok: true });
    expect(await row()).toMatchObject({ auto_renew: false, auto_renew_status: "canceled", next_renewal_date: null, authorization_code: null });
  });

  it("the update returns a database error: { ok: false }, logged with the pass id, and the Pass is untouched", async () => {
    await makePass("active");
    faulty.fail({ table: "user_passes", op: "update", mode: "error", times: Infinity });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await cancel();
    const text = log.mock.calls.map((c) => c.join(" ")).join("\n");

    expect(result, "MONEY BUG: a cancel that failed was reported as done").toEqual({ ok: false });
    expect(text).toContain(userPassId);
    expect(await row()).toMatchObject({ auto_renew: true, auto_renew_status: "active", authorization_code: "AUTH_cancel_test" });
  });

  it("0 rows matched and the Pass is already canceled: { ok: true } (idempotent)", async () => {
    await makePass("canceled");
    expect(await cancel()).toEqual({ ok: true });
  });

  it("0 rows matched and the Pass is already lapsed: { ok: true }", async () => {
    await makePass("lapsed");
    expect(await cancel()).toEqual({ ok: true });
  });

  it("0 rows matched while the Pass is still active: { ok: false }", async () => {
    await makePass("active");
    faulty.fail({ table: "user_passes", op: "update", mode: "zero", times: Infinity });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await cancel();
    log.mockRestore();

    expect(result).toEqual({ ok: false });
    expect((await row()).auto_renew_status).toBe("active");
  });

  it("the update only touches a Pass that is still active (a cancel never rewrites a lapsed Pass's columns)", async () => {
    await makePass("lapsed");
    await cancel();
    expect(await row()).toMatchObject({ auto_renew_status: "lapsed" });
  });
});
