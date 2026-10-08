/**
 * Chevening's catalog entry (DRAFT, not pushed): the daily ingest REWRITES each configured listing from src/lib/scholarships/sources.config.ts, and the daily deadline recheck (recheck.ts)
 * has already moved the live row to the official page's only future date, 20 October 2026, with a fresh deadline_verified_at. A verified listing whose content columns differ from the config
 * goes back to review ("Returned for review"). So the config must carry the SAME three values as the row: applicationDeadline, deadlineVerifiedAt (the stamp the database holds) and deadlineNote.
 * Nigeria, India and Pakistan closed on 6 October 2026; other countries close on 20 October 2026 at 11:00 UTC (owner, 8 Oct).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { SEED_SCHOLARSHIPS } from "@/lib/scholarships/sources.config";
import { changedColumns, CONTENT_COLUMNS, scholarshipRow } from "@/lib/scholarships/ingest";
import { computeScholarshipFingerprint } from "@/lib/scholarships/dedup";
import { recheckDeadlines } from "@/lib/scholarships/recheck";
import { DEADLINE_NOTE_MAX_LENGTH } from "@/lib/scholarships/public-deadline-note";

/** The text the config carries until S3-21's dry run supplies the stamp the database holds. While the config still says this, the test below fails on purpose. */
const STAMP_PLACEHOLDER = "REPLACE_WITH_DB_STAMP";
const NOTE = "Deadline varies by country. Nigeria, India and Pakistan closed 6 Oct 2026; others close 20 Oct 2026, 11:00 UTC";

const entry = SEED_SCHOLARSHIPS.find((s) => s.programName === "Chevening Scholarships")!;
const fingerprint = computeScholarshipFingerprint(entry.provider, entry.programName, entry.cycleYear);

afterEach(() => vi.unstubAllGlobals());

describe("the Chevening config entry", () => {
  it("is the 2027 listing the recheck target and the live row are keyed on (same provider, programme, cycle year => same row)", () => {
    expect(entry).toBeDefined();
    expect(entry.cycleYear).toBe(2027);
    expect(fingerprint).toBe(computeScholarshipFingerprint("UK Foreign, Commonwealth & Development Office", "Chevening Scholarships", 2027));
  });
  it("carries the 20 October 2026 deadline (the official page's only future date) and the owner's note, word for word", () => {
    expect(entry.applicationDeadline).toBe("2026-10-20");
    expect(entry.deadlineNote).toBe(NOTE);
    expect(entry.deadlineNote!.length).toBeLessThanOrEqual(DEADLINE_NOTE_MAX_LENGTH);
  });
  it("a note needs a verified-deadline stamp (0217): the entry has one", () => {
    expect(entry.deadlineVerifiedAt).toBeTruthy();
  });
  it("THE STAMP IS THE REAL ONE, not the placeholder: the exact instant the live row holds (S3-21's dry run, 8 Oct), compared as an instant", () => {
    expect(entry.deadlineVerifiedAt).not.toBe(STAMP_PLACEHOLDER);
    expect(Number.isNaN(Date.parse(entry.deadlineVerifiedAt!)), "the stamp must be an ISO instant").toBe(false);
    expect(Date.parse(entry.deadlineVerifiedAt!)).toBe(Date.parse("2026-10-08T07:09:06.680Z"));
  });
});

describe("the ingest leaves a Chevening row that already matches the config unchanged", () => {
  // What the database holds after the data fix and the recheck: the three values above, every other content column as ingested from the config.
  const stampIso = Number.isNaN(Date.parse(entry.deadlineVerifiedAt ?? "")) ? "2026-10-08T07:00:03.512Z" : entry.deadlineVerifiedAt!;
  const asConfigured = { ...entry, deadlineVerifiedAt: stampIso };
  const row = scholarshipRow(asConfigured, fingerprint, "2026-10-09T07:00:00.000Z");
  /** Postgres hands a timestamptz back as '2026-10-08 07:00:03.512+00', which the ingest compares as an instant. */
  const stored = { ...row, deadline_verified_at: stampIso.replace("T", " ").replace("Z", "+00") } as Record<string, unknown>;

  it("no content column differs (so no 'Returned for review')", () => {
    expect(changedColumns(row as unknown as Record<string, unknown>, stored)).toEqual([]);
  });
  it("control: the OLD config values (6 Oct, no note) DO differ, so the check can fail", () => {
    const old = { ...stored, application_deadline: "2026-10-06", deadline_note: null };
    expect(changedColumns(row as unknown as Record<string, unknown>, old).sort()).toEqual(["application_deadline", "deadline_note"]);
  });
  it("EXPECTED EFFECT of this change against the live row today (deadline and stamp already equal, note not yet written): exactly ONE column differs, deadline_note, so the first ingest after the deploy writes the note and returns the listing to pending for an operator to approve", () => {
    const live = { ...stored, deadline_note: null };
    expect(changedColumns(row as unknown as Record<string, unknown>, live)).toEqual(["deadline_note"]);
  });
  it("every content column is compared (a new column added to the ingest cannot slip past this test)", () => {
    expect(CONTENT_COLUMNS.length).toBeGreaterThanOrEqual(15);
    for (const col of CONTENT_COLUMNS) expect(Object.keys(row), col).toContain(col);
  });
});

describe("the daily recheck sees the official page and our entry agree", () => {
  it("a page whose only future deadline is 20 October 2026 changes nothing and says nothing was moved", async () => {
    vi.stubGlobal("fetch", async () => new Response("<p>Applications close for some countries on 20 October 2026, at 11:00 (UTC).</p>", { status: 200 }));
    const out = await recheckDeadlines([entry], "2026-10-08");
    const after = out.listings.find((l) => l.programName === "Chevening Scholarships")!;
    expect(after.applicationDeadline).toBe("2026-10-20");
    expect(after.deadlineVerifiedAt).toBe(entry.deadlineVerifiedAt);
    expect(after.deadlineNote).toBe(NOTE);
    expect(out.notices.join("\n")).not.toMatch(/Chevening Scholarships deadline moved/);
  });
  it("control: if the config still said 6 Oct, the same page WOULD move it (and re-stamp it, which sends the row to review)", async () => {
    vi.stubGlobal("fetch", async () => new Response("<p>Applications close for some countries on 20 October 2026, at 11:00 (UTC).</p>", { status: 200 }));
    const out = await recheckDeadlines([{ ...entry, applicationDeadline: "2026-10-06" }], "2026-10-08");
    expect(out.notices.join("\n")).toMatch(/Chevening Scholarships deadline moved 2026-10-06 → 2026-10-20/);
  });
});
