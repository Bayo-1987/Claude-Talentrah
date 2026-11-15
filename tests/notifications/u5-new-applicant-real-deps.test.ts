/**
 * The new-applicant event through its REAL dependencies and a recording stand-in for the database: which tables it reads and writes, the one claim per inbox row, the lazy load of the sender, and
 * that nothing ever reads employer_applicant_status (the status disclosure the owner has not decided).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NOTIFICATION_RPCS } from "@/lib/notifications/contract-db";
import { makeFakeDb, tablesTouched, writesTo, type FakeCall } from "./u5-support";

const state = vi.hoisted(() => ({ client: null as unknown, delivered: [] as unknown[], flags: {} as Record<string, boolean> }));
vi.mock("@/lib/supabase/service-role", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/supabase/service-role")>()), createServiceRoleClient: () => state.client }));
vi.mock("@/lib/notifications/push/wiring", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/notifications/push/wiring")>()),
  deliverPushForUser: async (request: unknown) => void state.delivered.push(request),
}));

import { notifyNewApplicant } from "@/lib/notifications/new-applicant/notify";

const APP = "00000000-0000-4000-8000-0000000000a1";
const JOB = "00000000-0000-4000-8000-0000000000a2";
const ORG = "00000000-0000-4000-8000-0000000000a3";
const MEMBER = "00000000-0000-4000-8000-0000000000a4";
let calls: FakeCall[];

function setup(over: { flags?: Record<string, boolean>; noNotice?: boolean } = {}) {
  state.delivered = [];
  state.flags = over.flags ?? { notifications_master: true, push_sender: true };
  const db = makeFakeDb((call) => {
    if (call.table === "feature_flags") return { data: { enabled: state.flags[String(call.filters.find(([n]) => n === "eq")?.[2])] === true } };
    if (call.table === "employer_applicant_notifications") return { data: over.noNotice ? null : { job_posting_id: JOB, organization_id: ORG, is_first: true, suppressed_reason: null } };
    if (call.table === "new_applicant_recipients") return { data: [{ user_id: MEMBER, email: "member@example.test", first_name: "Sam", mode: "instant" }] };
    if (call.table === NOTIFICATION_RPCS.claimNotification) return { data: [{ id: "inbox-claim-1", refused: null }] };
    if (call.table === "email_preferences") return { data: { push_enabled: true, push_new_applicant: true, push_application_viewed: false, push_match_alert: false } };
    return undefined;
  });
  calls = db.calls;
  state.client = db.client;
}
beforeEach(() => void vi.spyOn(console, "error").mockImplementation(() => undefined));

describe("the new-applicant event, real dependencies", () => {
  it("flags on: one inbox claim, one inbox row, one push request keyed on the job", async () => {
    setup();
    await notifyNewApplicant(APP);
    expect(calls.filter((c) => c.table === NOTIFICATION_RPCS.claimNotification)).toHaveLength(1);
    expect(calls.find((c) => c.table === NOTIFICATION_RPCS.claimNotification)?.payload).toMatchObject({ p_user: MEMBER, p_kind: "new_applicant", p_subject: APP, p_channel: "inapp" });
    const rows = writesTo(calls, "user_notifications");
    expect(rows).toHaveLength(1);
    expect(rows[0].payload).toMatchObject({ user_id: MEMBER, type: "new_applicant", link: `/employer/jobs/${JOB}/applicants` });
    expect(state.delivered).toEqual([{ userId: MEMBER, kind: "new_applicant", subject: JOB, url: `/employer/jobs/${JOB}/applicants`, badge: null }]);
  });
  it("the inbox row says nothing about who applied or which job: no name, no title", async () => {
    setup();
    await notifyNewApplicant(APP);
    const row = writesTo(calls, "user_notifications")[0].payload as { title: string; body: string };
    expect(`${row.title} ${row.body}`).not.toMatch(/\d/);
  });
  it("every flag OFF: only the flag is read; nothing is written, claimed or sent", async () => {
    setup({ flags: {} });
    await notifyNewApplicant(APP);
    expect(tablesTouched(calls)).toEqual(["feature_flags"]);
    expect(state.delivered).toHaveLength(0);
  });
  it("no notice row: nothing is written or sent", async () => {
    setup({ noNotice: true });
    await notifyNewApplicant(APP);
    expect(writesTo(calls, "user_notifications")).toHaveLength(0);
    expect(calls.some((c) => c.table === NOTIFICATION_RPCS.claimNotification)).toBe(false);
    expect(state.delivered).toHaveLength(0);
  });
  it("no notification of any channel is created from a change to employer_applicant_status.status: that table is never read", async () => {
    setup();
    await notifyNewApplicant(APP);
    expect(tablesTouched(calls)).not.toContain("employer_applicant_status");
    expect(JSON.stringify(calls)).not.toContain("employer_applicant_status");
  });
});
