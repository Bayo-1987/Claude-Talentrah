/**
 * U5, step 3 (characterise first): what the existing "your resume was viewed" notice does TODAY, written and green before the push channel is added to it. One in-app row and one email for an
 * opted-in seeker; one row and no email for an opted-out seeker; one row and no email when the mailer is not configured; a failing in-app write still lets the email go. Counts only: these
 * assertions must stay true, unchanged, after the change.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeFakeDb, makeMailer, writesTo, type FakeCall } from "./u5-support";

const state = vi.hoisted(() => ({ client: null as unknown, mailer: null as unknown, configured: true }));

vi.mock("@/lib/supabase/service-role", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/service-role")>()),
  createServiceRoleClient: () => state.client,
}));
vi.mock("@/lib/resend/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/resend/client")>()),
  getResendClient: () => (state.configured ? state.mailer : null),
}));

import { notifySeekerResumeViewed } from "@/lib/notifications/employer-resume-view/notify";

const SEEKER = "00000000-0000-4000-8000-0000000000e1";
const params = { applicationId: "00000000-0000-4000-8000-0000000000e2", seekerId: SEEKER, jobTitle: "Role X", companyName: "Company Y" };
let calls: FakeCall[];
let mail: ReturnType<typeof makeMailer>;

function setup(opts: { optedIn?: boolean; configured?: boolean; inAppFails?: boolean } = {}) {
  const db = makeFakeDb((call) => {
    if (call.table === "user_notifications" && call.op === "insert") return opts.inAppFails ? { error: { message: "boom" } } : { error: null };
    if (call.table === "email_preferences") return { data: { employer_resume_view: opts.optedIn !== false, profiles: { email: "seeker@example.test", first_name: "Ada" } } };
    return undefined; // every other table (a flag row, say) answers: no row
  });
  calls = db.calls;
  state.client = db.client;
  mail = makeMailer();
  state.mailer = mail.resend;
  state.configured = opts.configured !== false;
}

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => undefined));

describe("the viewed notice today", () => {
  it("an opted-in seeker gets exactly one in-app row and exactly one email", async () => {
    setup();
    await notifySeekerResumeViewed(params);
    expect(writesTo(calls, "user_notifications")).toHaveLength(1);
    expect((writesTo(calls, "user_notifications")[0].payload as { user_id: string; type: string }).type).toBe("employer_resume_view");
    expect(mail.sent).toHaveLength(1);
  });
  it("an opted-out seeker still gets the in-app row and no email", async () => {
    setup({ optedIn: false });
    await notifySeekerResumeViewed(params);
    expect(writesTo(calls, "user_notifications")).toHaveLength(1);
    expect(mail.sent).toHaveLength(0);
  });
  it("with no mailer configured the in-app row is still written and no email is attempted", async () => {
    setup({ configured: false });
    await notifySeekerResumeViewed(params);
    expect(writesTo(calls, "user_notifications")).toHaveLength(1);
    expect(mail.sent).toHaveLength(0);
  });
  it("a failing in-app write does not cost the person the email", async () => {
    setup({ inAppFails: true });
    await notifySeekerResumeViewed(params);
    expect(mail.sent).toHaveLength(1);
  });
  it("it never throws, whatever the database does", async () => {
    state.client = { from: () => { throw new Error("db down"); } };
    state.mailer = makeMailer().resend;
    await expect(notifySeekerResumeViewed(params)).resolves.toBeUndefined();
  });
});
