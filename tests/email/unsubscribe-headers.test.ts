/**
 * UNSUB-GET-SCANNER-1, part B: every email that carries an unsubscribe link also carries the one-click header pair (RFC 8058), built in ONE place (src/lib/email/unsubscribe.ts) for all six kinds: the weekly
 * digest, the proactive match alert, the scholarship deadline alert, the win-back email, and the admin announcements and promotions.
 *
 * Which URL each header carries: `List-Unsubscribe: <ORIGIN/api/unsubscribe?token=..&pref=..>`, the endpoint that accepts the one-click POST (a GET there changes nothing). The visible link in the body is
 * NOT changed: it is still `ORIGIN/unsubscribe?token=..&pref=..`, which lands on the confirm page. Bodies are not touched; only header lines are added or re-pointed.
 *
 * No hand-written module factory: modules are replaced with vi.spyOn on the real exports.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { absoluteUrl } from "@/lib/seo/site";
import * as serviceRole from "@/lib/supabase/service-role";
import * as resendClient from "@/lib/resend/client";
import * as score from "@/lib/matching/score";
import { buildMassEmail } from "@/lib/email/mass-send";
import { oneClickUnsubscribeUrl, unsubscribeHeaders } from "@/lib/email/unsubscribe";
import { handleOneClickUnsubscribe } from "@/app/unsubscribe/one-click";
import type { UnsubscribablePreference } from "@/app/unsubscribe/preference";
import { sendProactiveMatchAlerts } from "@/lib/notifications/proactive-match-alert/send";
import { makeFakeDb, makeMailer } from "../notifications/u5-support";

const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
afterEach(() => {
  vi.restoreAllMocks();
  rpcCalls.length = 0;
});

const KINDS: UnsubscribablePreference[] = ["job_match_digest", "proactive_match_alert", "scholarship_deadline_alert", "win_back_email", "announcements", "promotions"];

describe("the header helper", () => {
  it.each(KINDS)("%s: the pair is exactly List-Unsubscribe and List-Unsubscribe-Post, and the URL is the one-click endpoint with the token and the kind", (kind) => {
    const h = unsubscribeHeaders("tok-1", kind);
    expect(Object.keys(h).sort()).toEqual(["List-Unsubscribe", "List-Unsubscribe-Post"]);
    expect(h["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(h["List-Unsubscribe"]).toBe(`<${absoluteUrl(`/api/unsubscribe?token=tok-1&pref=${kind}`)}>`);
  });

  it("the token is url-encoded, and the URL is not the confirm page", () => {
    expect(oneClickUnsubscribeUrl("a b+c&d", "promotions")).toBe(absoluteUrl("/api/unsubscribe?token=a%20b%2Bc%26d&pref=promotions"));
    expect(new URL(oneClickUnsubscribeUrl("t", "announcements")).pathname).toBe("/api/unsubscribe");
  });

  it("an empty token cannot make a header (a header that unsubscribes nobody is worse than none)", () => {
    expect(() => unsubscribeHeaders("", "promotions")).toThrow();
  });
});

describe("the header points at the endpoint that accepts the one-click POST, and a GET there changes nothing", () => {
  beforeEach(() => {
    vi.spyOn(serviceRole, "createServiceRoleClient").mockReturnValue({
      rpc: async (name: string, args: Record<string, unknown>) => {
        rpcCalls.push({ name, args });
        return { data: [{ matched: true }], error: null };
      },
    } as never);
  });

  it.each(KINDS)("%s: a mail client POSTing the header's own URL with the header's own body unsubscribes once", async (kind) => {
    const h = unsubscribeHeaders("tok-rt", kind);
    const url = h["List-Unsubscribe"].slice(1, -1);
    const res = await handleOneClickUnsubscribe(new Request(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: h["List-Unsubscribe-Post"] }));
    expect(res.status).toBe(200);
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].args.p_token).toBe("tok-rt");
  });

  it("a GET of the header's URL (a link scanner) changes nothing", async () => {
    const url = unsubscribeHeaders("tok-rt", "promotions")["List-Unsubscribe"].slice(1, -1);
    const res = await handleOneClickUnsubscribe(new Request(url, { method: "GET" }));
    expect(res.status).toBe(405);
    expect(rpcCalls).toEqual([]);
  });
});

describe("admin mail: both streams carry the pair, and the body is untouched", () => {
  const base = { identity: { from: "Talentrah <announce@mail.example.test>", replyTo: null }, to: "zq7.one@example.test", subject: "S", body: "Hello.\n\nSecond paragraph.", linkPath: null, firstName: "Ada" };
  it.each(["announcements", "promotions"] as const)("%s: headers equal the helper's, the visible link is still the confirm page", (stream) => {
    const e = buildMassEmail({ ...base, stream, unsubscribeToken: "tok-m", consentLine: stream === "promotions" ? "You opted in." : null });
    expect(e.headers).toEqual(unsubscribeHeaders("tok-m", stream));
    const confirmLink = absoluteUrl(`/unsubscribe?token=tok-m&pref=${stream}`);
    expect(e.text).toContain(confirmLink);
    expect(e.html).toContain(confirmLink.replace(/&/g, "&amp;"));
    expect(e.text).not.toContain("/api/unsubscribe");
    expect(e.html).not.toContain("/api/unsubscribe");
  });
});

describe("the proactive match alert, which had no headers at all, now carries the pair", () => {
  it("one alert is sent with the pair for its own kind, and its body links the confirm page", async () => {
    const USER = "00000000-0000-4000-8000-0000000000f1";
    const JOB = "00000000-0000-4000-8000-0000000000f2";
    const db = makeFakeDb((call) => {
      if (call.table === "feature_flags") return { data: { enabled: call.filters.some(([, , v]) => v === "proactive_match_alert") } };
      if (call.table === "job_postings") return { data: [{ id: JOB, title: "Role X", company_name: "Company Y", location: null, posted_at: "2026-11-14T10:00:00Z", status: "open", organization_id: null, unlisted_at: null }] };
      if (call.table === "email_preferences") return { data: [{ user_id: USER, unsubscribe_token: "tok-pa", profiles: { email: "seeker@example.test", first_name: "Ada", last_active_at: "2026-01-01T00:00:00Z" } }] };
      if (call.table === "resumes" && call.columns === "user_id") return { data: [{ user_id: USER }] };
      if (call.table === "resumes") return { data: { structured_content: { skills: [] } } };
      if (call.table === "proactive_match_alerts" && call.op === "select") return { data: [] };
      return undefined;
    });
    const mail = makeMailer();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(serviceRole, "createServiceRoleClient").mockReturnValue(db.client as never);
    vi.spyOn(resendClient, "getResendClient").mockReturnValue(mail.resend as never);
    vi.spyOn(score, "computeMatchScore").mockReturnValue({ score: 90, explanation: { matchedSkills: ["a", "b", "c", "d"], missingSkills: [] } } as never);

    const summary = await sendProactiveMatchAlerts("2026-11-14T00:00:00Z", new Date("2026-11-14T12:00:00Z"));
    expect(summary).toMatchObject({ enabled: true, sent: 1, failed: 0 });
    expect(mail.sent).toHaveLength(1);
    const payload = mail.sent[0] as unknown as { headers?: Record<string, string>; html: string; text: string };
    expect(payload.headers).toEqual(unsubscribeHeaders("tok-pa", "proactive_match_alert"));
    expect(payload.text).toContain(absoluteUrl("/unsubscribe?token=tok-pa&pref=proactive_match_alert"));
    expect(payload.text).not.toContain("/api/unsubscribe");
  });
});

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}
const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

describe("one place, six senders", () => {
  it("no source file spells the header names except the helper and the one-click route, which reads the form field of the POST body (a hand-built header is how the URLs drift apart)", () => {
    const offenders = walk(join(process.cwd(), "src")).filter((f) => /["'`]List-Unsubscribe(-Post)?["'`]/.test(readFileSync(f, "utf8"))).map((f) => f.slice(process.cwd().length + 1));
    expect(offenders).toEqual(["src/app/unsubscribe/one-click.ts", "src/lib/email/unsubscribe.ts"]);
  });

  it.each([
    ["src/lib/digest/send.ts", "job_match_digest"],
    ["src/lib/notifications/win-back/send.ts", "win_back_email"],
    ["src/lib/scholarship-deadline-alerts/send.ts", "scholarship_deadline_alert"],
    ["src/lib/notifications/proactive-match-alert/send.ts", "proactive_match_alert"],
  ])("%s sends unsubscribeHeaders(<token>, %s)", (file, kind) => {
    const src = read(file);
    expect(src).toMatch(new RegExp(`headers:\\s*unsubscribeHeaders\\([^)]*,\\s*"${kind}"\\s*\\)`));
    expect(src).not.toMatch(/function unsubscribeUrlFor/);
  });

  it("the mass-send builder takes its headers from the helper for both streams", () => {
    expect(read("src/lib/email/mass-send.ts")).toMatch(/headers(?::[^=]+)?=\s*unsubscribeHeaders\(\s*input\.unsubscribeToken\s*,\s*input\.stream\s*\)/);
  });
});
