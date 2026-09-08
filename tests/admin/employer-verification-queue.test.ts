/**
 * The CAC verification queue (0116/0120) and both its decision paths, end to
 * end against the real database.
 *
 * `decideCacVerificationAction` itself is a Next.js Server Action
 * (`requirePermission` reads `next/headers`/`next/navigation`, which need a
 * real request to resolve), so — matching this repo's own convention for the
 * other three moderation decisions (see tests/rls/job-posting-restore.test.ts
 * for the precedent) — this drives the exact statements the action runs
 * rather than the "use server" export itself: the conditional UPDATE for
 * approve, and a plain `recordAdminAction` call for reject, since that
 * function is a normal server-only helper with no Next.js request
 * dependency.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { admin, createTestUser, deleteTestUsers, type TestUser } from "../support/auth";
import { deleteTestOrgs } from "../support/cleanup";
import { pendingCacVerifications } from "@/lib/admin/moderation/queues";
import { recordAdminAction } from "@/lib/admin/audit";

let owner: TestUser;
let operator: TestUser;
/** Every fixture org this suite creates, across every test — cleaned up once in afterAll. */
const orgIds: string[] = [];

async function makeOrg(cac: { number: string | null; businessName: string | null }) {
  const { data, error } = await admin
    .from("organizations")
    .insert({
      name: `CACQUEUE-TEST ${randomUUID().slice(0, 8)}`,
      created_by: owner.id,
      cac_number: cac.number,
      cac_business_name: cac.businessName,
    })
    .select("id")
    .single();
  if (error) throw new Error(`could not create fixture org: ${error.message}`);
  orgIds.push(data.id);
  return data.id;
}

/** What decideCacVerificationAction's approve branch runs, verbatim. */
async function approve(orgId: string, adminId: string) {
  return admin
    .from("organizations")
    .update({
      verified: true,
      cac_confirmed_at: new Date().toISOString(),
      cac_confirmed_by: adminId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", orgId)
    .is("cac_confirmed_at", null)
    .select("id, name, cac_number, cac_business_name");
}

beforeAll(async () => {
  owner = await createTestUser("cacqueue-owner");
  operator = await createTestUser("cacqueue-operator");

  // `admin_audit_log.admin_user_id` is a real FK to `admin_users`
  // (0060) — `recordAdminAction` is not itself under test here, but it will
  // not insert against an id that table has never heard of, so `operator`
  // needs a row there exactly like every other admin fixture in this repo
  // (see tests/rls/admin-content-enforcement.test.ts). No role_id: nothing in
  // this suite calls `requirePermission`, so there is no role to check.
  const { error } = await admin
    .from("admin_users")
    .insert({ id: operator.id, email: operator.email.toLowerCase() });
  if (error) throw new Error(`fixture admin_users row: ${error.message}`);
});

afterAll(async () => {
  if (orgIds.length) await deleteTestOrgs(orgIds);
  const { error } = await admin.from("admin_users").delete().eq("id", operator.id);
  if (error) console.error("[cleanup] admin_users:", error.message);
  await deleteTestUsers([owner.id, operator.id]);
});

describe("pendingCacVerifications()", () => {
  it("lists an organisation with a submitted, unconfirmed CAC number", async () => {
    const orgId = await makeOrg({ number: "RC1111111", businessName: "Queue Test Ltd" });
    const queue = await pendingCacVerifications();
    const row = queue.find((r) => r.organizationId === orgId);
    expect(row, "the submitted org did not appear in the queue").toBeDefined();
    expect(row?.cacNumber).toBe("RC1111111");
    expect(row?.cacBusinessName).toBe("Queue Test Ltd");
  });

  it("does not list an organisation with no CAC submission", async () => {
    const orgId = await makeOrg({ number: null, businessName: null });
    const queue = await pendingCacVerifications();
    expect(queue.map((r) => r.organizationId)).not.toContain(orgId);
  });

  it("does not list an organisation already confirmed", async () => {
    const orgId = await makeOrg({ number: "RC2222222", businessName: "Already Confirmed Ltd" });
    const { error } = await admin
      .from("organizations")
      .update({ cac_confirmed_at: new Date().toISOString(), cac_confirmed_by: operator.id })
      .eq("id", orgId);
    expect(error).toBeNull();

    const queue = await pendingCacVerifications();
    expect(queue.map((r) => r.organizationId)).not.toContain(orgId);
  });
});

describe("approve — the conditional UPDATE decideCacVerificationAction runs", () => {
  it("sets verified, cac_confirmed_at and cac_confirmed_by together, and logs it", async () => {
    const orgId = await makeOrg({ number: "RC3333333", businessName: "Approve Path Ltd" });

    const { data: updated, error } = await approve(orgId, operator.id);
    expect(error).toBeNull();
    expect(updated).toHaveLength(1);

    const { data: after } = await admin
      .from("organizations")
      .select("verified, cac_confirmed_at, cac_confirmed_by")
      .eq("id", orgId)
      .single();
    expect(after?.verified).toBe(true);
    expect(after?.cac_confirmed_at).not.toBeNull();
    expect(after?.cac_confirmed_by).toBe(operator.id);

    await recordAdminAction({
      identity: { adminId: operator.id, email: operator.email },
      action: "organization.cac_verified",
      targetTable: "organizations",
      targetId: orgId,
      detail: { cac_number: "RC3333333", cac_business_name: "Approve Path Ltd", note: null },
    });

    const { data: log } = await admin
      .from("admin_audit_log")
      .select("action, target_table, target_id, detail")
      .eq("target_id", orgId)
      .eq("action", "organization.cac_verified")
      .maybeSingle();
    expect(log, "the approval was not written to the audit log").not.toBeNull();
    expect(log?.target_table).toBe("organizations");
    expect((log?.detail as Record<string, unknown> | null)?.cac_number).toBe("RC3333333");
  });

  it("the second of two concurrent approvals affects zero rows (0035's shape)", async () => {
    const orgId = await makeOrg({ number: "RC4444444", businessName: "Race Path Ltd" });

    const [first, second] = await Promise.all([
      approve(orgId, operator.id),
      approve(orgId, owner.id),
    ]);

    // Exactly one of the two conditional UPDATEs matched a row — the one that
    // ran while cac_confirmed_at was still null. Both succeeding (or both
    // failing) would mean the precondition is not actually gating anything.
    const winners = [first, second].filter((r) => (r.data?.length ?? 0) > 0);
    expect(winners, "either both or neither approval matched a row").toHaveLength(1);

    const { data: after } = await admin
      .from("organizations")
      .select("cac_confirmed_by")
      .eq("id", orgId)
      .single();
    // Whichever admin's UPDATE actually matched is the one attributed —
    // proving the WHERE clause, not just app-level luck, decided the winner.
    expect([operator.id, owner.id]).toContain(after?.cac_confirmed_by);
  });
});

describe("reject — no schema write, audit log only", () => {
  it("leaves the organisation's row untouched but logs the decision", async () => {
    const orgId = await makeOrg({ number: "RC5555555", businessName: "Reject Path Ltd" });

    await recordAdminAction({
      identity: { adminId: operator.id, email: operator.email },
      action: "organization.cac_rejected",
      targetTable: "organizations",
      targetId: orgId,
      detail: { cac_number: "RC5555555", cac_business_name: "Reject Path Ltd", note: "RC number does not match the register" },
    });

    const { data: after } = await admin
      .from("organizations")
      .select("verified, cac_confirmed_at, cac_number, cac_business_name")
      .eq("id", orgId)
      .single();
    expect(after?.verified).toBe(false);
    expect(after?.cac_confirmed_at).toBeNull();
    // Untouched — the employer's submission is exactly what they typed, so
    // they can see what to correct.
    expect(after?.cac_number).toBe("RC5555555");

    const { data: log } = await admin
      .from("admin_audit_log")
      .select("action, detail")
      .eq("target_id", orgId)
      .eq("action", "organization.cac_rejected")
      .maybeSingle();
    expect(log).not.toBeNull();
    expect((log?.detail as Record<string, unknown> | null)?.note).toMatch(/does not match/);

    // A rejected submission stays in the queue — founder's own spec: the
    // employer's path back in is to correct and resubmit, or a later admin
    // approves it outright. This is the assertion that the queue query
    // actually implements that rather than accidentally filtering rejections
    // out some other way.
    const queue = await pendingCacVerifications();
    expect(queue.map((r) => r.organizationId)).toContain(orgId);
  });
});
