/**
 * The heuristic parser (src/lib/resume/heuristic-parse.ts) is the primary
 * path — it runs on every upload, and the LLM fallback only fires when it
 * comes back low-confidence (see parse.ts). That means a well-formatted
 * resume that DOES parse with high confidence would never reach the LLM
 * fallback's schema-driven extraction at all — so the two new fields this
 * parser can detect deterministically (a bulleted experience section, and a
 * LinkedIn/GitHub/portfolio URL) have to be handled here too, not just in
 * llm-fallback.ts, or they'd silently never populate for the common case.
 */
import { describe, expect, it } from "vitest";
import { heuristicParseResume } from "@/lib/resume/heuristic-parse";

describe("bulleted experience sections populate bullets, not description", () => {
  it("every line starting with a bullet marker becomes a bullets array", () => {
    const text = [
      "Ada Lovelace",
      "ada@example.com",
      "",
      "Experience",
      "Product Manager",
      "Analytical Engines Ltd",
      "- Shipped the difference engine redesign",
      "- Cut computation errors by a third",
      "",
      "Skills",
      "SQL, Python",
    ].join("\n");

    const { resume } = heuristicParseResume(text);
    expect(resume.experience[0].bullets).toEqual([
      "Shipped the difference engine redesign",
      "Cut computation errors by a third",
    ]);
    expect(resume.experience[0].description).toBeUndefined();
  });

  it("recognises the bullet character •, not just a hyphen", () => {
    const text = [
      "Ada Lovelace",
      "ada@example.com",
      "",
      "Experience",
      "Product Manager",
      "Analytical Engines Ltd",
      "• Shipped the difference engine redesign",
      "• Cut computation errors by a third",
    ].join("\n");

    const { resume } = heuristicParseResume(text);
    expect(resume.experience[0].bullets).toEqual([
      "Shipped the difference engine redesign",
      "Cut computation errors by a third",
    ]);
  });

  it("a MIXED block (some bulleted lines, some plain prose) is left as ordinary description, not split", () => {
    // Deliberately conservative: guessing which lines are "really" bullets
    // in a mixed block risks mangling a resume that just wraps normal
    // sentences across lines. Only an unambiguous, fully-bulleted block
    // gets the bullets treatment.
    const text = [
      "Ada Lovelace",
      "ada@example.com",
      "",
      "Experience",
      "Product Manager",
      "Analytical Engines Ltd",
      "- Shipped the difference engine redesign",
      "Also mentored two junior engineers on the side",
    ].join("\n");

    const { resume } = heuristicParseResume(text);
    expect(resume.experience[0].bullets).toBeUndefined();
    expect(resume.experience[0].description).toContain("Shipped the difference engine redesign");
    expect(resume.experience[0].description).toContain("mentored two junior engineers");
  });

  it("a role with no narrative at all still parses, with neither bullets nor description set", () => {
    const text = ["Ada Lovelace", "ada@example.com", "", "Experience", "Product Manager", "Analytical Engines Ltd"].join(
      "\n",
    );
    const { resume } = heuristicParseResume(text);
    expect(resume.experience[0].bullets).toBeUndefined();
    expect(resume.experience[0].description).toBeUndefined();
  });

  it("does not invent bullets for a resume that genuinely has none", () => {
    const text = [
      "Ada Lovelace",
      "ada@example.com",
      "",
      "Experience",
      "Product Manager",
      "Analytical Engines Ltd",
      "Ran the whole programme end to end.",
    ].join("\n");
    const { resume } = heuristicParseResume(text);
    expect(resume.experience[0].bullets).toBeUndefined();
    expect(resume.experience[0].description).toBe("Ran the whole programme end to end.");
  });
});

describe("a LinkedIn/GitHub/portfolio URL in the resume text becomes a links entry", () => {
  it("recognises a LinkedIn URL and labels it LinkedIn", () => {
    const text = [
      "Ada Lovelace",
      "ada@example.com",
      "linkedin.com/in/ada-lovelace",
      "",
      "Experience",
      "PM",
      "Co",
      "Did things",
    ].join("\n");
    const { resume } = heuristicParseResume(text);
    expect(resume.links).toEqual([{ label: "LinkedIn", url: "linkedin.com/in/ada-lovelace" }]);
  });

  it("recognises a GitHub URL and labels it GitHub", () => {
    const text = ["Ada Lovelace", "ada@example.com", "https://github.com/ada", "", "Experience", "PM", "Co", "Did things"].join(
      "\n",
    );
    const { resume } = heuristicParseResume(text);
    expect(resume.links).toEqual([{ label: "GitHub", url: "https://github.com/ada" }]);
  });

  it("labels any other real URL as Website, without inventing a more specific guess", () => {
    const text = [
      "Ada Lovelace",
      "ada@example.com",
      "https://ada-lovelace.dev/portfolio",
      "",
      "Experience",
      "PM",
      "Co",
      "Did things",
    ].join("\n");
    const { resume } = heuristicParseResume(text);
    expect(resume.links).toEqual([{ label: "Website", url: "https://ada-lovelace.dev/portfolio" }]);
  });

  it("strips trailing sentence punctuation from the URL", () => {
    const text = [
      "Ada Lovelace",
      "ada@example.com",
      "See my work at https://github.com/ada.",
      "",
      "Experience",
      "PM",
      "Co",
      "Did things",
    ].join("\n");
    const { resume } = heuristicParseResume(text);
    expect(resume.links?.[0].url).toBe("https://github.com/ada");
  });

  it("dedupes the same URL appearing twice", () => {
    const text = [
      "Ada Lovelace",
      "ada@example.com",
      "https://github.com/ada — see also https://github.com/ada for my resume",
      "",
      "Experience",
      "PM",
      "Co",
      "Did things",
    ].join("\n");
    const { resume } = heuristicParseResume(text);
    expect(resume.links).toHaveLength(1);
  });

  it("does not set links at all when the resume has no URL", () => {
    const text = ["Ada Lovelace", "ada@example.com", "", "Experience", "PM", "Co", "Did things"].join("\n");
    const { resume } = heuristicParseResume(text);
    expect(resume.links).toBeUndefined();
  });

  it("does not mistake the candidate's own email domain for a link", () => {
    const text = ["Ada Lovelace", "ada@analytical-engines.com", "", "Experience", "PM", "Co", "Did things"].join("\n");
    const { resume } = heuristicParseResume(text);
    expect(resume.links).toBeUndefined();
  });
});
