/**
 * The proactive match alert with its push channel. The push rides the existing selection only: it can fire for the one job pickBestJobForCandidate returns (an Excellent, sufficiently screenable
 * match), after the existing lock row, in-app row and email; its text has no digit; and the existing counts are unchanged.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeDeliverHarness, makeFakeDb, makeMailer, writesTo, type FakeCall } from "./u5-support";

const state = vi.hoisted(() => ({ client: null as unknown, mailer: null as unknown, deliver: null as null | ((r: unknown) => Promise<unknown>), score: 90, matched: 4, flags: {} as Record<string, boolean>, prefs: null as unknown }));
vi.mock("@/lib/supabase/service-role", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/supabase/service-role")>()), createServiceRoleClient: () => state.client }));
vi.mock("@/lib/resend/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/resend/client")>()), getResendClient: () => state.mailer }));
vi.mock("@/lib/matching/score", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/matching/score")>()),
  computeMatchScore: () => ({ score: state.score, explanation: { matchedSkills: Array.from({ length: state.matched }, (_, i) => `skill-${i}`), missingSkills: [] } }),
}));
vi.mock("@/lib/notifications/push/wiring", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/notifications/push/wiring")>()),
  deliverPushForUser: (request: unknown) => (state.deliver as (r: unknown) => Promise<unknown>)(request),
}));

import { sendProactiveMatchAlerts } from "@/lib/notifications/proactive-match-alert/send";

const USER = "00000000-0000-4000-8000-0000000000f1";
const JOB = "00000000-0000-4000-8000-0000000000f2";
const NOW = new Date("2026-11-14T12:00:00Z");
let calls: FakeCall[];
let mail: ReturnType<typeof makeMailer>;
let harness: ReturnType<typeof makeDeliverHarness>;

function setup(flags: Record<string, boolean> = { proactive_match_alert: true, notifications_master: true, push_sender: true }, prefs: unknown = { push_enabled: true, push_match_alert: true, push_new_applicant: false, push_application_viewed: false }) {
  state.flags = flags;
  const db = makeFakeDb((call) => {
    if (call.table === "feature_flags") return { data: { enabled: flags[String(call.filters.find(([n]) => n === "eq")?.[2])] === true } };
    if (call.table === "job_postings") return { data: [{ id: JOB, title: "Role X", company_name: "Company Y", location: null, posted_at: "2026-11-14T10:00:00Z", status: "open", organization_id: null, unlisted_at: null, structured_jd: { skills: ["a", "b", "c", "d"] }, seniority: null }] };
    if (call.table === "email_preferences" && call.columns?.includes("unsubscribe_token")) return { data: [{ user_id: USER, unsubscribe_token: "tok", profiles: { email: "seeker@example.test", first_name: "Ada", last_active_at: "2026-01-01T00:00:00Z" } }] };
    if (call.table === "email_preferences") return { data: prefs };
    if (call.table === "resumes" && call.columns === "user_id") return { data: [{ user_id: USER }] };
    if (call.table === "resumes") return { data: { structured_content: { skills: [] } } };
    return undefined;
  });
  calls = db.calls;
  state.client = db.client;
  mail = makeMailer();
  state.mailer = mail.resend;
  harness = makeDeliverHarness();
  state.deliver = (r) => harness.deliver(r as never);
}
beforeEach(() => {
  state.score = 90;
  state.matched = 4;
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
const run = () => sendProactiveMatchAlerts("2026-11-14T00:00:00Z", NOW);

describe("the match-alert push", () => {
  it("a match-alert push is sent only for an excellent, sufficiently screenable match and its text contains no digit", async () => {
    setup();
    await run();
    expect(harness.requests).toEqual([{ userId: USER, kind: "match_alert", subject: JOB, url: "/jobs", badge: null }]);
    const { payload } = harness.sender.sent[0];
    expect(`${payload.title} ${payload.body}`).not.toMatch(/\d|%/);
    expect(JSON.stringify(payload)).not.toMatch(/90/);
  });
  it("the existing counts are unchanged by it: one lock row, one in-app row, one email", async () => {
    setup();
    await run();
    expect([writesTo(calls, "proactive_match_alerts").length, writesTo(calls, "user_notifications").length, mail.sent.length]).toEqual([1, 1, 1]);
  });
  it("a Good match, a thin Excellent match and a candidate with the push switch off are not pushed", async () => {
    setup();
    state.score = 75;
    await run();
    expect(harness.requests).toHaveLength(0);
    setup();
    state.score = 90;
    state.matched = 2;
    await run();
    expect(harness.requests).toHaveLength(0);
    setup(undefined, { push_enabled: true, push_match_alert: false });
    state.matched = 4;
    await run();
    expect(harness.requests).toHaveLength(0);
    expect(mail.sent).toHaveLength(1);
  });
  it.each([
    ["every push flag off", { proactive_match_alert: true }],
    ["push_sender off", { proactive_match_alert: true, notifications_master: true, push_sender: false }],
  ])("with %s no push is attempted and the email run is unchanged", async (_n, flags) => {
    setup(flags);
    await run();
    expect(harness.requests).toHaveLength(0);
    expect(harness.claims).toHaveLength(0);
    expect([writesTo(calls, "user_notifications").length, mail.sent.length]).toEqual([1, 1]);
  });
  it("a sender that throws does not turn a sent alert into a failed one", async () => {
    setup();
    state.deliver = async () => {
      throw new Error("sender exploded");
    };
    const summary = await run();
    expect(summary).toMatchObject({ sent: 1, failed: 0 });
  });
  it("nothing reads employer_applicant_status", async () => {
    setup();
    await run();
    expect(JSON.stringify(calls)).not.toContain("employer_applicant_status");
  });
});
