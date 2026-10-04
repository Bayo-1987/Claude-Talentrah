/**
 * S1-56 PR 1a — the feedback message box is the shared TextArea, and the client counter and the server agree.
 *
 * Pinned here: the box keeps its id, name, label, placeholder and `required` (so the e2e selector and the action's payload do not
 * change); it shows "N / 5000" and stops typing at 5000 (a hard cap); and the server's zod schema counts exactly the way the
 * counter does (trimmed), with its original error text. The minimum of 10 is untouched.
 */
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FIELD_LIMITS, fitsLimit } from "@/lib/text-limits";
import { feedbackSchema } from "@/lib/feedback/schemas";

vi.mock("@/lib/feedback/actions", () => ({ submitFeedbackAction: async () => ({ status: "idle", error: null }) }));

const { FeedbackForm } = await import("@/app/(app)/feedback/feedback-form");

const markup = () => renderToStaticMarkup(createElement(FeedbackForm, { pagePath: "/jobs" }));
const box = (html: string) => /<textarea\b[^>]*>/.exec(html)![0];

describe("the feedback message box", () => {
  it("keeps the id, name, label text, placeholder and required that the form always had", () => {
    const html = markup();
    const t = box(html);
    expect(t).toContain('id="message"');
    expect(t).toContain('name="message"');
    expect(t).toMatch(/\brequired\b/);
    expect(t).toContain('placeholder="The more specific, the more useful');
    expect(html).toMatch(/<label[^>]*for="message"[^>]*>Tell us what happened<\/label>/);
  });

  it("is a writing box of at least 7 rows (the old rows) with a resize handle", () => {
    const t = box(markup());
    expect(t).toContain('rows="7"');
    expect(t).toContain("resize-y");
  });

  it("shows the counter and enforces the cap with the browser's own maxLength (a hard limit)", () => {
    const html = markup();
    expect(html).toContain(`0 / ${FIELD_LIMITS.feedbackMessage}`);
    expect(box(html)).toContain(`maxLength="${FIELD_LIMITS.feedbackMessage}"`);
  });

  it("still sends the hidden page path and the category field alongside the message", () => {
    const html = markup();
    expect(html).toMatch(/<input[^>]*type="hidden"[^>]*name="pagePath"[^>]*value="\/jobs"/);
    expect(html).toMatch(/name="category"/);
  });
});

describe("the server's cap is the client's cap", () => {
  const parse = (message: string) => feedbackSchema.safeParse({ category: "bug", message, pagePath: null });

  it("the schema allows exactly the limit and refuses one more, with the original wording", () => {
    expect(parse("x".repeat(FIELD_LIMITS.feedbackMessage)).success).toBe(true);
    const over = parse("x".repeat(FIELD_LIMITS.feedbackMessage + 1));
    expect(over.success).toBe(false);
    if (!over.success) expect(over.error.issues[0].message).toBe("That's longer than we can store — trim it to 5,000 characters");
  });

  it("counts trimmed, the way the counter does: surrounding spaces do not count toward the cap", () => {
    expect(parse(`  ${"x".repeat(FIELD_LIMITS.feedbackMessage)}  `).success).toBe(true);
  });

  it("counts a CRLF line break (what a real form post sends) as ONE character, like the box", () => {
    const atCap = Array.from({ length: 2500 }, () => "a").join("\r\n"); // 4999 counted: 2500 lines of "a" and 2499 breaks
    expect(atCap.length).toBeGreaterThan(FIELD_LIMITS.feedbackMessage);
    const exactly = `${atCap}x`; // 5000 counted
    expect(parse(exactly).success).toBe(true);
    const over = parse(`${exactly}x`); // 5001 counted
    expect(over.success).toBe(false);
    if (!over.success) expect(over.error.issues[0].message).toBe("That's longer than we can store — trim it to 5,000 characters");
  });

  it("agrees with fitsLimit on both sides of the boundary", () => {
    for (const n of [FIELD_LIMITS.feedbackMessage - 1, FIELD_LIMITS.feedbackMessage, FIELD_LIMITS.feedbackMessage + 1]) {
      const text = "y".repeat(n);
      expect(parse(text).success, `length ${n}`).toBe(fitsLimit(text, FIELD_LIMITS.feedbackMessage));
    }
  });

  it("keeps the minimum of 10", () => {
    const short = parse("too short");
    expect(short.success).toBe(false);
    if (!short.success) expect(short.error.issues[0].message).toBe("Give us a bit more to go on (at least 10 characters)");
    expect(parse("exactly 10").success).toBe(true);
  });
});
