/**
 * rewriteBullet had zero test coverage before this — added alongside the
 * decision to rewrite a role's WHOLE set of bullets at once rather than
 * one line at a time (resume-editor.tsx has no per-line focus tracking to
 * know which line to target, and this matches what the button already did
 * before an entry could hold more than one bullet).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const askFarah = vi.fn();
vi.mock("@/lib/farah/client", () => ({ askFarah: (...args: unknown[]) => askFarah(...args) }));

const { rewriteBullet } = await import("@/lib/farah/rewrite-bullet");

describe("rewriteBullet", () => {
  beforeEach(() => {
    askFarah.mockClear();
  });

  it("a single-line bullet uses the original single-bullet prompt and token budget, unchanged", async () => {
    askFarah.mockResolvedValueOnce('"Led a cross-functional team of 5."');

    const result = await rewriteBullet("Led a team.", "impact");

    expect(result).toBe("Led a cross-functional team of 5.");
    const [prompt, maxTokens] = askFarah.mock.calls[0];
    expect(prompt).toContain('Original bullet: "Led a team."');
    expect(prompt).not.toContain("Original bullets:");
    expect(maxTokens).toBe(256);
  });

  it("multiple lines are rewritten as a set, not merged into one bullet", async () => {
    askFarah.mockResolvedValueOnce("Shipped the payments API serving 50k users.\nCut deploy time from 40m to 8m.");

    const result = await rewriteBullet("Shipped the payments API.\nCut deploy time.", "quantify");

    expect(result).toBe("Shipped the payments API serving 50k users.\nCut deploy time from 40m to 8m.");
    const [prompt, maxTokens] = askFarah.mock.calls[0];
    expect(prompt).toContain("Original bullets:");
    expect(prompt).toContain("- Shipped the payments API.");
    expect(prompt).toContain("- Cut deploy time.");
    expect(prompt).toContain("keep them as separate points");
    expect(prompt).toContain("no numbering, no bullet markers");
    expect(maxTokens).toBe(320); // 2 lines * 160
  });

  it("blank lines between real bullets are dropped before building the prompt", async () => {
    askFarah.mockResolvedValueOnce("A.\nB.");

    await rewriteBullet("First point.\n\n  \nSecond point.", "concise");

    const [prompt] = askFarah.mock.calls[0];
    expect(prompt).toContain("- First point.\n- Second point.");
  });

  it("caps the token budget rather than scaling unbounded with many bullets", async () => {
    askFarah.mockResolvedValueOnce("rewritten");
    const eightLines = Array.from({ length: 8 }, (_, i) => `Point ${i + 1}.`).join("\n");

    await rewriteBullet(eightLines, "impact");

    const [, maxTokens] = askFarah.mock.calls[0];
    expect(maxTokens).toBe(960); // capped at 6 lines * 160, not 8 * 160
  });

  it("strips wrapping quotes from the response the same way for single and multi-line results", async () => {
    askFarah.mockResolvedValueOnce('"Quoted line one.\nQuoted line two."');

    const result = await rewriteBullet("One.\nTwo.", "impact");

    expect(result).toBe("Quoted line one.\nQuoted line two.");
  });
});
