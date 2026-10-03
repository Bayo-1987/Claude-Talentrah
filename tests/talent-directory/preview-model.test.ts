/**
 * EMP-1 / E1 — the pure half of the Talent Directory preview: the threshold, the exact copy, and the parser that stands between the
 * database's preview payload and the page.
 *
 * Production, measured read-only on 2026-10-02: ONE opted-in, verified candidate out of 16 profiles, and no active subscription. A
 * ₦200,000 a month subscription cannot be sold against that, so below TALENT_DIRECTORY_MIN_LISTED candidates the Subscribe button is
 * hidden and the page offers a waitlist instead. At or above it the normal flow returns unchanged.
 */
import { describe, expect, it } from "vitest";
import {
  TALENT_DIRECTORY_MIN_LISTED,
  TALENT_DIRECTORY_MAX_SAMPLES,
  isSubscriptionOpen,
  buildingTheDirectoryMessage,
  parseTalentDirectoryPreview,
} from "@/lib/talent-directory/preview";

describe("the threshold is a named constant, pinned at 10", () => {
  it("is 10, and the sample cap is 3", () => {
    expect(TALENT_DIRECTORY_MIN_LISTED).toBe(10);
    expect(TALENT_DIRECTORY_MAX_SAMPLES).toBe(3);
  });

  it("9 candidates: subscription closed. 10: open. The boundary is the constant, not a literal", () => {
    expect(isSubscriptionOpen(TALENT_DIRECTORY_MIN_LISTED - 1)).toBe(false);
    expect(isSubscriptionOpen(TALENT_DIRECTORY_MIN_LISTED)).toBe(true);
    expect(isSubscriptionOpen(9)).toBe(false);
    expect(isSubscriptionOpen(10)).toBe(true);
    expect(isSubscriptionOpen(0)).toBe(false);
    expect(isSubscriptionOpen(1)).toBe(false);
    expect(isSubscriptionOpen(500)).toBe(true);
  });
});

describe("the below-threshold message is exactly the founder's wording, with N interpolated", () => {
  it.each([0, 1, 2, 9])("N = %i", (n) => {
    expect(buildingTheDirectoryMessage(n)).toBe(
      `We're building the directory: ${n} verified candidates so far. Join the waitlist and we'll tell you when 10+ are listed.`,
    );
  });
});

describe("parseTalentDirectoryPreview: whitelist, cap and defend", () => {
  const sample = {
    role: "Engineering",
    yearsBand: "3-5",
    skills: ["react", "typescript"],
    availableForHire: true,
    remoteReady: false,
  };

  it("copies exactly the five safe fields and nothing else, even if the database one day returns more", () => {
    const parsed = parseTalentDirectoryPreview({
      count: 4,
      samples: [
        {
          ...sample,
          // None of these may ever reach a page, whatever the function returns.
          id: "11111111-1111-1111-1111-111111111111",
          user_id: "11111111-1111-1111-1111-111111111111",
          first_name: "Ada",
          last_name: "Obi",
          name: "Ada Obi",
          email: "ada@example.com",
          phone: "+2348000000000",
          country: "Nigeria",
          avatar_url: "https://example.com/a.png",
          company: "Acme",
        },
      ],
    });
    expect(parsed.count).toBe(4);
    expect(parsed.samples).toHaveLength(1);
    expect(Object.keys(parsed.samples[0]).sort()).toEqual(
      ["availableForHire", "remoteReady", "role", "skills", "yearsBand"].sort(),
    );
    expect(JSON.stringify(parsed)).not.toMatch(/Ada|Obi|ada@|2348|Nigeria|avatar|Acme|1111/);
  });

  it("never returns more than the sample cap, and never samples below a count of zero", () => {
    const many = Array.from({ length: 8 }, () => sample);
    expect(parseTalentDirectoryPreview({ count: 8, samples: many }).samples).toHaveLength(TALENT_DIRECTORY_MAX_SAMPLES);
  });

  it("drops a years band that is not one of the four buckets, and non-string skills", () => {
    const parsed = parseTalentDirectoryPreview({
      count: 5,
      samples: [{ ...sample, yearsBand: "7.5 years at Acme", skills: ["react", 42, null, { a: 1 }] }],
    });
    expect(parsed.samples[0].yearsBand).toBeNull();
    expect(parsed.samples[0].skills).toEqual(["react"]);
  });

  it("caps skills per sample", () => {
    const parsed = parseTalentDirectoryPreview({
      count: 5,
      samples: [{ ...sample, skills: ["a1", "b2", "c3", "d4", "e5", "f6"] }],
    });
    expect(parsed.samples[0].skills.length).toBeLessThanOrEqual(4);
  });

  it("a missing, null or malformed payload is an error, not a quiet 'zero candidates'", () => {
    expect(() => parseTalentDirectoryPreview(null)).toThrow();
    expect(() => parseTalentDirectoryPreview(undefined)).toThrow();
    expect(() => parseTalentDirectoryPreview("nope")).toThrow();
    expect(() => parseTalentDirectoryPreview({ samples: [] })).toThrow();
    expect(() => parseTalentDirectoryPreview({ count: -1, samples: [] })).toThrow();
  });
});
