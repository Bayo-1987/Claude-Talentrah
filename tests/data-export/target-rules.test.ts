/**
 * The two admin-target refusals, kept apart (owner's rule, 18 Oct 2026):
 *   own_account                     checked FIRST, by user id: the target is the acting admin's own account.
 *   admin_target_needs_other_admin  a DIFFERENT account that belongs to an admin and whose registered address equals the acting admin's, compared after lowercasing and trimming only
 *                                   (a plus-tag is never stripped: a+x@ and a@ are different addresses here).
 * A different admin with a different address is allowed. No case produces both codes.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { admin as realService } from "../support/auth";
import { acquireBucketLock, releaseBucketLock } from "../support/bucket-lock";
import { auditRowsSince, cleanupAll, countedService, fakeMailer, makeAdmin, makePerson, releaseCreated } from "../support/data-export-fixtures";
import { checkTarget } from "@/lib/data-export/target";
import { startExport } from "@/lib/data-export/start";

vi.mock("@/lib/supabase/service-role", async () => {
  const { countedService } = await import("../support/data-export-fixtures");
  return { createServiceRoleClient: () => countedService().client };
});

beforeAll(async () => {
  await acquireBucketLock();
}, 300_000);
afterEach(releaseCreated, 60_000);
afterAll(async () => {
  try {
    await cleanupAll();
  } finally {
    releaseBucketLock();
  }
}, 120_000);

const svc = () => countedService().client;
const INPUT = { ticket: "SUP-6001", reason: "access_request", requesterCheck: "contact_form" } as const;

/** A second account that belongs to an admin (an admin_users row of its own). */
async function otherAdminAccount() {
  const b = await makePerson();
  const { error } = await realService.from("admin_users").upsert({ id: b.id, email: `other-${randomUUID()}@talentrah.test` });
  if (error) throw new Error(error.message);
  return b;
}

describe("own_account comes first, by user id", () => {
  it("the acting admin's own account is own_account", async () => {
    const a = await makeAdmin();
    expect(await checkTarget(svc(), a, a.adminId)).toEqual({ ok: false, code: "own_account" });
  });

  it("an upper-case copy of the own id is still own_account", async () => {
    const a = await makeAdmin();
    expect(await checkTarget(svc(), a, a.adminId.toUpperCase())).toEqual({ ok: false, code: "own_account" });
  });

  it("an own-account attempt is never reported as admin_target_needs_other_admin, even when the address is also shared", async () => {
    const a = await makeAdmin();
    const { data } = await realService.from("profiles").select("email").eq("id", a.adminId).single();
    const who = { ...a, email: data!.email };
    const r = await checkTarget(svc(), who, a.adminId);
    expect(r).toEqual({ ok: false, code: "own_account" });
  });
});

describe("admin_target_needs_other_admin", () => {
  it("a second account that belongs to an admin and has the acting admin's registered address is refused", async () => {
    const a = await makeAdmin();
    const b = await otherAdminAccount();
    expect(await checkTarget(svc(), { ...a, email: b.email }, b.id)).toEqual({ ok: false, code: "admin_target_needs_other_admin" });
  });

  it("the comparison lowercases and trims, and nothing else", async () => {
    const a = await makeAdmin();
    const b = await otherAdminAccount();
    expect(await checkTarget(svc(), { ...a, email: `  ${b.email.toUpperCase()}  ` }, b.id)).toEqual({ ok: false, code: "admin_target_needs_other_admin" });
    const [local, domain] = b.email.split("@");
    const tagged = `${local}+tag@${domain}`;
    const r = await checkTarget(svc(), { ...a, email: tagged }, b.id);
    expect(r.ok, "a plus-tag is a different address").toBe(true);
  });

  it("a different admin with a different address is allowed", async () => {
    const a = await makeAdmin();
    const b = await otherAdminAccount();
    const r = await checkTarget(svc(), a, b.id);
    expect(r.ok).toBe(true);
  });

  it("an account that does NOT belong to an admin is not caught by it, even with the same address", async () => {
    const a = await makeAdmin();
    const p = await makePerson();
    expect((await checkTarget(svc(), { ...a, email: p.email }, p.id)).ok).toBe(true);
  });
});

describe("through the start flow: exactly one final row per code, and no overlap", () => {
  const deps = (a: Awaited<ReturnType<typeof makeAdmin>>) => ({
    service: svc(), admin: a, send: fakeMailer().send, siteOrigin: "https://www.example.test", supportUrl: "https://www.example.test/contact", from: "x <x@example.test>", loadBankNames: async () => new Map(),
  });
  const finished = async (adminId: string) => (await auditRowsSince()).filter((r) => r.admin_user_id === adminId && r.action === "people.export_finished");

  it("own account -> one row, code own_account only", async () => {
    const a = await makeAdmin();
    expect(await startExport(deps(a), { targetRaw: a.adminId, ...INPUT })).toEqual({ status: "refused", code: "own_account" });
    const rows = await finished(a.adminId);
    expect(rows).toHaveLength(1);
    expect(rows[0].detail).toMatchObject({ outcome: "refused", refusal_code: "own_account" });
  });

  it("same-address admin account -> one row, code admin_target_needs_other_admin only", async () => {
    const a = await makeAdmin();
    const b = await otherAdminAccount();
    expect(await startExport(deps({ ...a, email: b.email }), { targetRaw: b.id, ...INPUT })).toEqual({ status: "refused", code: "admin_target_needs_other_admin" });
    const rows = await finished(a.adminId);
    expect(rows).toHaveLength(1);
    expect(rows[0].detail).toMatchObject({ outcome: "refused", refusal_code: "admin_target_needs_other_admin" });
  });

  it("a different admin with a different address -> the export starts", async () => {
    const a = await makeAdmin();
    const b = await otherAdminAccount();
    expect((await startExport(deps(a), { targetRaw: b.id, ...INPUT })).status).toBe("started");
    const rows = await finished(a.adminId);
    expect(rows).toHaveLength(1);
    expect(rows[0].detail).toMatchObject({ outcome: "completed", refusal_code: null });
  });
});
