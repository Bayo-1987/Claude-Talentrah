/**
 * Default and renamed resume titles.
 *
 * No database: this is the string logic the "two resumes both called Clean
 * Professional" defect lived in, and pinning it here means the DB-backed
 * suite only has to prove the action USES it.
 */
import { describe, expect, it } from "vitest";
import {
  MAX_RESUME_TITLE_LENGTH,
  defaultBuilderResumeTitle,
  normalizeResumeTitle,
} from "@/lib/resume-builder/resume-title";

describe("defaultBuilderResumeTitle", () => {
  // A fixed date, so this asserts the exact string rather than reconstructing
  // today's and hoping the two agree.
  const sep4 = new Date(2026, 8, 4, 12, 0, 0);

  it("is the template name plus a short date", () => {
    expect(defaultBuilderResumeTitle("Clean Professional", sep4)).toBe("Clean Professional — Sep 4");
  });

  it("distinguishes repeats across days, which is the whole point", () => {
    const sep2 = new Date(2026, 8, 2, 12, 0, 0);
    expect(defaultBuilderResumeTitle("Clean Professional", sep2)).not.toBe(
      defaultBuilderResumeTitle("Clean Professional", sep4),
    );
  });

  it("does not exceed the length the list can render", () => {
    const long = "A".repeat(200);
    expect(defaultBuilderResumeTitle(long, sep4).length).toBeLessThanOrEqual(
      MAX_RESUME_TITLE_LENGTH,
    );
  });
});

describe("normalizeResumeTitle", () => {
  it("collapses the whitespace a paste carries in", () => {
    expect(normalizeResumeTitle("  Senior\n  Backend   Resume ")).toBe("Senior Backend Resume");
  });

  it("returns null for anything blank, so the caller refuses instead of storing an unnameable row", () => {
    // `resumes.title` is `not null` with a default, so "" would be accepted by
    // the database and leave a row with nothing to click on in the list.
    expect(normalizeResumeTitle("")).toBeNull();
    expect(normalizeResumeTitle("   \n\t ")).toBeNull();
  });

  it("truncates rather than rejecting an over-long name", () => {
    const out = normalizeResumeTitle("B".repeat(500));
    expect(out).not.toBeNull();
    expect(out!.length).toBe(MAX_RESUME_TITLE_LENGTH);
  });
});
