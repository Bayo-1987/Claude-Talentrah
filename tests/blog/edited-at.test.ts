/**
 * The rule that decides whether a blog post claims a modification date.
 *
 * One comparison, and the reason it is a named export with its own test file
 * is that getting it wrong is completely silent: `dateModified` is a
 * recommended property, an incorrect one produces no error anywhere, and the
 * only symptom is Google being fed a freshness signal the content does not
 * support.
 *
 * The specific bug this pins is real and was measured, not imagined. All four
 * posts 0074 migrated out of MDX carry `updated_at == created_at ==
 * 2026-08-31 11:52:50` on production — the moment the migration ran. Passing
 * the column through would have dated all four to the day their storage
 * changed.
 */
import { describe, expect, it } from "vitest";
import { editedAt } from "@/lib/blog/posts";

const MIGRATED = "2026-08-31T11:52:50.595698+00:00";

describe("editedAt", () => {
  it("is null when the row has never been touched since insert", () => {
    // The exact shape of all four migrated posts.
    expect(editedAt({ created_at: MIGRATED, updated_at: MIGRATED })).toBeNull();
  });

  it("is the timestamp once something has edited the row", () => {
    const later = "2026-09-15T10:30:00.000000+00:00";
    expect(editedAt({ created_at: MIGRATED, updated_at: later })).toBe(later);
  });

  it("does not treat a same-day edit as no edit", () => {
    // Guards a plausible "compare the dates" simplification: an edit hours
    // after publishing is still an edit.
    const sameDay = "2026-08-31T18:04:11.000000+00:00";
    expect(editedAt({ created_at: MIGRATED, updated_at: sameDay })).toBe(sameDay);
  });
});
