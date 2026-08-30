/**
 * The LLM fallback's failure must leave a trace (#139).
 *
 * `parseResumeFile` falls back to the heuristic parse when the LLM call
 * throws, which is right — failing an upload because a shared free-tier quota
 * ran out is worse than storing a partial parse. What was wrong is that the
 * error was DISCARDED. A resume stored with an empty skills array looked
 * identical whether the LLM had refused or the user had genuinely listed no
 * skills, and no log anywhere distinguished them.
 *
 * That is the difference between a bug someone can find and one that has to be
 * reconstructed from the shape of stored data weeks later, which is what
 * actually happened.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/resume/llm-fallback", () => ({
  parseResumeWithLLM: vi.fn(async () => {
    throw new Error("429 quota exceeded");
  }),
}));

const { parseResumeFile } = await import("@/lib/resume/parse");

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => errorSpy.mockRestore());

/** A resume whose skills heading the parser does not recognise. */
const UNPARSEABLE_SKILLS = Buffer.from(
  ["Ada Lovelace", "ada@example.com", "", "Experience", "PM", "Co", "Did things"].join("\n"),
  "utf8",
);

describe("when the LLM fallback fails", () => {
  it("still returns the heuristic parse rather than failing the upload", async () => {
    const result = await parseResumeFile(UNPARSEABLE_SKILLS, "text/plain");
    expect(result.confidence).toBe("low");
    expect(result.usedFallback).toBe(false);
    expect(result.resume.contact.email).toBe("ada@example.com");
  });

  it("logs the failure instead of swallowing it", async () => {
    await parseResumeFile(UNPARSEABLE_SKILLS, "text/plain");

    const logged = errorSpy.mock.calls.find((c: unknown[]) => String(c[0]).includes("[resume-parse]"));
    expect(logged, "a discarded LLM failure leaves no way to know it happened").toBeDefined();

    /*
     * The underlying error must reach the log, not just a generic message —
     * "429 quota exceeded" is the difference between a known cause and a
     * shrug. Asserted on the Error itself rather than a serialisation of the
     * call: JSON.stringify(new Error("x")) is "{}", so a stringify-based
     * check here would have passed whether or not the error was ever passed.
     */
    expect((logged?.[2] as Error | undefined)?.message).toContain("quota exceeded");
  });

  it("records how degraded the stored parse actually is", async () => {
    // Without these counts the log says something failed but not how badly,
    // and an empty skills array is the specific condition worth alerting on.
    await parseResumeFile(UNPARSEABLE_SKILLS, "text/plain");
    const logged = errorSpy.mock.calls.find((c: unknown[]) => String(c[0]).includes("[resume-parse]"));
    expect(logged?.[1]).toMatchObject({ skills: 0 });
  });
});
