/**
 * U5, step 3 (characterise first): what the existing proactive match alert does TODAY, written and green before the push channel is added to send.ts. For one eligible candidate and one new
 * posting: an Excellent, sufficiently screenable match yields one lock row, one in-app row and one email; a Good match, a thin Excellent match, and a rate-limited candidate yield none.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeFakeDb, makeMailer, writesTo, type FakeCall } from "./u5-support";

const state = vi.hoisted(() => ({ client: null as unknown, mailer: null as unknown, score: 90, matched: 4, lastAlert: null as string | null }));

vi.mock("@/lib/supabase/service-role", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/service-role")>()),
  createServiceRoleClient: () => state.client,
}));
vi.mock("@/lib/resend/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/resend/client")>()),
  getResendClient: () => state.mailer,
}));
vi.mock("@/lib/matching/score", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/matching/score")>()),
  computeMatchScore: () => ({ score: state.score, explanation: { matchedSkills: Array.from({ length: state.matched }, (_, i) => `skill-${i}`), missingSkills: [] } }),
}));

import { sendProactiveMatchAlerts } from "@/lib/notifications/proactive-match-alert/send";

const USER = "00000000-0000-4000-8000-0000000000f1";
const JOB = "00000000-0000-4000-8000-0000000000f2";
const NOW = new Date("2026-11-14T12:00:00Z");
let calls: FakeCall[];
let mail: ReturnType<typeof makeMailer>;

function setup() {
  const db = makeFakeDb((call) => {
    if (call.table === "feature_flags") return { data: { enabled: call.filters.some(([, , v]) => v === "proactive_match_alert") } };
    if (call.table === "job_postings") return { data: [{ id: JOB, title: "Role X", company_name: "Company Y", location: null, posted_at: "2026-11-14T10:00:00Z", status: "open", organization_id: null, unlisted_at: null, structured_jd: { skills: ["a", "b", "c", "d"] }, seniority: null }] };
    if (call.table === "email_preferences") return { data: [{ user_id: USER, unsubscribe_token: "tok", profiles: { email: "seeker@example.test", first_name: "Ada", last_active_at: "2026-01-01T00:00:00Z" } }] };
    if (call.table === "resumes" && call.columns === "user_id") return { data: [{ user_id: USER }] };
    if (call.table === "resumes") return { data: { structured_content: { skills: [] } } };
    if (call.table === "proactive_match_alerts" && call.op === "select") return { data: state.lastAlert ? [{ user_id: USER, sent_at: state.lastAlert }] : [] };
    return undefined;
  });
  calls = db.calls;
  state.client = db.client;
  mail = makeMailer();
  state.mailer = mail.resend;
}

beforeEach(() => {
  state.score = 90;
  state.matched = 4;
  state.lastAlert = null;
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  setup();
});

describe("the proactive match alert today", () => {
  it("an Excellent, sufficiently screenable match: one lock row, one in-app row, one email", async () => {
    const summary = await sendProactiveMatchAlerts("2026-11-14T00:00:00Z", NOW);
    expect(summary).toMatchObject({ enabled: true, sent: 1, failed: 0 });
    expect(writesTo(calls, "proactive_match_alerts")).toHaveLength(1);
    expect(writesTo(calls, "user_notifications")).toHaveLength(1);
    expect(mail.sent).toHaveLength(1);
  });
  it("a Good match (not Excellent) sends nothing", async () => {
    state.score = 75;
    await sendProactiveMatchAlerts("2026-11-14T00:00:00Z", NOW);
    expect([writesTo(calls, "proactive_match_alerts").length, writesTo(calls, "user_notifications").length, mail.sent.length]).toEqual([0, 0, 0]);
  });
  it("a thin Excellent match (two screenable tags or fewer) sends nothing", async () => {
    state.matched = 2;
    await sendProactiveMatchAlerts("2026-11-14T00:00:00Z", NOW);
    expect([writesTo(calls, "proactive_match_alerts").length, writesTo(calls, "user_notifications").length, mail.sent.length]).toEqual([0, 0, 0]);
  });
  it("a candidate alerted inside the last seven days is skipped", async () => {
    state.lastAlert = "2026-11-12T00:00:00Z";
    await sendProactiveMatchAlerts("2026-11-14T00:00:00Z", NOW);
    expect(mail.sent).toHaveLength(0);
  });
});
