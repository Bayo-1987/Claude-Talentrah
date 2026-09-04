/**
 * refuseIfProduction (scripts/refuse-production.ts) — the hard stop that
 * keeps a seed/catalog script from ever writing to production. Requested
 * after landing #205/#206/#207 the hard way in one night: both seed
 * scripts write to whatever NEXT_PUBLIC_SUPABASE_URL happens to be set to,
 * with nothing else standing between a local run and production.
 */
import { describe, expect, it } from "vitest";
import { refuseIfProduction } from "../../scripts/refuse-production";

const PRODUCTION_URL = "https://nytwbbzfpytctjsoczzq.supabase.co";
const CI_URL = "https://dozaffzgqkbarxtlclsj.supabase.co";

describe("refuseIfProduction", () => {
  it("throws — refuses to run — when the URL is production's own project ref", () => {
    expect(() => refuseIfProduction("seed", PRODUCTION_URL)).toThrow(/production/i);
  });

  it("names the calling script in the error, so the refusal is traceable to which script ran", () => {
    expect(() => refuseIfProduction("seed-catalog", PRODUCTION_URL)).toThrow(/seed-catalog/);
  });

  it("does not throw for CI's project ref — the normal case every seed run actually hits", () => {
    expect(() => refuseIfProduction("seed", CI_URL)).not.toThrow();
  });

  it("does not throw for an unrelated Supabase project", () => {
    expect(() => refuseIfProduction("seed", "https://someotherproject.supabase.co")).not.toThrow();
  });

  it("is not fooled by a URL that merely contains the production ref as a substring elsewhere", () => {
    // e.g. a malformed value pasted into a query string or path segment —
    // only an exact match on the ref segment of a real Supabase host counts.
    expect(() =>
      refuseIfProduction("seed", "https://evil.example.com/nytwbbzfpytctjsoczzq"),
    ).not.toThrow();
  });
});
