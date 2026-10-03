/**
 * #594: a deadline note over 600 characters is refused by the database (migration 0217), and the nightly ingest writes listings in batches, so one
 * over-length note in the source config would fail every other listing in its batch. Catch it here, when the config is edited, not at 07:00 UTC.
 */
import { describe, expect, it } from "vitest";
import { DEADLINE_NOTE_MAX_LENGTH } from "@/lib/scholarships/public-deadline-note";
import { SEED_SCHOLARSHIPS } from "@/lib/scholarships/sources.config";

describe("source-config deadline notes", () => {
  it("there are notes to check (the test is not vacuous)", () => {
    expect(SEED_SCHOLARSHIPS.filter((s) => s.deadlineNote).length).toBeGreaterThan(5);
  });

  it.each(SEED_SCHOLARSHIPS.filter((s) => s.deadlineNote).map((s) => [s.programName, s.deadlineNote as string]))(
    "%s: a note fits the limit",
    (_name, note) => {
      expect(note.length).toBeLessThanOrEqual(DEADLINE_NOTE_MAX_LENGTH);
    },
  );

  it("a configured note always comes with a verified-deadline stamp, the other half of the database rule", () => {
    const unstamped = SEED_SCHOLARSHIPS.filter((s) => s.deadlineNote && !s.deadlineVerifiedAt).map((s) => s.programName);
    expect(unstamped).toEqual([]);
  });
});
