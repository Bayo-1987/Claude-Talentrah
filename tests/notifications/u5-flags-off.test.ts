/**
 * U5 regression: with every flag OFF (and a missing flag row, which means off), and PWA_KILL on and off, no event makes a claim, reads a device, sends, or writes a notification row the existing
 * features did not already write. The new-applicant event writes nothing at all.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NOTIFICATION_RPCS, NOTIFICATION_TABLES } from "@/lib/notifications/contract-db";
import { makeFakeDb, makeMailer, tablesTouched, writesTo, type FakeCall } from "./u5-support";

const state = vi.hoisted(() => ({ client: null as unknown, mailer: null as unknown, delivered: [] as unknown[] }));
vi.mock("@/lib/supabase/service-role", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/supabase/service-role")>()), createServiceRoleClient: () => state.client }));
vi.mock("@/lib/resend/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/resend/client")>()), getResendClient: () => state.mailer }));
vi.mock("@/lib/matching/score", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/matching/score")>()),
  computeMatchScore: () => ({ score: 90, explanation: { matchedSkills: ["a", "b", "c", "d"], missingSkills: [] } }),
}));
vi.mock("@/lib/notifications/push/wiring", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/notifications/push/wiring")>()),
  deliverPushForUser: async (request: unknown) => void state.delivered.push(request),
}));

import { notifyNewApplicant } from "@/lib/notifications/new-applicant/notify";
import { notifySeekerResumeViewed } from "@/lib/notifications/employer-resume-view/notify";
import { sendProactiveMatchAlerts } from "@/lib/notifications/proactive-match-alert/send";

const ID = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
let calls: FakeCall[];

function setup() {
  state.delivered = [];
  const db = makeFakeDb((call) => {
    // The match alert's own flag is ON (that is the email feature); every notification flag is OFF or has no row.
    if (call.table === "feature_flags") return { data: call.filters.some(([, , v]) => v === "proactive_match_alert") ? { enabled: true } : null };
    if (call.table === "employer_applicant_notifications") return { data: { job_posting_id: ID(2), organization_id: ID(3), is_first: true, suppressed_reason: null } };
    if (call.table === "new_applicant_recipients") return { data: [{ user_id: ID(4), email: "m@example.test", first_name: "Sam", mode: "instant" }] };
    if (call.table === "job_postings") return { data: [{ id: ID(2), title: "Role X", company_name: "Company Y", location: null, posted_at: "2026-11-14T10:00:00Z", status: "open", organization_id: null, unlisted_at: null, structured_jd: { skills: ["a"] }, seniority: null }] };
    if (call.table === "email_preferences" && call.columns?.includes("unsubscribe_token")) return { data: [{ user_id: ID(5), unsubscribe_token: "tok", profiles: { email: "s@example.test", first_name: "Ada", last_active_at: "2026-01-01T00:00:00Z" } }] };
    if (call.table === "email_preferences" && call.columns?.includes("employer_resume_view")) return { data: { employer_resume_view: true, profiles: { email: "s@example.test", first_name: "Ada" } } };
    if (call.table === "email_preferences") return { data: { push_enabled: true, push_new_applicant: true, push_application_viewed: true, push_match_alert: true } };
    if (call.table === "resumes" && call.columns === "user_id") return { data: [{ user_id: ID(5) }] };
    if (call.table === "resumes") return { data: { structured_content: {} } };
    return undefined;
  });
  calls = db.calls;
  state.client = db.client;
  state.mailer = makeMailer().resend;
}
beforeEach(() => {
  setup();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe.each([[undefined], ["0"], ["1"]])("every flag off, PWA_KILL=%s", (kill) => {
  beforeEach(() => void (kill === undefined ? vi.unstubAllEnvs() : vi.stubEnv("PWA_KILL", kill)));

  it("a new applicant: nothing is read but the flag, nothing is written, claimed or sent", async () => {
    await notifyNewApplicant(ID(1));
    expect(tablesTouched(calls)).toEqual(["feature_flags"]);
    expect(state.delivered).toHaveLength(0);
  });
  it("a first resume view: only the existing in-app row is written; no claim, no push", async () => {
    await notifySeekerResumeViewed({ applicationId: ID(1), seekerId: ID(5), jobTitle: "Role X", companyName: "Company Y" });
    expect(writesTo(calls, "user_notifications")).toHaveLength(1);
    expect(calls.some((c) => c.table === NOTIFICATION_RPCS.claimNotification || c.table === NOTIFICATION_TABLES.deliveries)).toBe(false);
    expect(state.delivered).toHaveLength(0);
  });
  it("a proactive match alert: the existing lock row, in-app row and email only; no claim, no push", async () => {
    await sendProactiveMatchAlerts("2026-11-14T00:00:00Z", new Date("2026-11-14T12:00:00Z"));
    expect(writesTo(calls, "user_notifications")).toHaveLength(1);
    expect(calls.some((c) => c.table === NOTIFICATION_RPCS.claimNotification || c.table === NOTIFICATION_TABLES.deliveries)).toBe(false);
    expect(state.delivered).toHaveLength(0);
  });
});
