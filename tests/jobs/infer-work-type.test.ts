/**
 * `inferWorkType` (extract-jd.ts) — the Greenhouse-side half of the onsite
 * inference work. Pure function, no network/DB, so it gets its own small
 * unit file rather than living inside a fetcher test (there was previously
 * no dedicated file for it at all — `inferSeniority` sits right next to it
 * in extract-jd.ts and is likewise untested elsewhere).
 *
 * schema.org's structural equivalent (`mapWorkType` in schema-org.ts,
 * keyed on jobLocationType/jobLocation.address rather than a free-text
 * string) is covered in tests/jobs/schema-org.test.ts's own
 * "workType" describe block instead, since it can't be exercised without
 * going through the fetcher's JSON-LD parsing.
 */
import { describe, expect, it } from "vitest";
import { inferWorkType } from "@/lib/jobs/extract-jd";

describe("inferWorkType", () => {
  it("title or location containing 'remote' wins, regardless of what else is present", () => {
    expect(inferWorkType("Remote Backend Engineer", "Lagos, Nigeria")).toBe("remote");
    expect(inferWorkType("Backend Engineer", "Remote")).toBe("remote");
  });

  it("'hybrid' wins over a real location when there is no 'remote' signal", () => {
    expect(inferWorkType("Hybrid Product Designer", "Lagos, Nigeria")).toBe("hybrid");
  });

  /**
   * THE FIX. Before this, a real, specific location with no remote/hybrid
   * wording fell all the way through to undefined — indistinguishable from
   * a posting whose location this parser simply failed to read. Measured
   * against production: 220 of 305 open Greenhouse postings were null this
   * way, and every one of them names a real place in `location`.
   */
  it("a real, specific location with no remote/hybrid wording is onsite", () => {
    expect(inferWorkType("Backend Engineer", "Lagos, Nigeria")).toBe("onsite");
    expect(inferWorkType("Field Recovery Officer", "Kigali, Rwanda")).toBe("onsite");
    // Semicolon-joined multi-city postings are still real places, just several.
    expect(inferWorkType("Regional Officer", "Bamako, Mali; Ouagadougou, Burkina Faso")).toBe("onsite");
  });

  it("no location at all stays undefined — 'onsite' is asserted from evidence, never defaulted", () => {
    expect(inferWorkType("Backend Engineer", undefined)).toBeUndefined();
    expect(inferWorkType("Backend Engineer", "")).toBeUndefined();
  });

  /**
   * These four are real values seen in production `location.name` fields on
   * postings whose actual work type could not be determined (a template
   * placeholder left in by the source, or an internal label with no
   * geographic meaning) — not real places, so must not become a confident
   * onsite claim just because the string is non-empty.
   */
  it("known placeholder/non-geographic values stay undefined, not onsite", () => {
    expect(inferWorkType("Backend Engineer", "OpCo")).toBeUndefined();
    expect(inferWorkType("Backend Engineer", "Program Country")).toBeUndefined();
    expect(inferWorkType("Backend Engineer", "City, Country")).toBeUndefined();
    expect(inferWorkType("Backend Engineer", "N/A")).toBeUndefined();
    // Case/whitespace variants of the same placeholders must not slip through.
    expect(inferWorkType("Backend Engineer", "  opco  ")).toBeUndefined();
  });
});
