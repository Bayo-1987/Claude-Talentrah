/**
 * getActivePass — the display-only counterpart to hasActivePass, feeding the
 * masthead pill and the billing page's "lead with the Pass" heading. It must
 * agree with hasActivePass's own notion of "active" (expires_at > now, not
 * status alone — see that function's header) since a display surface
 * disagreeing with the entitlement check is exactly how a user ends up
 * looking at two contradictory truths on the same screen.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { admin, createTestUser, deleteTestUsers } from "../support/auth";
import { getActivePass } from "@/lib/passes/entitlement";

let userId: string;
let passId: string;
let passName: string;

beforeAll(async () => {
  const user = await createTestUser("activepasssummary");
  userId = user.id;
  const { data: pass, error } = await admin.from("passes").select("id, name").limit(1).single();
  if (error || !pass) throw new Error("No passes seeded — run `npm run seed`.");
  passId = pass.id;
  passName = pass.name;
}, 60_000);

afterAll(async () => {
  if (userId) await deleteTestUsers([userId]);
}, 60_000);

const createdPassRows: string[] = [];

async function insertPass(
  expiresInMs: number,
  overrides: { status?: "active" | "canceled"; passIdOverride?: string } = {},
): Promise<string> {
  const { data, error } = await admin
    .from("user_passes")
    .insert({
      user_id: userId,
      pass_id: overrides.passIdOverride ?? passId,
      expires_at: new Date(Date.now() + expiresInMs).toISOString(),
      payment_method: "card",
      status: overrides.status ?? "active",
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`fixture pass: ${error?.message}`);
  createdPassRows.push(data.id);
  return data.id;
}

afterEach(async () => {
  if (createdPassRows.length) {
    await admin.from("user_passes").delete().in("id", createdPassRows);
    createdPassRows.length = 0;
  }
});

describe("getActivePass", () => {
  it("null with no pass at all", async () => {
    expect(await getActivePass(userId)).toBeNull();
  });

  it("null with only an expired pass, even though status is still 'active'", async () => {
    // Same bug hasActivePass exists to close, checked here too: a display
    // helper that disagreed with the entitlement check would show "Pass
    // active" over a masthead where the very next tailoring run gets
    // charged credits — worse than either being wrong alone.
    await insertPass(-60 * 60 * 1000);
    expect(await getActivePass(userId)).toBeNull();
  });

  it("returns the pass name and a positive day count for a currently-active pass", async () => {
    await insertPass(3 * 24 * 60 * 60 * 1000); // 3 days from now
    const summary = await getActivePass(userId);
    expect(summary).not.toBeNull();
    expect(summary!.name).toBe(passName);
    // Rounds UP (Math.ceil) rather than down: a pass with 2 days and 1
    // hour left reading as "2 days left" is a truncation the following
    // afternoon reveals as a lie, not a rounding choice.
    expect(summary!.daysRemaining).toBeGreaterThanOrEqual(3);
    expect(summary!.daysRemaining).toBeLessThanOrEqual(4);
  });

  it("with more than one active pass, returns the one with the LATEST expiry — the outer edge of coverage", async () => {
    await insertPass(1 * 24 * 60 * 60 * 1000); // expires in 1 day
    await insertPass(30 * 24 * 60 * 60 * 1000); // expires in 30 days
    const summary = await getActivePass(userId);
    expect(summary!.daysRemaining).toBeGreaterThan(20);
  });

  it("never returns a canceled pass, even one that has not yet reached its expiry", async () => {
    await insertPass(24 * 60 * 60 * 1000, { status: "canceled" });
    expect(await getActivePass(userId)).toBeNull();
  });
});
