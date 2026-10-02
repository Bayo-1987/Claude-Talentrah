/**
 * send-508 / S3-21a — every place that decides "is this scholarship open?" asks the one definition, and gets the boundary minute right.
 *
 * "Open" was decided nine ways against a bare date (`>= today` with today = the server's UTC date). Each site below is run against an
 * in-memory scholarships table (tests/support/fake-scholarship-db.ts evaluates the real PostgREST filters) with one row placed ON the closing
 * instant of each of four cases (UTC, Lagos, Toronto, no zone): open one minute before, closed AT the instant. The clock is faked, so the
 * minute is exact.
 *
 * Sites covered here: the landing-page loaders (fully-funded, by degree level, the signed-out preview: all three read stillOpenFilter), the
 * sitemap's landing-page counts, the landing-page facet RPC caller, the list page's "closing within N days" window and its due-soon
 * query, the deadline-alert selection and its email wording, and the display helpers (card, detail, rows, landing, blog embed).
 * NOT changed, deliberately: ingest's auto-publish (`> today` is a human-review gate that must not depend on the time of day) and
 * markExpiredCycles (a grace-window sweep of N days); both are pinned by tests/scholarships/auto-publish.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeClient, scholarship, type FakeScholarship } from "../support/fake-scholarship-db";

interface Case {
  name: string;
  deadline: string;
  time: string | null;
  tz: string | null;
  /** The closing instant, UTC. */
  closes: string;
}
const CASES: Case[] = [
  { name: "UTC", deadline: "2026-10-06", time: "09:30", tz: "UTC", closes: "2026-10-06T09:30:00.000Z" },
  { name: "Lagos", deadline: "2026-10-06", time: "17:00", tz: "Africa/Lagos", closes: "2026-10-06T16:00:00.000Z" },
  { name: "Toronto", deadline: "2026-10-06", time: "17:00", tz: "America/Toronto", closes: "2026-10-06T21:00:00.000Z" },
  { name: "no zone", deadline: "2026-10-06", time: null, tz: null, closes: "2026-10-07T12:00:00.000Z" },
];
const MIN = 60_000;

function row(c: Case, id = `row-${c.name}`): FakeScholarship {
  return scholarship({ id, application_deadline: c.deadline, close_time: c.time, close_tz: c.tz });
}
const at = (c: Case, deltaMs: number) => new Date(Date.parse(c.closes) + deltaMs);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe.each(CASES)("landing-page loaders: $name", (c) => {
  it("fully-funded: listed one minute before the closing instant, gone at it", async () => {
    const { loadFullyFundedScholarships } = await import("@/lib/seo/landing-page-data");
    vi.setSystemTime(at(c, -MIN));
    expect((await loadFullyFundedScholarships(fakeClient([row(c)]) as never)).total, "a minute before").toBe(1);
    vi.setSystemTime(at(c, 0));
    expect((await loadFullyFundedScholarships(fakeClient([row(c)]) as never)).total, "at the instant").toBe(0);
  });

  it("by degree level: the same boundary", async () => {
    const { loadScholarshipsByLevel } = await import("@/lib/seo/landing-page-data");
    vi.setSystemTime(at(c, -MIN));
    expect((await loadScholarshipsByLevel(fakeClient([row(c)]) as never, "msc"))?.total).toBe(1);
    vi.setSystemTime(at(c, 0));
    expect((await loadScholarshipsByLevel(fakeClient([row(c)]) as never, "msc"))?.total).toBe(0);
  });

  it("the signed-out preview ('Open this cycle'): the same boundary", async () => {
    const { loadOpenScholarshipsPreview } = await import("@/lib/seo/landing-page-data");
    vi.setSystemTime(at(c, -MIN));
    expect(await loadOpenScholarshipsPreview(fakeClient([row(c)]) as never)).toHaveLength(1);
    vi.setSystemTime(at(c, 0));
    expect(await loadOpenScholarshipsPreview(fakeClient([row(c)]) as never)).toHaveLength(0);
  });
});

describe("landing pages: a listing with no deadline is always listed, and the loaders still render above the threshold", () => {
  it("no-deadline rows stay open; closed rows leave; the count is what the page gates on", async () => {
    const { loadFullyFundedScholarships } = await import("@/lib/seo/landing-page-data");
    vi.setSystemTime(new Date("2026-10-06T12:00:00Z"));
    const rows = [
      ...Array.from({ length: 5 }, (_, i) => scholarship({ id: `nd-${i}` })),
      scholarship({ id: "future", application_deadline: "2099-01-01" }),
      scholarship({ id: "past", application_deadline: "2020-01-01" }),
    ];
    const r = await loadFullyFundedScholarships(fakeClient(rows) as never);
    expect(r.total).toBe(6);
    expect(r.scholarships.map((s) => s.id)).not.toContain("past");
  });
});

describe("sitemap: the landing-page counts use the same definition", () => {
  it.each(CASES)("$name: counted a minute before the closing instant, not at it", async (c) => {
    vi.resetModules();
    const client = (rows: FakeScholarship[]) => fakeClient(rows);
    let rows: FakeScholarship[] = [row(c)];
    vi.doMock("@/lib/supabase/server", () => ({ createClient: async () => client(rows) }));
    vi.doMock("@/lib/blog/posts", () => ({ getAllPosts: async () => [] }));
    const sitemap = (await import("@/app/sitemap")).default;

    const hasFullyFunded = async () => {
      // the fully-funded page is listed only when its live count clears LANDING_PAGE_MIN_ENTRIES: 5 identical rows
      rows = Array.from({ length: 5 }, (_, i) => ({ ...row(c, `r${i}`) }));
      const entries = await sitemap();
      return entries.some((e) => String(e.url).endsWith("/scholarships/fully-funded"));
    };
    vi.setSystemTime(at(c, -MIN));
    expect(await hasFullyFunded(), "a minute before").toBe(true);
    vi.setSystemTime(at(c, 0));
    expect(await hasFullyFunded(), "at the instant").toBe(false);
    vi.doUnmock("@/lib/supabase/server");
    vi.doUnmock("@/lib/blog/posts");
  });
});

describe("the landing-page facet counts (RPC caller)", () => {
  it("asks the instant-based RPC for the current instant, not the old date one", async () => {
    const { liveScholarshipLandingLinks } = await import("@/lib/seo/landing-page-links");
    vi.setSystemTime(new Date("2026-10-06T09:30:00.000Z"));
    const client = fakeClient([], { fully_funded_count: 9, bsc_count: 0, msc_count: 0, phd_count: 0, postgraduate_diploma_count: 0, other_count: 0 });
    await liveScholarshipLandingLinks(client as never);
    expect(client.calls.rpc).toEqual([{ fn: "scholarship_landing_facet_counts_at", args: { p_now: "2026-10-06T09:30:00.000Z" } }]);
  });
});

describe.each(CASES)("the list page's 'closing within N days' window: $name", (c) => {
  it("includes a row whose instant is ahead, excludes it at the instant", async () => {
    const { applyClosingWithin } = await import("@/lib/scholarships/close-instant");
    const run = (now: Date) => {
      const q = fakeClient([row(c)]).from("scholarships") as { select: (c: string) => unknown };
      const filtered = applyClosingWithin(q.select("*") as never, 30, now) as PromiseLike<{ data: unknown[] }>;
      return Promise.resolve(filtered).then((r) => r.data.length);
    };
    expect(await run(at(c, -MIN)), "a minute before").toBe(1);
    expect(await run(at(c, 0)), "at the instant").toBe(0);
  });

  it("excludes a row further out than N days", async () => {
    const { applyClosingWithin } = await import("@/lib/scholarships/close-instant");
    const q = fakeClient([row(c)]).from("scholarships") as { select: (c: string) => unknown };
    const filtered = applyClosingWithin(q.select("*") as never, 7, new Date(Date.parse(c.closes) - 8 * 86_400_000)) as PromiseLike<{ data: unknown[] }>;
    expect((await filtered).data).toHaveLength(0);
  });
});

describe.each(CASES)("the list page's due-soon (saved scholarships): $name", (c) => {
  it("is selected a minute before the instant, not at it", async () => {
    const { dueSoonScholarships } = await import("@/lib/scholarships/close-instant");
    const rows = [row(c)];
    expect(dueSoonScholarships(rows, 5, at(c, -MIN)).map((r) => r.id)).toEqual([row(c).id]);
    expect(dueSoonScholarships(rows, 5, at(c, 0))).toEqual([]);
  });
});

describe.each(CASES)("deadline-alert selection: $name", (c) => {
  const cand = (over = {}) => ({
    saveId: "s1",
    userId: "u1",
    status: "saved" as const,
    deadlineReminderSentAt: null,
    scholarshipId: "sc1",
    programName: "Prog",
    provider: "Prov",
    applicationDeadline: c.deadline,
    closeTime: c.time,
    closeTz: c.tz,
    deadlineVerifiedAt: "2026-09-01T00:00:00Z",
    officialUrl: "https://example.org",
    moderationStatus: "verified" as const,
    ...over,
  });

  it("alerts a minute before the closing instant, not at it or after", async () => {
    const { selectDeadlineAlertCandidates } = await import("@/lib/scholarship-deadline-alerts/select");
    expect(selectDeadlineAlertCandidates([cand()], at(c, -MIN))).toHaveLength(1);
    expect(selectDeadlineAlertCandidates([cand()], at(c, 0))).toHaveLength(0);
    expect(selectDeadlineAlertCandidates([cand()], at(c, MIN))).toHaveLength(0);
  });

  it("the 5-day window is measured to the instant", async () => {
    const { selectDeadlineAlertCandidates, SCHOLARSHIP_DEADLINE_REMINDER_DAYS: D } = await import("@/lib/scholarship-deadline-alerts/select");
    const edge = Date.parse(c.closes) - (D + 1) * 86_400_000;
    expect(selectDeadlineAlertCandidates([cand()], new Date(edge - MIN)), "more than 5 days out").toHaveLength(0);
    expect(selectDeadlineAlertCandidates([cand()], new Date(edge + MIN)), "just inside 5 days").toHaveLength(1);
  });
});

describe("deadline-alert email wording", () => {
  it("names the time and zone when known, and the apply-a-day-early caution when not", async () => {
    const { buildScholarshipDeadlineEmail } = await import("@/lib/scholarship-deadline-alerts/template");
    const base = {
      saveId: "s", userId: "u", status: "saved" as const, deadlineReminderSentAt: null, scholarshipId: "sc", programName: "Prog", provider: "Prov",
      deadlineVerifiedAt: "x", officialUrl: "https://e.org", moderationStatus: "verified" as const,
    };
    const known = buildScholarshipDeadlineEmail({
      firstName: "Ada", daysOut: 1, unsubscribeToken: "t",
      candidate: { ...base, applicationDeadline: "2026-10-06", closeTime: "13:00", closeTz: "America/Vancouver" },
    });
    expect(known.text).toContain("6 Oct 2026, 13:00 (Pacific time)");
    const unknown = buildScholarshipDeadlineEmail({
      firstName: "Ada", daysOut: 1, unsubscribeToken: "t",
      candidate: { ...base, applicationDeadline: "2026-10-06", closeTime: null, closeTz: null },
    });
    expect(unknown.text).toContain("time zone not stated, apply a day early");
  });
});

describe.each(CASES)("display helpers: $name", (c) => {
  it("scholarshipDaysLeft/closed state flip at the instant (card, detail page, rows, landing, blog embed all read it)", async () => {
    const { scholarshipDaysLeft } = await import("@/lib/scholarships/close-instant");
    const r = { application_deadline: c.deadline, close_time: c.time, close_tz: c.tz };
    expect(scholarshipDaysLeft(r, at(c, -MIN))).toBe(0);
    expect(scholarshipDaysLeft(r, at(c, 0))! < 0).toBe(true);
  });
});

describe("no call site decides 'open' from a bare date any more", () => {
  it("the sitemap, the landing loaders and the list page no longer compare application_deadline to today", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const read = (p: string) => readFileSync(join(__dirname, "../..", p), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const p of ["src/app/sitemap.ts", "src/lib/seo/landing-page-data.ts", "src/app/(app)/scholarships/(list)/page.tsx", "src/lib/seo/landing-page-links.ts"]) {
      const src = read(p);
      expect(src, `${p} still compares application_deadline to a date`).not.toMatch(/application_deadline\.gte\./);
      expect(src, p).not.toMatch(/\.gte\(\s*["']application_deadline["']/);
      expect(src, p).not.toMatch(/scholarship_landing_facet_counts["'],\s*\{\s*p_today/);
    }
  });
});
