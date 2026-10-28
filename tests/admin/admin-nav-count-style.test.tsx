import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * CHARACTERISATION of the admin nav's count chips (ADMIN-NAV-SIGNUPS-COUNT-1, written FIRST and green on the unchanged nav).
 *
 * The nav draws a number beside each queue link: a dark pill ("alert") above 0, and plain quiet digits at 0. A new count is about to reuse the quiet look, so the two class lists are moved into shared constants; this pins the exact class
 * output of both before and after, so the move cannot change what the existing items render. The strings below are the ones the nav rendered before the move.
 */
const state = vi.hoisted(() => ({ counts: {} as Record<string, number> }));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/admin/moderation/queues", () => ({ queueCounts: async () => state.counts }));
// Anything else the nav may reach for must not touch a database in this file.
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({}) }));

const { AdminNav } = await import("@/components/admin/admin-nav");

const ZERO = { scholarships: 0, reports: 0, campaigns: 0, feedback: 0, courses: 0, ops: 0, finance: 0, employerVerification: 0, jobReview: 0, mentorReview: 0 };

const QUIET_CLASS = "min-w-6 px-1.5 py-0.5 text-center font-body text-[12px] font-bold bg-transparent text-ink-soft";
const ALERT_CLASS = "min-w-6 px-1.5 py-0.5 text-center font-body text-[12px] font-bold bg-ink text-paper";

async function chips(counts: Record<string, number>, permissions: string[]) {
  state.counts = counts;
  const html = renderToStaticMarkup(await AdminNav({ permissions: permissions as never }));
  // [label, class, number] for every queue link's count chip
  return [...html.matchAll(/<a [^>]*>([^<]*)<span class="([^"]*)">(\d+)<\/span><\/a>/g)].map((m) => ({ label: m[1], className: m[2], text: m[3] }));
}

describe("the nav's queue count chips (the existing look, pinned)", () => {
  it("a zero count is the quiet look: plain digits, transparent background", async () => {
    const out = await chips(ZERO, ["scholarships", "reported_postings", "operations"]);
    expect(out.map((c) => c.label)).toEqual(["Scholarships", "Reported postings", "Operations"]);
    for (const c of out) {
      expect(c.className).toBe(QUIET_CLASS);
      expect(c.text).toBe("0");
    }
  });

  it("a count above zero is the dark pill", async () => {
    const out = await chips({ ...ZERO, scholarships: 3, ops: 12 }, ["scholarships", "reported_postings", "operations"]);
    const byLabel = Object.fromEntries(out.map((c) => [c.label, c]));
    expect(byLabel["Scholarships"].className).toBe(ALERT_CLASS);
    expect(byLabel["Scholarships"].text).toBe("3");
    expect(byLabel["Operations"].className).toBe(ALERT_CLASS);
    expect(byLabel["Operations"].text).toBe("12");
    expect(byLabel["Reported postings"].className).toBe(QUIET_CLASS);
  });

  it("the whole queue list renders in this order for a full set of permissions, with these labels", async () => {
    const all = ["scholarships", "reported_postings", "ad_campaigns", "feedback", "courses", "operations", "finance", "employer_verification", "job_review", "mentor_review"];
    const out = await chips(ZERO, all);
    expect(out.map((c) => c.label)).toEqual(["Scholarships", "Reported postings", "Ad campaigns", "Feedback", "Courses", "Operations", "Finance", "Employer verification", "Job review", "Mentor applications"]);
    expect(new Set(out.map((c) => c.className))).toEqual(new Set([QUIET_CLASS]));
  });
});
