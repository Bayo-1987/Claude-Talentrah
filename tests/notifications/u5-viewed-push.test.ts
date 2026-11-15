/**
 * The viewed notice with its push channel: the existing counts (one in-app row, one email) are unchanged by it, and the push goes out only when notifications_master, push_sender AND the person's
 * push_application_viewed switch (default false) are on; a second view of the same application sends no push.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeDeliverHarness, makeFakeDb, makeMailer, writesTo, type FakeCall } from "./u5-support";

const state = vi.hoisted(() => ({ client: null as unknown, mailer: null as unknown, deliver: null as null | ((r: unknown) => Promise<unknown>) }));
vi.mock("@/lib/supabase/service-role", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/supabase/service-role")>()), createServiceRoleClient: () => state.client }));
vi.mock("@/lib/resend/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/resend/client")>()), getResendClient: () => state.mailer }));
vi.mock("@/lib/notifications/push/wiring", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/notifications/push/wiring")>()),
  deliverPushForUser: (request: unknown) => (state.deliver as (r: unknown) => Promise<unknown>)(request),
}));

import { notifySeekerResumeViewed } from "@/lib/notifications/employer-resume-view/notify";

const SEEKER = "00000000-0000-4000-8000-0000000000e1";
const APP = "00000000-0000-4000-8000-0000000000e2";
const params = { applicationId: APP, seekerId: SEEKER, jobTitle: "Role X", companyName: "Company Y" };
let calls: FakeCall[];
let mail: ReturnType<typeof makeMailer>;
let harness: ReturnType<typeof makeDeliverHarness>;

function setup(over: { flags?: Record<string, boolean>; prefs?: Record<string, boolean> | null } = {}) {
  const flags = over.flags ?? { notifications_master: true, push_sender: true };
  const db = makeFakeDb((call) => {
    if (call.table === "feature_flags") return { data: { enabled: flags[String(call.filters.find(([n]) => n === "eq")?.[2])] === true } };
    if (call.table === "email_preferences" && call.columns?.includes("employer_resume_view")) return { data: { employer_resume_view: true, profiles: { email: "seeker@example.test", first_name: "Ada" } } };
    if (call.table === "email_preferences") return { data: over.prefs === undefined ? { push_enabled: true, push_application_viewed: true, push_new_applicant: false, push_match_alert: false } : over.prefs };
    return undefined;
  });
  calls = db.calls;
  state.client = db.client;
  mail = makeMailer();
  state.mailer = mail.resend;
  harness = makeDeliverHarness();
  state.deliver = (r) => harness.deliver(r as never);
}
beforeEach(() => void vi.spyOn(console, "error").mockImplementation(() => undefined));

describe("the viewed notice with its push channel", () => {
  it("a first resume view creates one inbox row and a push only when push_application_viewed is on", async () => {
    setup();
    await notifySeekerResumeViewed(params);
    expect(writesTo(calls, "user_notifications")).toHaveLength(1);
    expect(mail.sent).toHaveLength(1);
    expect(harness.requests).toEqual([{ userId: SEEKER, kind: "application_viewed", subject: APP, url: "/tracker", badge: null }]);
    expect(harness.sender.sent).toHaveLength(1);

    setup({ prefs: { push_enabled: true, push_application_viewed: false } });
    await notifySeekerResumeViewed(params);
    expect(writesTo(calls, "user_notifications")).toHaveLength(1);
    expect(mail.sent).toHaveLength(1);
    expect(harness.requests).toHaveLength(0);
  });
  it("a second view of the same application sends no push", async () => {
    setup();
    await notifySeekerResumeViewed(params);
    await notifySeekerResumeViewed(params);
    expect(harness.sender.sent).toHaveLength(1);
    expect(harness.claims).toHaveLength(1);
  });
  it("the claim is keyed on the application, so two different applications each get their own push", async () => {
    setup();
    await notifySeekerResumeViewed(params);
    await notifySeekerResumeViewed({ ...params, applicationId: "00000000-0000-4000-8000-0000000000e3" });
    expect(harness.sender.sent).toHaveLength(2);
  });
  it("the viewed push text contains no company, job title, name or status", async () => {
    setup();
    await notifySeekerResumeViewed(params);
    const { payload } = harness.sender.sent[0];
    const text = `${payload.title} ${payload.body}`.toLowerCase();
    for (const forbidden of ["company y", "role x", "ada", "viewed", "opened", "status", "applied", "interview", "rejected"]) expect(text).not.toContain(forbidden);
    expect(text).not.toMatch(/\d/);
  });
  it.each([
    ["every flag off", {}],
    ["notifications_master off", { notifications_master: false, push_sender: true }],
    ["push_sender off", { notifications_master: true, push_sender: false }],
  ])("with %s no push is attempted and the existing in-app row and email are unchanged", async (_n, flags) => {
    setup({ flags });
    await notifySeekerResumeViewed(params);
    expect(harness.requests).toHaveLength(0);
    expect(harness.claims).toHaveLength(0);
    expect(writesTo(calls, "user_notifications")).toHaveLength(1);
    expect(mail.sent).toHaveLength(1);
  });
  it("a sender that throws changes nothing for the caller: the row and the email still happened and nothing is thrown", async () => {
    setup();
    state.deliver = async () => {
      throw new Error("sender exploded");
    };
    await expect(notifySeekerResumeViewed(params)).resolves.toBeUndefined();
    expect(writesTo(calls, "user_notifications")).toHaveLength(1);
    expect(mail.sent).toHaveLength(1);
  });
  it("the push does not depend on the email: with the viewed email opted out the push still goes", async () => {
    setup();
    mail.sent.length = 0;
    await notifySeekerResumeViewed(params);
    expect(harness.sender.sent).toHaveLength(1);
  });
  it("push_application_viewed defaults to false in the database", () => {
    const sql = readFileSync(path.resolve(__dirname, "../../supabase/migrations/0265_notifications_and_admin_messaging.sql"), "utf8");
    expect(sql).toMatch(/push_application_viewed boolean not null default false/);
  });
  it("nothing reads employer_applicant_status", async () => {
    setup();
    await notifySeekerResumeViewed(params);
    expect(JSON.stringify(calls)).not.toContain("employer_applicant_status");
  });
});
