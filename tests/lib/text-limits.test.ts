/**
 * Text limits (S1-56 PR 1): one table of caps, one rule for checking them on the client and the server.
 *
 * The screening-gate-apply header describes the bug that happens when the two disagree: the client said fine, the server said no.
 * Both sides now call `fitsLimit`, which counts the way the server counts (trimmed) and lets a value that was ALREADY over the cap be saved
 * unchanged, or shortened, but never made longer: a cap added after data exists must not lock people out of their own saved text.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { FIELD_LIMITS, countForLimit, fitsLimit } from "@/lib/text-limits";

describe("countForLimit", () => {
  it("counts the trimmed value, the way the server's .trim().max() does", () => {
    expect(countForLimit("  hello  ")).toBe(5);
    expect(countForLimit("")).toBe(0);
  });
  it("counts a posted CRLF line break as one character, the way the box counts it", () => {
    expect(countForLimit("a\r\nb")).toBe(3);
    expect(fitsLimit("a\r\n".repeat(1000), 2000)).toBe(true);
    expect(fitsLimit("a\r\n".repeat(1001), 2000)).toBe(false);
  });
  it("counts characters as the server's string length does (UTF-16 code units)", () => {
    expect(countForLimit("é".repeat(10))).toBe(10);
    expect(countForLimit("😀")).toBe(2);
  });
});

describe("counting for a global audience: the one function the box and the server both import", () => {
  // The number is UTF-16 code units, exactly what the browser's maxLength and a JavaScript string length use, so the box, the browser and the
  // server can never disagree. These are the cases that surprise people.
  it.each([
    ["ASCII", "hello", 5],
    ["an emoji is two code units", "\u{1F600}", 2],
    ["a flag (two regional indicators)", "\u{1F1F3}\u{1F1EC}", 4],
    ["a family emoji (ZWJ sequence)", "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}", 8],
    ["CJK, one code unit each", "\u65E5\u672C\u8A9E", 3],
    ["Arabic", "\u0645\u0631\u062D\u0628\u0627", 5],
    ["Hebrew", "\u05E9\u05DC\u05D5\u05DD", 4],
    ["a combining mark (e + acute) counts both", "e\u0301", 2],
    ["a precomposed accent counts one", "\u00E9", 1],
    ["a skin-tone emoji", "\u{1F44D}\u{1F3FD}", 4],
  ])("%s", (_name, text, expected) => {
    expect(countForLimit(text)).toBe(expected);
    expect(countForLimit(text)).toBe(text.length);
    expect(fitsLimit(text, expected)).toBe(true);
    expect(fitsLimit(text, expected - 1)).toBe(false);
  });

  it("the box imports the same counting function the server checks use (one definition, not two)", () => {
    const box = readFileSync(path.join(__dirname, "../../src/components/ui/text-area.tsx"), "utf8");
    expect(box).toMatch(/import \{[^}]*countForLimit[^}]*\} from "@\/lib\/text-limits"/);
  });
});

describe("fitsLimit", () => {
  it("a new value is within the cap or it is not", () => {
    expect(fitsLimit("a".repeat(2000), 2000)).toBe(true);
    expect(fitsLimit("a".repeat(2001), 2000)).toBe(false);
  });

  it("a saved value that is already over the cap can be saved unchanged", () => {
    const saved = "a".repeat(2500);
    expect(fitsLimit(saved, 2000, saved)).toBe(true);
  });

  it("a saved value that is over the cap can be shortened but not made longer", () => {
    const saved = "a".repeat(2500);
    expect(fitsLimit("a".repeat(2400), 2000, saved)).toBe(true);
    expect(fitsLimit("a".repeat(2501), 2000, saved)).toBe(false);
  });

  it("trailing whitespace does not count against the cap on either side", () => {
    expect(fitsLimit("a".repeat(2000) + "   ", 2000)).toBe(true);
  });
});

describe("FIELD_LIMITS", () => {
  it("holds the approved caps, so a change is deliberate", () => {
    expect(FIELD_LIMITS).toEqual({
      reportDetails: 2000,
      feedbackMessage: 5000,
      contactMessage: 5000,
      trackerNotes: 2000,
      mentorshipReviewNote: 1000,
      assessmentTextAnswer: 5000,
      scholarshipMotivation: 2000,
      portfolioDescription: 1000,
      contactRequestMessage: 2000,
      companyDescription: 1000,
      mentorBio: 2000,
      decisionNote: 2000,
      jdPasteUsedChars: 24000,
    });
  });
});
