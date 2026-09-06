/**
 * dedupeMetaParts (src/components/jobs/job-card.tsx) — the job-card meta
 * line's collision fix.
 *
 * Confirmed live: "Zaria Digital · Remote · Remote · Entry." job.location was
 * itself the literal string "Remote" and job.work_type was also "remote", so
 * both WORK_TYPE_LABEL-mapped and raw-location strings rendered side by side.
 * Not scoped to the word "Remote" specifically — the same collision could
 * happen with any location value, so the fix is a case-insensitive dedupe
 * over the whole meta array, not a special case.
 */
import { describe, expect, it } from "vitest";
import { dedupeMetaParts } from "@/components/jobs/job-card";

const WORK_TYPE_LABEL: Record<string, string> = { remote: "Remote", hybrid: "Hybrid", onsite: "Onsite" };
const SENIORITY_LABEL: Record<string, string> = { entry: "Entry" };

describe("dedupeMetaParts", () => {
  it(
    "SABOTAGE-PROOF TARGET: a job whose location IS 'Remote' and whose work_type is 'remote' renders it once",
    () => {
      const job = { company_name: "Zaria Digital", location: "Remote", work_type: "remote", seniority: "entry" };
      const metaParts = dedupeMetaParts([
        job.company_name,
        job.location,
        job.work_type ? WORK_TYPE_LABEL[job.work_type] : null,
        job.seniority ? SENIORITY_LABEL[job.seniority] : null,
      ]);
      expect(metaParts).toEqual(["Zaria Digital", "Remote", "Entry"]);
      expect(metaParts.join(" · ")).toBe("Zaria Digital · Remote · Entry");
    },
  );

  it("is case-insensitive, not a literal match on 'Remote'", () => {
    // The same collision shape with a different value entirely — proves this
    // isn't a special case for the word "Remote".
    expect(dedupeMetaParts(["Lagos", "LAGOS", "Senior"])).toEqual(["Lagos", "Senior"]);
  });

  it("does not require the duplicates to be adjacent", () => {
    expect(dedupeMetaParts(["Remote", "Senior", "remote"])).toEqual(["Remote", "Senior"]);
  });

  it("drops null/empty entries the same way .filter(Boolean) used to", () => {
    expect(dedupeMetaParts(["Acme", null, "Lagos", null])).toEqual(["Acme", "Lagos"]);
  });

  it("leaves genuinely distinct values alone", () => {
    expect(dedupeMetaParts(["Acme", "Lagos, Nigeria", "Hybrid", "Senior"])).toEqual([
      "Acme",
      "Lagos, Nigeria",
      "Hybrid",
      "Senior",
    ]);
  });
});
