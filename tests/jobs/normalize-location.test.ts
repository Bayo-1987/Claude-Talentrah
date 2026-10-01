/**
 * S12 (c) — `normalizeLocation`: the stored `location` text, cleaned at ingestion.
 *
 * Measured on production (2026-10-01): 128 open postings repeated a part of their own location ("Lagos, Lagos, Nigeria":
 * Workable sends city, state, country and the state is often the city), some carried a trailing ISO code ("Cameroon (CM)"),
 * a stray full stop ("... Democratic Republic of Congo."), ragged spacing, or a template placeholder ("City, Country",
 * "Program Country") stored as if it were a place.
 *
 * What it does NOT do: invent, reorder, translate, or guess. It removes a part that repeats an earlier part of the same
 * entry (case and space insensitive), drops a duplicate entry, tidies spacing and a trailing full stop, strips a trailing
 * ISO code only when it is that country's own, and turns a placeholder into "no location". It is idempotent.
 *
 * IDENTITY. The fingerprint is computed from the RAW location, not this (a changed location string is a changed identity,
 * dedup.ts); tests below pin that the adapters' fingerprints did not move.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeDedupFingerprint } from "@/lib/jobs/dedup";
import { normalizeLocation } from "@/lib/jobs/location";
import { fetchWorkableJobs } from "@/lib/jobs/sources/workable";

describe("repeated parts", () => {
  it.each([
    ["Lagos, Lagos, Nigeria", "Lagos, Nigeria"],
    ["Abuja, Abuja, Nigeria", "Abuja, Nigeria"],
    ["Lagos, lagos, Nigeria", "Lagos, Nigeria"],
    ["Nigeria, Nigeria", "Nigeria"],
    ["Remote, Remote, Nigeria", "Remote, Nigeria"],
    ["Lagos,  Lagos ,Nigeria", "Lagos, Nigeria"],
    ["Lagos, Nigeria; Lagos, Nigeria", "Lagos, Nigeria"],
    ["Lagos, Lagos, Nigeria; Abuja, Abuja, Nigeria", "Lagos, Nigeria; Abuja, Nigeria"],
  ])("%j -> %j", (raw, want) => {
    expect(normalizeLocation(raw)).toBe(want);
  });

  it.each([
    "Abuja, Federal Capital Territory, Nigeria",
    "Nairobi, Nairobi County, Kenya",
    "Ibadan, Oyo, Nigeria",
    "Cape Town, Western Cape, South Africa",
    "Remote, Poland",
    "Remote, Lagos, Nigeria",
    "Lagos, Nigeria; Remote, Nigeria",
    "Remote - Germany and Switzerland",
    "Nigeria",
    "Remote",
  ])("%j is already clean and comes back unchanged", (raw) => {
    expect(normalizeLocation(raw)).toBe(raw);
  });

  it("two different places that merely share a word are not merged", () => {
    expect(normalizeLocation("Kigali, Kigali City, Rwanda")).toBe("Kigali, Kigali City, Rwanda");
    expect(normalizeLocation("Lagos Island, Lagos, Nigeria")).toBe("Lagos Island, Lagos, Nigeria");
  });
});

describe("a trailing ISO code, a full stop, spacing", () => {
  it("strips '(CM)' only when it is that country's own code", () => {
    expect(normalizeLocation("Cameroon (CM)")).toBe("Cameroon");
    expect(normalizeLocation("Douala, Cameroon (CM)")).toBe("Douala, Cameroon");
    expect(normalizeLocation("Cameroon (NG)")).toBe("Cameroon (NG)");
    expect(normalizeLocation("Lagos (LA)")).toBe("Lagos (LA)");
  });

  it("drops one trailing full stop and collapses ragged space", () => {
    expect(normalizeLocation("Kimpese, Democratic Republic of Congo.")).toBe("Kimpese, Democratic Republic of Congo");
    expect(normalizeLocation("  Kimpese,   Democratic Republic of Congo  ")).toBe("Kimpese, Democratic Republic of Congo");
    expect(normalizeLocation("Kimpese,\nDemocratic Republic of Congo")).toBe("Kimpese, Democratic Republic of Congo");
  });

  it("leaves case and word order alone", () => {
    expect(normalizeLocation("lagos, NIGERIA")).toBe("lagos, NIGERIA");
  });
});

describe("a placeholder is not a place", () => {
  it.each(["City, Country", "city, country", "Program Country", "N/A", "TBD", "Unknown", "-", "", "   ", null, undefined])(
    "%j -> no location",
    (raw) => {
      expect(normalizeLocation(raw)).toBeUndefined();
    },
  );
});

describe("it is idempotent", () => {
  it.each([
    "Lagos, Lagos, Nigeria",
    "Lagos, Nigeria; Lagos, Nigeria",
    "Cameroon (CM)",
    "Kimpese, Democratic Republic of Congo.",
    "Remote, Remote, Nigeria",
    "Abuja, Federal Capital Territory, Nigeria",
  ])("%j", (raw) => {
    const once = normalizeLocation(raw);
    expect(normalizeLocation(once)).toBe(once);
  });
});

describe("the adapters store the clean text and keep the old identity", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("Workable: city == state is stored once, and the fingerprint is the one the raw string produced", async () => {
    fetchMock.mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        name: "Kuda Technologies Ltd",
        jobs: [
          {
            title: "Backend Engineer",
            shortcode: "E96B878F8B",
            url: "https://apply.workable.com/j/E96B878F8B",
            country: "Nigeria",
            city: "Lagos",
            state: "Lagos",
            published_on: "2026-07-31",
            description: "<p>Ship backend services.</p>",
          },
        ],
      }),
    }));
    const [posting] = await fetchWorkableJobs("kuda", "Kuda Technologies Ltd");
    expect(posting!.location).toBe("Lagos, Nigeria");
    expect(posting!.dedupFingerprint).toBe(computeDedupFingerprint("Kuda Technologies Ltd", "Backend Engineer", "Lagos, Lagos, Nigeria"));
  });

  it("the fingerprint's location token does not depend on the repeated part (the first segment is untouched)", () => {
    expect(computeDedupFingerprint("Co", "Role", "Lagos, Lagos, Nigeria")).toBe(computeDedupFingerprint("Co", "Role", "Lagos, Nigeria"));
  });
});
