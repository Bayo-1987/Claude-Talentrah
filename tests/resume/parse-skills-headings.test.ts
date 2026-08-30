/**
 * The resume parser's skills section, and the silent failure behind #139.
 *
 * ── WHAT WENT WRONG ───────────────────────────────────────────────────────
 *
 * `SECTION_PATTERNS.skills` matched exactly three strings — `skills`,
 * `technical skills`, `core competencies`. Anything else and the section was
 * simply absent, which yields `skills: []` rather than an error.
 *
 * That alone would be recoverable, because an empty skills array drops
 * confidence to `low`, which routes the upload to the LLM fallback. The
 * failure needed all three of these together:
 *
 *   1. the heading missed          -> skills: []
 *   2. confidence went low         -> LLM fallback attempted
 *   3. the fallback threw and the error was DISCARDED, with no logging
 *
 * so the partial heuristic parse was stored and the upload reported success.
 * One of the three real uploaded resumes on production is in that state. It
 * scores near-zero against the entire board and can never reach the
 * Auto-Apply threshold, and nothing anywhere recorded that anything failed.
 *
 * These tests pin step 1 and the confidence signal that depends on it. The
 * logging in step 3 and the persisted confidence are covered separately —
 * see parse.ts and migration 0070.
 */
import { describe, expect, it } from "vitest";
import { heuristicParseResume } from "@/lib/resume/heuristic-parse";

function resumeWith(heading: string) {
  return [
    "Ada Lovelace",
    "ada@example.com",
    "+234 800 000 0000",
    "",
    "Experience",
    "Product Manager",
    "Analytical Engines Ltd",
    "Led the thing.",
    "",
    heading,
    "SQL, Python, Figma",
  ].join("\n");
}

describe("the skills heading, as people actually write it", () => {
  it.each([
    "Skills",
    "Technical Skills",
    "Core Competencies",
  ])("still matches %s, which always worked", (heading) => {
    expect(heuristicParseResume(resumeWith(heading)).resume.skills).toContain("SQL");
  });

  it.each([
    "Key Skills",
    "Areas of Expertise",
    "Technical Proficiencies",
    "Skills & Interests",
    "Skills and Abilities",
    "Professional Skills",
    "Relevant Skills",
    "Competencies",
    "Expertise",
    "Skill Set",
  ])("now matches %s, which silently produced an empty array", (heading) => {
    const { resume } = heuristicParseResume(resumeWith(heading));
    expect(resume.skills, `"${heading}" parsed to no skills`).toContain("SQL");
    expect(resume.skills).toContain("Python");
  });

  it("is still a HEADING test, not a substring search", () => {
    /*
     * The load-bearing negative. Loosening this to "any line containing
     * skills" would treat a bullet as the start of a section and swallow
     * everything after it — turning a narrow miss into a wrong parse, which
     * is worse.
     */
    const text = [
      "Ada Lovelace",
      "ada@example.com",
      "",
      "Experience",
      "Product Manager",
      "Analytical Engines Ltd",
      "Applied strong analytical skills to the engine",
      "Mentored two juniors",
      "",
      "Skills",
      "SQL, Python",
    ].join("\n");
    const { resume } = heuristicParseResume(text);
    expect(resume.skills).toEqual(["SQL", "Python"]);
    expect(resume.experience[0]?.description).toContain("analytical skills");
  });

  it("does not invent a section when the resume genuinely has none", () => {
    const text = ["Ada Lovelace", "ada@example.com", "", "Experience", "PM", "Co", "Did things"].join("\n");
    expect(heuristicParseResume(text).resume.skills).toEqual([]);
  });
});

describe("the confidence signal that routes to the LLM", () => {
  it("is low when the skills section was missed", () => {
    // The pre-fix production case: email and experience present, skills empty.
    const text = ["Ada Lovelace", "ada@example.com", "", "Experience", "PM", "Co", "Did things"].join("\n");
    expect(heuristicParseResume(text).confidence).toBe("low");
  });

  it("is high once a previously-missed heading parses", () => {
    // The point of widening the pattern: these uploads stop depending on an
    // LLM call that production's shared free-tier key may refuse.
    expect(heuristicParseResume(resumeWith("Areas of Expertise")).confidence).toBe("high");
  });
});
