/**
 * The comparison behind tests/rls/job-postings-column-grants.test.ts, on its own, with no database.
 *
 * "Every column of job_postings except the restricted ones is readable by anon and by authenticated, and the restricted ones are readable
 * by neither." A new column added without a grant would give a 42501 to every signed-in and anonymous reader, silently, so the check must
 * name it. These cases are the ones that must be caught.
 */
import { describe, expect, it } from "vitest";
import { compareColumnGrants } from "../support/column-grants";

const ALL = ["id", "title", "admin_review_note", "scratch_probe"];
const RESTRICTED = ["admin_review_note"];

describe("compareColumnGrants", () => {
  it("is clean when exactly the restricted columns are unreadable", () => {
    expect(compareColumnGrants({ columns: ["id", "title", "admin_review_note"], unreadable: ["admin_review_note"], restricted: RESTRICTED })).toEqual({
      ungranted: [],
      restrictedButReadable: [],
    });
  });

  it("names a new column that was added without a grant", () => {
    const r = compareColumnGrants({ columns: ALL, unreadable: ["admin_review_note", "scratch_probe"], restricted: RESTRICTED });
    expect(r.ungranted).toEqual(["scratch_probe"]);
    expect(r.restrictedButReadable).toEqual([]);
  });

  it("names a restricted column that became readable again (a re-granted table, a widened grant)", () => {
    const r = compareColumnGrants({ columns: ALL, unreadable: ["scratch_probe"], restricted: RESTRICTED });
    expect(r.restrictedButReadable).toEqual(["admin_review_note"]);
  });

  it("reports both problems at once, sorted", () => {
    const r = compareColumnGrants({ columns: ["b", "a", "admin_review_note"], unreadable: ["b", "a"], restricted: RESTRICTED });
    expect(r).toEqual({ ungranted: ["a", "b"], restrictedButReadable: ["admin_review_note"] });
  });

  it("a restricted name that is not a real column is itself reported, so the list cannot rot", () => {
    const r = compareColumnGrants({ columns: ["id"], unreadable: [], restricted: ["gone_column"] });
    expect(r.restrictedButReadable).toEqual(["gone_column"]);
  });
});
