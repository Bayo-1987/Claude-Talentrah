/**
 * stripRedundantJobHeader (src/lib/seo/job-description-snippet.ts).
 *
 * ── THE BUG THIS WAS WRITTEN AFTER ────────────────────────────────────────
 *
 * `generateMetadata()` on the job detail page builds its meta description as
 * `lead` (role, company, location) plus a ~155-char snippet of the raw
 * description. A real live posting's `description` opened with its own
 * "Job Title: X / Type: Y / Location: Z" header — a restatement the snippet
 * function had no way to know was redundant with `lead` — so the resulting
 * meta description read as a wall of metadata rather than a description. The
 * fixtures below are the real sampled postings, not invented text, taken
 * directly from production (2026-09-18 measurement): only 4 of 704 open
 * postings carry this shape, both real employers rather than one source's
 * format (see this module's own header for the full count and reasoning on
 * why the fix lives here and not in an ingest-level source normalizer).
 */
import { describe, expect, it } from "vitest";
import { stripRedundantJobHeader } from "@/lib/seo/job-description-snippet";

// The Law Offices of Sabrina Li's own posting — the exact text sampled in
// production, whitespace-collapsed the same way generateMetadata's own
// `body` already is before this function ever sees it.
const SABRINA_LI = (
  "Job Title: Staff Accountant\n\n" +
  "Type: Independent Contractor **Location: Remote | Philippines | Taiwan | China | South Africa\n\n" +
  "About Us \n\n" +
  "The Law Offices of Sabrina Li, P.C. is a leading, full-service U.S. immigration law firm."
).replace(/\s+/g, " ").trim();

// Optimal Group's own posting — a different real employer, a different
// header shape (JOB TITLE/LOCATION, then TERMS/SALARY, which this fix must
// NOT touch — see the module header on why those are left alone).
const OPTIMAL_GROUP = (
  "JOB TITLE:  Finance Executive \n\n" +
  "LOCATION: Remote but must have 2 screens to work on from home \n\n" +
  "TERMS: Full-time, Permanent. UK hours 8am - 5pm \n\n" +
  "SALARY: R20,000 - 28,000 per month \n\n" +
  " \n\n" +
  "WHY JOIN OPTIMAL? \n\n" +
  "Optimal Maintenance is a fast-growing facilities management company."
).replace(/\s+/g, " ").trim();

describe("stripRedundantJobHeader", () => {
  it("strips Job Title/Type/Location from the real Sabrina Li posting, landing on real prose", () => {
    const out = stripRedundantJobHeader(SABRINA_LI);
    expect(out).not.toMatch(/job title\s*:/i);
    expect(out).not.toMatch(/^\s*type\s*:/i);
    expect(out.startsWith("About Us")).toBe(true);
    expect(out).toContain("The Law Offices of Sabrina Li");
  });

  it("strips Job Title/Location from the real Optimal Group posting, but leaves TERMS/SALARY alone", () => {
    const out = stripRedundantJobHeader(OPTIMAL_GROUP);
    expect(out).not.toMatch(/job title\s*:/i);
    expect(out).not.toMatch(/^\s*location\s*:/i);
    // TERMS and SALARY are new information, not a restatement of `lead` —
    // scoped out on purpose, not missed.
    expect(out.startsWith("TERMS:")).toBe(true);
    expect(out).toContain("SALARY: R20,000");
  });

  it("leaves an ordinary description with no such header completely unchanged", () => {
    const normal =
      "We are looking for a Senior Backend Engineer to join our growing team building payment infrastructure across Africa.";
    expect(stripRedundantJobHeader(normal)).toBe(normal);
  });

  it("does not fire on a description that only mentions 'location' mid-sentence", () => {
    const normal = "This role requires relocation: candidates must be based in Lagos.";
    expect(stripRedundantJobHeader(normal)).toBe(normal);
  });

  it("never throws and returns the input verbatim for an empty string", () => {
    expect(stripRedundantJobHeader("")).toBe("");
  });
});
