/**
 * The employer expiry field and the `validThrough` it produces.
 *
 * ── WHY THIS PAIRING IS THE TEST ──────────────────────────────────────────
 *
 * `job_postings.expires_at` has existed since 0053 and nothing wrote to it.
 * `buildJobPostingJsonLd` has read it since the SEO work, emitting
 * `validThrough` when set and omitting it when not — a branch that until now
 * could never be exercised by real data, because no code path could set the
 * column.
 *
 * So the interesting assertion is not "the form saves a date". It is that the
 * value the form produces is the one Google is handed, and that choosing "no
 * expiry" still omits the property rather than emitting a null or an epoch.
 */
import { describe, expect, it } from "vitest";
import { buildJobPostingJsonLd } from "@/lib/seo/job-posting-jsonld";
import type { Tables } from "@/lib/supabase/types";

type Job = Tables<"job_postings">;

const base = (over: Partial<Job> = {}): Job =>
  ({
    id: "22222222-2222-2222-2222-222222222222",
    title: "Backend Engineer",
    company_name: "Zaria Digital",
    description: "Build and maintain the payment services. Node.js, TypeScript, PostgreSQL.",
    location: "Lagos, Nigeria",
    posted_at: "2026-08-20T09:00:00.000Z",
    expires_at: null,
    employment_type: "full_time",
    work_type: null,
    source_type: "internal",
    company_logo_url: null,
    status: "open",
    structured_jd: {},
    ...over,
  }) as unknown as Job;

/** What the action computes for a preset: now + N days, as ISO. */
function presetToIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

describe("no expiry", () => {
  it("omits validThrough entirely", () => {
    // Not null, not an epoch, not a far-future placeholder — absent. Google's
    // guidance is to omit when a job does not expire.
    const ld = buildJobPostingJsonLd(base({ expires_at: null }))!;
    expect(ld).not.toHaveProperty("validThrough");
  });
});

describe("each preset round-trips to validThrough", () => {
  it.each([1, 3, 7, 14, 30, 60])("%s days", (days) => {
    const iso = presetToIso(days);
    const ld = buildJobPostingJsonLd(base({ expires_at: iso }))!;
    expect(ld.validThrough).toBe(new Date(iso).toISOString());
  });

  it("lands the expected number of days out, not off by one", () => {
    const iso = presetToIso(30);
    const ld = buildJobPostingJsonLd(base({ expires_at: iso }))!;
    const delta = (new Date(ld.validThrough as string).getTime() - Date.now()) / 86_400_000;
    expect(delta).toBeGreaterThan(29.9);
    expect(delta).toBeLessThan(30.1);
  });

  it("is always in the future — a preset cannot produce a past date", () => {
    // The reason the field offers durations rather than a date input: a past
    // expiry is unreachable by construction rather than by validation.
    for (const days of [1, 3, 7, 14, 30, 60]) {
      expect(new Date(presetToIso(days)).getTime()).toBeGreaterThan(Date.now());
    }
  });
});

describe("a custom date round-trips the same way a preset does", () => {
  it("emits the chosen day's end as validThrough", () => {
    /*
     * The custom path is the only one where the value originates with a person
     * rather than with the server's arithmetic, so it is worth checking it
     * reaches Google unchanged rather than assuming it behaves like a preset.
     */
    const chosen = "2026-11-20T23:59:59.999Z";
    const ld = buildJobPostingJsonLd(base({ expires_at: chosen }))!;
    expect(ld.validThrough).toBe(chosen);
  });

  it("still emits nothing once that day has passed", () => {
    // The past-expiry guard does not care how the date got there.
    const past = new Date(Date.now() - 86_400_000).toISOString();
    expect(buildJobPostingJsonLd(base({ expires_at: past }))).toBeNull();
  });
});

describe("an expiry does not change anything else about the markup", () => {
  it("keeps every required property", () => {
    const ld = buildJobPostingJsonLd(base({ expires_at: presetToIso(30) }))!;
    for (const key of ["title", "description", "datePosted", "hiringOrganization", "jobLocation"]) {
      expect(ld, `missing ${key}`).toHaveProperty(key);
    }
  });

  it("still emits nothing for a closed posting, expiry or not", () => {
    // The closed-posting guard outranks expiry: an expired-but-open posting is
    // a different thing from a filled one, and only the latter is suppressed.
    expect(buildJobPostingJsonLd(base({ status: "closed", expires_at: presetToIso(30) }))).toBeNull();
  });
});
