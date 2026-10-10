/**
 * Does a second ingest of an UNCHANGED source send an approved listing back to review? (Chevening, 8 and 9 Oct.)
 *
 * The daily ingest is: the curated catalog (sources.config.ts) -> the deadline recheck (recheck.ts, reads the official page) -> upsertScholarships (compares 17 content columns with the stored row; a
 * verified row whose content moved goes back to pending). Two things are simulated here with the REAL recheck and the REAL upsert and an in-memory table that keeps each day's write:
 *
 *  1. A provider moves a date and the catalog still has the old one (the situation Chevening was in on 8 Oct). Day 1 MUST return the listing to review (the date really moved, a human must look).
 *     A person approves it. Day 2: the page says the same thing, the catalog still says the old date, nothing about the listing changed. It must NOT come back, and it did: recheck.ts stamps
 *     deadline_verified_at with the current time every time it re-applies the page's date, so the stamp differs every morning and (being a content column) sends the approved listing back every morning
 *     until a developer edits the catalog. Only Chevening was affected on 8-9 Oct because it is the one listing whose date moved, but it is every recheck target's behaviour the next time one moves.
 *  2. Nothing is stale: catalog == page == stored. Never returned. (The case #848 put Chevening in; the 9 Oct return was the one-time arrival of its deadline note from that catalog change.)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NormalizedScholarship } from "@/lib/scholarships/types";

type Row = Record<string, unknown>;
let table = new Map<string, Row>();
let lastWrite: Row[] = [];

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    from: () => ({
      select: () => ({ in: (_col: string, fingerprints: string[]) => Promise.resolve({ data: fingerprints.map((f) => table.get(f)).filter(Boolean), error: null }) }),
      upsert: (rows: Row[]) => {
        lastWrite = rows;
        for (const r of rows) {
          const fp = r.dedup_fingerprint as string;
          // Postgres hands a timestamptz back as '2026-10-08 07:09:06.68+00', not the ISO text we sent.
          const merged: Row = { ...(table.get(fp) ?? {}), ...r };
          if (typeof merged.deadline_verified_at === "string") merged.deadline_verified_at = String(merged.deadline_verified_at).replace("T", " ").replace("Z", "+00");
          table.set(fp, merged);
        }
        return Promise.resolve({ error: null, count: rows.length });
      },
    }),
  }),
}));

const { upsertScholarships } = await import("@/lib/scholarships/ingest");
const { recheckDeadlines } = await import("@/lib/scholarships/recheck");
const { computeScholarshipFingerprint } = await import("@/lib/scholarships/dedup");

/** The catalog entry as a developer last wrote it: the OLD date, a stamp from the day it was checked by hand. */
const CATALOG: NormalizedScholarship = {
  provider: "UK Foreign, Commonwealth & Development Office",
  programName: "Chevening Scholarships",
  hostInstitution: "UK universities",
  degreeLevels: ["msc"],
  fieldTags: ["Any field"],
  fundingType: "full",
  fundingCovers: ["tuition", "stipend", "travel"],
  eligibilityNationalities: ["Nigeria"],
  eligibilityPriorDegree: "An undergraduate degree",
  eligibilityAge: null,
  eligibilityOther: null,
  applicationDeadline: "2026-10-06",
  cycleYear: 2027,
  officialUrl: "https://www.chevening.org/apply/",
  sourceName: "Chevening official site",
  deadlineVerifiedAt: "2026-09-01T06:30:00.000Z",
  deadlineNote: null,
  reviewNote: null,
};
const FP = computeScholarshipFingerprint(CATALOG.provider, CATALOG.programName, CATALOG.cycleYear);
const PAGE = "<p>Applications close for some countries on 20 October 2026, at 11:00 (UTC).</p>";

/** One morning's ingest of `catalog`, with the official page saying `page`, at `at`. */
async function ingestOn(at: string, catalog: NormalizedScholarship, page: string) {
  vi.setSystemTime(new Date(at));
  vi.stubGlobal("fetch", async () => new Response(page, { status: 200 }));
  const rechecked = await recheckDeadlines([catalog], at.slice(0, 10));
  return upsertScholarships(rechecked.listings, { autoPublishMachineVerified: true });
}
const approve = () => {
  const row = table.get(FP)!;
  table.set(FP, { ...row, moderation_status: "verified" });
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  table = new Map();
  lastWrite = [];
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("a provider moves a date and the catalog still has the old one", () => {
  it("day 1: the listing goes back to review (the date really moved)", async () => {
    await ingestOn("2026-10-01T07:00:00.000Z", CATALOG, "<p>Applications close on 6 October 2026, at 11:00 (UTC).</p>");
    approve();
    const day1 = await ingestOn("2026-10-08T07:00:00.000Z", CATALOG, PAGE);
    expect(day1.returnedToReview).toEqual([FP]);
    expect(String(lastWrite[0].moderation_note)).toContain("application_deadline");
  });

  it("day 2, nothing changed since the owner approved it: it stays approved", async () => {
    await ingestOn("2026-10-01T07:00:00.000Z", CATALOG, "<p>Applications close on 6 October 2026, at 11:00 (UTC).</p>");
    approve();
    await ingestOn("2026-10-08T07:00:00.000Z", CATALOG, PAGE);
    approve(); // the owner's approval, 9:05
    const day2 = await ingestOn("2026-10-09T07:00:00.000Z", CATALOG, PAGE);
    expect(day2.returnedToReview, "approved on day 1, page and catalog unchanged on day 2: it must not come back").toEqual([]);
    expect(lastWrite[0]).not.toHaveProperty("moderation_status");
  });

  it("the reason it used to come back is the stamp alone: the date is the same as the stored one and recheck.ts gives it a fresh deadline_verified_at every run", async () => {
    await ingestOn("2026-10-01T07:00:00.000Z", CATALOG, "<p>Applications close on 6 October 2026, at 11:00 (UTC).</p>");
    approve();
    await ingestOn("2026-10-08T07:00:00.000Z", CATALOG, PAGE);
    approve();
    await ingestOn("2026-10-09T07:00:00.000Z", CATALOG, PAGE);
    const note = String(lastWrite[0].moderation_note ?? "");
    expect(note).not.toMatch(/Returned for review/);
  });

  it("approve, then run the ingest twice with unchanged source data: it stays published (the owner's acceptance test)", async () => {
    await ingestOn("2026-10-01T07:00:00.000Z", CATALOG, "<p>Applications close on 6 October 2026, at 11:00 (UTC).</p>");
    approve();
    await ingestOn("2026-10-08T07:00:00.000Z", CATALOG, PAGE);
    approve(); // the date really moved on 8 Oct and a person approved it; from here the source does not change
    const first = await ingestOn("2026-10-09T07:00:00.000Z", CATALOG, PAGE);
    const second = await ingestOn("2026-10-10T07:00:00.000Z", CATALOG, PAGE);
    expect([first.returnedToReview, second.returnedToReview]).toEqual([[], []]);
    expect(table.get(FP)!.moderation_status).toBe("verified");
  });

  it("day 3 and day 4 the same (it does not come back on any later morning either)", async () => {
    await ingestOn("2026-10-01T07:00:00.000Z", CATALOG, "<p>Applications close on 6 October 2026, at 11:00 (UTC).</p>");
    approve();
    await ingestOn("2026-10-08T07:00:00.000Z", CATALOG, PAGE);
    approve();
    for (const day of ["2026-10-09", "2026-10-10", "2026-10-11"]) {
      expect((await ingestOn(`${day}T07:00:00.000Z`, CATALOG, PAGE)).returnedToReview, day).toEqual([]);
    }
  });

  it("control: a SECOND real move (the page now says 25 October) still returns it", async () => {
    await ingestOn("2026-10-01T07:00:00.000Z", CATALOG, "<p>Applications close on 6 October 2026, at 11:00 (UTC).</p>");
    approve();
    await ingestOn("2026-10-08T07:00:00.000Z", CATALOG, PAGE);
    approve();
    const moved = await ingestOn("2026-10-09T07:00:00.000Z", CATALOG, "<p>Applications close for some countries on 25 October 2026, at 11:00 (UTC).</p>");
    expect(moved.returnedToReview).toEqual([FP]);
  });
});

describe("nothing is stale: catalog, page and stored row agree", () => {
  it("never returned, morning after morning", async () => {
    const current = { ...CATALOG, applicationDeadline: "2026-10-20" };
    await ingestOn("2026-10-01T07:00:00.000Z", current, PAGE);
    approve();
    for (const day of ["2026-10-08", "2026-10-09", "2026-10-10"]) {
      expect((await ingestOn(`${day}T07:00:00.000Z`, current, PAGE)).returnedToReview, day).toEqual([]);
    }
  });
});

describe("Chevening's week, replayed with the real code (7, 8 and 9 Oct)", () => {
  /** The catalog after #848 (8 Oct 11:25Z): the page's date, the stamp the live row held, the owner's note. */
  const AFTER_848: NormalizedScholarship = {
    ...CATALOG,
    applicationDeadline: "2026-10-20",
    deadlineVerifiedAt: "2026-10-08T07:09:06.680Z",
    deadlineNote: "Deadline varies by country. Nigeria, India and Pakistan closed 6 Oct 2026; others close 20 Oct 2026, 11:00 UTC",
  };
  const note = () => String(lastWrite[0].moderation_note ?? "");

  it("7 Oct: the date moved (returned, correctly); 8 Oct: only the re-stamp (NOT returned; this was the daily churn); 9 Oct: only the note arrives with #848 (returned once); then quiet", async () => {
    await ingestOn("2026-10-05T07:00:00.000Z", CATALOG, "<p>Applications close on 6 October 2026, at 11:00 (UTC).</p>");
    approve();

    const oct7 = await ingestOn("2026-10-07T07:00:00.000Z", CATALOG, PAGE);
    expect(oct7.returnedToReview, "7 Oct: the page's only future date is now 20 Oct").toEqual([FP]);
    expect(note()).toContain("application_deadline");
    approve(); // the owner, 7 Oct 13:13Z

    const oct8 = await ingestOn("2026-10-08T07:09:06.680Z", CATALOG, PAGE);
    expect(oct8.returnedToReview, "8 Oct: same date as the stored one, only a fresh stamp").toEqual([]);
    // (Before this change 8 Oct returned it, with "Returned for review: deadline_verified_at changed" as the whole reason.)

    const oct9 = await ingestOn("2026-10-09T07:00:00.000Z", AFTER_848, PAGE);
    expect(oct9.returnedToReview, "9 Oct: #848 put the deadline note in the catalog, the live row had none").toEqual([FP]);
    expect(note()).toMatch(/Returned for review: deadline_note changed after verification\./);
    approve(); // the owner, 9 Oct 08:57Z

    for (const day of ["2026-10-10", "2026-10-11", "2026-10-12"]) {
      expect((await ingestOn(`${day}T07:00:00.000Z`, AFTER_848, PAGE)).returnedToReview, day).toEqual([]);
    }
  });
});
