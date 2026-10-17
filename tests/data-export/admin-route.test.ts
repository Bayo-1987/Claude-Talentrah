/**
 * POST /admin/data-export: its OWN admin guard (the protected layout does not cover route handlers, and requirePermission redirects), against the real local database.
 *   signed out -> 401, nothing written; an admin WITHOUT `data_export` -> 403 and a people.export_denied row; with the permission -> the start or the cancel runs.
 * Malformed form fields are a 400 that writes nothing; a target that is not a uuid is an audited refusal that copies nothing.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { acquireBucketLock, releaseBucketLock } from "../support/bucket-lock";
import { auditRowsSince, cleanupAll, flags, makeAdmin, makePerson, PERSON_FIRST_NAME, PERSON_LAST_NAME } from "../support/data-export-fixtures";
import type { AdminIdentity } from "@/lib/admin/session";

const h = vi.hoisted(() => ({ identity: null as unknown, sent: [] as Array<{ template: string }> }));

vi.mock("@/lib/supabase/service-role", async () => {
  const { countedService } = await import("../support/data-export-fixtures");
  return { createServiceRoleClient: () => countedService().client };
});
vi.mock("@/lib/admin/require-admin", () => ({ getAdmin: async () => h.identity }));
vi.mock("@/lib/account-deletion/export-email", () => ({
  sendDataExportEmail: async (template: string) => {
    h.sent.push({ template });
    return { error: null };
  },
}));
vi.mock("@/lib/paystack/client", () => ({ listNigerianBanks: async () => [] }));

import { POST } from "@/app/admin/data-export/route";
import * as route from "@/app/admin/data-export/route";

const ORIGIN = "https://www.example.test";
const identityFor = (a: { adminId: string; email: string }, permissions: string[]): AdminIdentity =>
  ({ sessionId: null as unknown as string, adminId: a.adminId, email: a.email, displayName: null, expiresAt: new Date(Date.now() + 3_600_000).toISOString(), role: "standard", roleId: null, roleName: null, permissions }) as unknown as AdminIdentity;

const post = (body: unknown, headers: Record<string, string> = { origin: ORIGIN }) =>
  POST(new Request(`${ORIGIN}/admin/data-export`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }));

const START = { action: "start", ticket: "SUP-5001", reason: "access_request", requesterCheck: "contact_form" };

beforeAll(async () => {
  await acquireBucketLock();
}, 300_000);
beforeEach(() => {
  h.identity = null;
  h.sent.length = 0;
  flags.failAuditInsert = false;
});
afterAll(async () => {
  try {
    await cleanupAll();
  } finally {
    releaseBucketLock();
  }
}, 120_000);

describe("the guard", () => {
  it("signed out: 401, and nothing is written", async () => {
    const p = await makePerson();
    const before = (await auditRowsSince()).length;
    const res = await post({ ...START, target: p.id });
    expect(res.status).toBe(401);
    expect((await auditRowsSince()).length).toBe(before);
    expect(h.sent).toEqual([]);
  });

  it("an admin WITHOUT the permission: 403, a people.export_denied row, and nothing read or sent", async () => {
    const a = await makeAdmin();
    const p = await makePerson();
    h.identity = identityFor(a, ["people", "finance"]);
    const res = await post({ ...START, target: p.id });
    expect(res.status).toBe(403);
    const rows = (await auditRowsSince()).filter((r) => r.admin_user_id === a.adminId);
    expect(rows.map((r) => r.action)).toEqual(["people.export_denied"]);
    expect(rows[0].detail).toMatchObject({ operation: "start", reason: "missing_permission" });
    expect(JSON.stringify(rows)).not.toContain(p.id);
    expect(h.sent).toEqual([]);
    // the cancel is guarded the same way
    const cancel = await post({ action: "cancel", target: p.id, ticket: "SUP-5002" });
    expect(cancel.status).toBe(403);
    expect((await auditRowsSince()).filter((r) => r.admin_user_id === a.adminId && r.action === "people.export_denied")).toHaveLength(2);
  });

  it("an admin WITH the permission: the export starts, the person is emailed twice, and the answer carries no personal data", async () => {
    const a = await makeAdmin();
    const p = await makePerson();
    h.identity = identityFor(a, ["data_export"]);
    const res = await post({ ...START, target: p.id });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(JSON.parse(body)).toMatchObject({ ok: true });
    for (const s of [p.email, PERSON_FIRST_NAME, PERSON_LAST_NAME, p.id]) expect(body).not.toContain(s);
    expect(h.sent.map((m) => m.template)).toEqual(["data_export_generated", "data_export_link"]);
  });

  it("a request from another origin is refused before anything else", async () => {
    const a = await makeAdmin();
    h.identity = identityFor(a, ["data_export"]);
    const res = await post({ ...START, target: randomUUID() }, { origin: "https://evil.example.test" });
    expect(res.status).toBe(403);
    const none = await post({ ...START, target: randomUUID() }, {});
    expect(none.status).toBe(403);
    expect((await auditRowsSince()).filter((r) => r.admin_user_id === a.adminId)).toEqual([]);
  });

  it("POST only: the route exports no GET", () => {
    expect((route as Record<string, unknown>).GET).toBeUndefined();
    expect(typeof route.POST).toBe("function");
  });
});

describe("the fields", () => {
  it.each([
    ["a ticket with an at sign (an email address is not a reference)", { ticket: "jane@example.com" }],
    ["a ticket with spaces", { ticket: "ticket one two" }],
    ["an empty ticket", { ticket: "" }],
    ["a reason that is not on the pick-list", { reason: "just curious" }],
    ["a requester check that is not on the pick-list", { requesterCheck: "trust me" }],
  ])("%s: 400, and NOTHING is written", async (_name, patch) => {
    const a = await makeAdmin();
    const p = await makePerson();
    h.identity = identityFor(a, ["data_export"]);
    const res = await post({ ...START, ...patch, target: p.id });
    expect(res.status).toBe(400);
    expect((await auditRowsSince()).filter((r) => r.admin_user_id === a.adminId)).toEqual([]);
    expect(h.sent).toEqual([]);
  });

  it("a target that is not a uuid is an audited refusal (400 here) and the typed text is nowhere in the log or the answer", async () => {
    const a = await makeAdmin();
    h.identity = identityFor(a, ["data_export"]);
    const typed = "someone.private@example.com";
    const res = await post({ ...START, target: typed });
    expect(res.status).toBe(400);
    expect(await res.text()).not.toContain("someone.private");
    const rows = (await auditRowsSince()).filter((r) => r.admin_user_id === a.adminId);
    expect(rows.map((r) => r.action)).toEqual(["people.export_requested", "people.export_finished"]);
    expect(JSON.stringify(rows)).not.toContain("someone.private");
    expect(rows[1].detail).toMatchObject({ outcome: "refused", refusal_code: "not_a_uuid" });
  });

  it("with the audit log unavailable: a generic 503 with no detail, and nothing is sent", async () => {
    const a = await makeAdmin();
    const p = await makePerson();
    h.identity = identityFor(a, ["data_export"]);
    flags.failAuditInsert = true;
    const res = await post({ ...START, target: p.id });
    expect(res.status).toBe(503);
    expect(JSON.parse(await res.text())).toEqual({ ok: false, message: expect.not.stringContaining(p.id) });
    expect(h.sent).toEqual([]);
  });
});

describe("the cancel through the route", () => {
  it("cancels an unused export and says so; a second cancel is refused not_cancellable (409)", async () => {
    const a = await makeAdmin();
    const p = await makePerson();
    h.identity = identityFor(a, ["data_export"]);
    expect((await post({ ...START, target: p.id })).status).toBe(200);
    const sentBefore = h.sent.length;
    const first = await post({ action: "cancel", target: p.id, ticket: "SUP-5003" });
    expect(first.status).toBe(200);
    expect(h.sent.length, "the person is not emailed about a cancel").toBe(sentBefore);
    const second = await post({ action: "cancel", target: p.id, ticket: "SUP-5003" });
    expect(second.status).toBe(409);
    expect(JSON.parse(await second.text())).toMatchObject({ code: "not_cancellable" });
  });
});
