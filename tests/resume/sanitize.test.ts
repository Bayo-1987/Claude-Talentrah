/**
 * Regression test for a real bug caught live during the M6 Gemini swap:
 * gemini-3.6-flash occasionally spirals a missing/ambiguous structured
 * field into hundreds of words of repetitive filler instead of an empty
 * string (observed on a `phone` field with no source data — the resume
 * had no phone number, and instead of "", the model produced ~4000
 * characters of "...standard fallback logic context parameters properly
 * handle default value...", repeated). sanitizeStructuredResume() is the
 * defensive backstop that keeps that out of the database and the UI
 * regardless of which model or provider is behind Farah.
 */
import { describe, expect, it } from "vitest";
import { sanitizeStructuredResume, wasDegenerate } from "@/lib/resume/sanitize";
import { EMPTY_RESUME, type StructuredResume } from "@/lib/resume/types";

const DEGENERATE_PHONE =
  "N/A (Update on actual resume if applicable canonical field is needed execution-wise contextually based on standard template defaults provided directly within user payloads naturally existing contextually beyond explicitly required schema elements.) constraints explicitly avoid hallucination without schema conflict context parsing directly using raw provided string output parameters fallback safety standard defaults safely cleanly parsed logic output standard patterns mapping directly input payload structure values cleanly safe string fallback placeholders cleanly fallback standard payload format directly standard fields safely format structure logic fields provided string format string pattern value matches output payload properly matching payload standard structure matching input context directly default empty value safe string logic handle directly standard parse matching string schema fields gracefully context fallback structure safely match input string object format data value fallback placeholder safely handle default empty mapping string parsing.";

describe("sanitizeStructuredResume", () => {
  it("drops a degenerate short field (the actual bug: a runaway phone value) rather than keeping it, even truncated", () => {
    const raw: StructuredResume = {
      ...EMPTY_RESUME,
      contact: { name: "Demo Seeker", phone: DEGENERATE_PHONE },
    };
    const cleaned = sanitizeStructuredResume(raw);
    expect(cleaned.contact.phone).toBeUndefined();
    expect(cleaned.contact.name).toBe("Demo Seeker");
  });

  it("keeps normal, legitimately short field values untouched", () => {
    const raw: StructuredResume = {
      ...EMPTY_RESUME,
      contact: { name: "Demo Seeker", phone: "+234 800 000 0000", email: "demo@talentrah.dev" },
      skills: ["product management", "sql", "figma"],
    };
    const cleaned = sanitizeStructuredResume(raw);
    expect(cleaned.contact.phone).toBe("+234 800 000 0000");
    expect(cleaned.contact.email).toBe("demo@talentrah.dev");
    expect(cleaned.skills).toEqual(["product management", "sql", "figma"]);
  });

  it("truncates (rather than drops) an overlong long-form field like summary, since some real summaries are just long", () => {
    const longSummary = "a".repeat(2500);
    const raw: StructuredResume = { ...EMPTY_RESUME, summary: longSummary };
    const cleaned = sanitizeStructuredResume(raw);
    expect(cleaned.summary?.length).toBeLessThanOrEqual(2001); // 2000 + the "…" marker
    expect(cleaned.summary?.endsWith("…")).toBe(true);
  });

  it("drops a degenerate experience.startDate the same way, without dropping the rest of that entry", () => {
    const raw: StructuredResume = {
      ...EMPTY_RESUME,
      experience: [
        {
          title: "Product Manager",
          company: "Fintech Co",
          startDate: DEGENERATE_PHONE,
          endDate: "Present",
        },
      ],
    };
    const cleaned = sanitizeStructuredResume(raw);
    expect(cleaned.experience[0].startDate).toBeUndefined();
    expect(cleaned.experience[0].title).toBe("Product Manager");
    expect(cleaned.experience[0].endDate).toBe("Present");
  });

  it("filters out degenerate items from list fields (skills/projects/certifications) without dropping valid ones", () => {
    const raw: StructuredResume = {
      ...EMPTY_RESUME,
      skills: ["sql", DEGENERATE_PHONE, "figma"],
    };
    const cleaned = sanitizeStructuredResume(raw);
    expect(cleaned.skills).toEqual(["sql", "figma"]);
  });
});

describe("wasDegenerate", () => {
  it("returns true when sanitizing actually changed something", () => {
    const raw: StructuredResume = { ...EMPTY_RESUME, contact: { phone: DEGENERATE_PHONE } };
    const cleaned = sanitizeStructuredResume(raw);
    expect(wasDegenerate(raw, cleaned)).toBe(true);
  });

  it("returns false when the input was already clean", () => {
    const raw: StructuredResume = { ...EMPTY_RESUME, contact: { phone: "+234 800 000 0000" } };
    const cleaned = sanitizeStructuredResume(raw);
    expect(wasDegenerate(raw, cleaned)).toBe(false);
  });
});
