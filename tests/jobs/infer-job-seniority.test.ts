/**
 * S12 (e) — `inferJobSeniority`: a posting's seniority from its TITLE, or undefined when the title does not say.
 *
 * THE BUG THIS REPLACES. `inferSeniority` ended in `return "mid"`: every title with no seniority word was recorded as
 * mid-level. Measured on production (2026-10-01, 662 open postings): 412 were that default, including 117 "Manager"
 * titles and roles like "Finance Associate" and "Field Credit Officer", so "Mid-level" on a card meant "we could not tell".
 * A guess recorded as a fact, which every consumer (the card chip, the Seniority filter, the matcher) then read as one.
 *
 * Now: no signal -> undefined (stored as NULL; the card shows no chip; the matcher is neutral — see
 * tests/matching/seniority-unknown-neutral.test.ts). Each case below is a real title from that board.
 *
 * `inferSeniority` itself is UNCHANGED and still defaults to mid, because src/lib/matching/score.ts calls it on the RESUME's
 * most recent title; changing it would silently move every candidate's score. It is pinned here so that stays deliberate.
 */
import { describe, expect, it } from "vitest";
import { inferJobSeniority, inferSeniority } from "@/lib/jobs/extract-jd";

describe("no seniority word -> unknown (undefined), not mid", () => {
  it.each([
    "Finance Associate",
    "Customer Success Associate",
    "Community Associate: Lagos",
    "Engineering Manager",
    "Business Relationship Manager (Imo)",
    "Product Manager, Customer Support",
    "Field Credit Officer (Osun)",
    "Offline Customer Support Officer (Borno)",
    "Data Scientist",
    "Software Engineer",
    "Hardware Engineer",
    "Corporate Driver",
    "Head, Group FP&A",
  ])("%s", (title) => {
    expect(inferJobSeniority(title)).toBeUndefined();
  });
});

describe("a seniority word says so", () => {
  it.each([
    ["Senior Software Engineer", "senior"],
    ["Sr. Data Analyst", "senior"],
    ["Senior Associate Early Years, Human Development", "senior"],
    ["Senior Sales Executive.", "senior"],
    ["Lead Engineer - Test Automation & Tools Development", "lead"],
    ["Principal Generalist Engineer", "lead"],
    ["Staff Product Designer", "lead"],
    ["Head of Engineering, Supply Chain", "lead"],
    ["Chief Technology Officer", "executive"],
    ["Marketing Director", "executive"],
    ["Partner Program Director", "executive"],
    ["Associate Director, Programmes", "executive"],
    ["Junior Developer", "entry"],
    ["Jr. Designer", "entry"],
    ["Graduate Intern", "entry"],
    ["Partech Africa - Investment Analyst Intern - January 2027", "entry"],
    ["2027 Summer Software Developer Internship", "entry"],
    ["Finance Trainee", "entry"],
    ["Entry Level Analyst", "entry"],
  ])("%s -> %s", (title, want) => {
    expect(inferJobSeniority(title)).toBe(want);
  });
});

describe("the manager/associate rungs that ARE explicit", () => {
  it.each([
    ["Assistant Manager - Certifications and Research", "mid"],
    ["Associate Manager, Program Data Analytics", "mid"],
    ["Deputy Manager, Operations", "mid"],
  ])("%s -> %s", (title, want) => {
    expect(inferJobSeniority(title)).toBe(want);
  });

  it("a bare 'Manager' is NOT guessed: Product and Project Managers are individual contributors, Engineering Managers are not", () => {
    expect(inferJobSeniority("Manager")).toBeUndefined();
    expect(inferJobSeniority("Senior Manager, Finance")).toBe("senior");
  });
});

describe("'executive' as a job TITLE is not an executive-level role", () => {
  // The old rule matched the bare word, so an Executive Assistant, a Finance Executive and a Sales Executive were all
  // classified executive-level — and "Senior Sales Executive" too, because that check ran first.
  it.each(["Executive Assistant", "Finance Executive", "Sales Executive", "Account Executive", "Executive Assistant to the CEO"])(
    "%s",
    (title) => {
      expect(inferJobSeniority(title)).toBeUndefined();
    },
  );
});

describe("the resume-side inferSeniority is unchanged", () => {
  it("still defaults to mid, because the matcher reads it for the candidate's latest title", () => {
    expect(inferSeniority("Accountant")).toBe("mid");
    expect(inferSeniority("Finance Associate")).toBe("mid");
    expect(inferSeniority("Executive Assistant")).toBe("executive");
    expect(inferSeniority("Senior Engineer")).toBe("senior");
  });
});
