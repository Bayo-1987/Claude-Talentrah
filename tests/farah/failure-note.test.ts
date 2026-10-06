/**
 * The note added when Farah's reply FAILS: in plain words, that the reply didn't go through and that nothing was charged. It is for what the server reports as a failed call (a rate limit, an error, a failure
 * partway through the stream), which the route's charge-after-success rule proves cost nothing; it is deliberately NOT for a dropped connection, where the server may have finished and charged. This pins the wording
 * and the function. WHERE the panel shows it is the panel's business (it calls withNothingChargedNote; it does not word the note itself).
 */
import { describe, expect, it } from "vitest";
import { withNothingChargedNote, NOTHING_CHARGED_NOTE } from "@/lib/farah/failure-note";
import { GENERIC_FARAH_UNAVAILABLE_MESSAGE, farahRateLimitMessage } from "@/lib/farah/rate-limit-message";

describe("the note on a failed reply", () => {
  it("a rate limit (the server's own wait-time wording): the note follows it", () => {
    const m = farahRateLimitMessage("Please try again in 12m45.504s.");
    expect(withNothingChargedNote(m)).toBe(`${m} ${NOTHING_CHARGED_NOTE}`);
  });
  it("an error (the generic wording): the note follows it", () => {
    expect(withNothingChargedNote(GENERIC_FARAH_UNAVAILABLE_MESSAGE)).toBe(`${GENERIC_FARAH_UNAVAILABLE_MESSAGE} ${NOTHING_CHARGED_NOTE}`);
  });
  it("a failure partway through the stream is the same error event, so the same wording", () => {
    expect(withNothingChargedNote(GENERIC_FARAH_UNAVAILABLE_MESSAGE)).toContain("didn't go through");
    expect(withNothingChargedNote(GENERIC_FARAH_UNAVAILABLE_MESSAGE)).toContain("nothing was charged");
  });
  it("a message that already says nothing was charged is not told twice", () => {
    const busy = "Farah is busy right now. Please try again in a few minutes. You haven't been charged for this message.";
    expect(withNothingChargedNote(busy)).toBe(busy);
  });
  it("no message from the server: a plain default, with the note", () => {
    expect(withNothingChargedNote(undefined)).toBe(`Something went wrong — try again. ${NOTHING_CHARGED_NOTE}`);
  });
  it("the note says both things in plain words and names no provider, tokens or quota", () => {
    expect(NOTHING_CHARGED_NOTE).toMatch(/reply didn't go through/);
    expect(NOTHING_CHARGED_NOTE).toMatch(/nothing was charged/);
    expect(NOTHING_CHARGED_NOTE).not.toMatch(/groq|gemini|token|quota/i);
  });
});
