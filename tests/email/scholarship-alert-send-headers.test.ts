/**
 * The scholarship deadline alert through its real sender, with the in-memory database and mailer of the U5 tests (no module factory: the modules are replaced with vi.spyOn). It sends one reminder
 * and that email carries the one-click header pair for ITS kind, pointing at POST /api/unsubscribe, while the link in its body stays the confirm page. Before this file the alert's headers were
 * pinned only by a source scan.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as serviceRole from "@/lib/supabase/service-role";
import * as resendClient from "@/lib/resend/client";
import { absoluteUrl } from "@/lib/seo/site";
import { unsubscribeHeaders } from "@/lib/email/unsubscribe";
import { sendScholarshipDeadlineAlerts } from "@/lib/scholarship-deadline-alerts/send";
import { makeFakeDb, makeMailer, writesTo } from "../notifications/u5-support";

const NOW = new Date("2026-11-20T12:00:00Z");
const USER = "00000000-0000-4000-8000-0000000000a1";
const SAVE = "00000000-0000-4000-8000-0000000000a2";

let mail: ReturnType<typeof makeMailer>;
let calls: ReturnType<typeof makeFakeDb>["calls"];

beforeEach(() => {
  const db = makeFakeDb((call) => {
    if (call.table === "feature_flags") return { data: { enabled: call.filters.some(([, , v]) => v === "scholarship_deadline_alert") } };
    if (call.table === "scholarship_saves" && call.op === "select") {
      return {
        data: [
          {
            id: SAVE,
            user_id: USER,
            status: "saved",
            deadline_reminder_sent_at: null,
            scholarship_id: "sch-1",
            scholarships: {
              id: "sch-1",
              program_name: "Example Fellowship",
              provider: "Example Foundation",
              application_deadline: "2026-11-23",
              close_time: null,
              close_tz: null,
              deadline_verified_at: "2026-11-01T00:00:00Z",
              official_url: "https://example.test/apply",
              moderation_status: "verified",
            },
            profiles: { email: "seeker@example.test", first_name: "Ada" },
          },
        ],
      };
    }
    if (call.table === "email_preferences") return { data: [{ user_id: USER, unsubscribe_token: "tok-sch", scholarship_deadline_alert: true }] };
    return undefined;
  });
  calls = db.calls;
  mail = makeMailer();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(serviceRole, "createServiceRoleClient").mockReturnValue(db.client as never);
  vi.spyOn(resendClient, "getResendClient").mockReturnValue(mail.resend as never);
});
afterEach(() => vi.restoreAllMocks());

describe("the scholarship deadline alert, sent", () => {
  it("one reminder, stamped, carrying the one-click pair for its own kind", async () => {
    const summary = await sendScholarshipDeadlineAlerts(NOW);
    expect(summary).toMatchObject({ enabled: true, considered: 1, sent: 1, failed: 0 });
    expect(mail.sent).toHaveLength(1);
    const payload = mail.sent[0] as unknown as { headers?: Record<string, string>; html: string; text: string };
    expect(payload.headers).toEqual(unsubscribeHeaders("tok-sch", "scholarship_deadline_alert"));
    expect(writesTo(calls, "scholarship_saves")).toHaveLength(1);
  });

  it("its body still links the confirm page, never the one-click endpoint", async () => {
    await sendScholarshipDeadlineAlerts(NOW);
    const payload = mail.sent[0] as unknown as { html: string; text: string };
    expect(payload.text).toContain(absoluteUrl("/unsubscribe?token=tok-sch&pref=scholarship_deadline_alert"));
    expect(payload.text).not.toContain("/api/unsubscribe");
    expect(payload.html).not.toContain("/api/unsubscribe");
  });
});
