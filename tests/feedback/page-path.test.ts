/**
 * `page_path` is the only attacker-controlled value that reaches the feedback
 * table, so its validation is the only interesting logic in the flow.
 *
 * The threat is small but real and easy to get wrong. Whoever eventually reads
 * this table — today, an operator running SQL — reads `page_path` as text and
 * as OURS. A row saying "https://evil.example/verify-your-account" in a column
 * named page_path is a link that looks like it came from the product. The
 * value arrives twice, once as `?from=` on the URL and once as a hidden form
 * field, and neither is trustworthy.
 *
 * Two properties, and the second is the one that would get lost in a rewrite:
 *
 *   1. Only a same-origin absolute path survives. A scheme, or the
 *      protocol-relative `//host` form which browsers resolve OFF-SITE, must
 *      not.
 *   2. A bad value is DROPPED, never rejected. Feedback is the thing we want;
 *      a mangled link in the URL bar must cost the context field and never the
 *      person's message. `.catch(null)` is doing that, and swapping it for a
 *      plain refine would turn a cosmetic problem into a failed submission.
 */
import { describe, expect, it } from "vitest";
import { feedbackSchema, FEEDBACK_CATEGORIES } from "@/lib/feedback/schemas";

const pagePath = feedbackSchema.shape.pagePath;
const parse = (v: unknown) => pagePath.parse(v);

describe("a path we recognise is kept", () => {
  it.each(["/jobs", "/tracker", "/jobs?tab=saved", "/resume-builder/edit"])("keeps %j", (v) => {
    expect(parse(v)).toBe(v);
  });

  it("keeps nothing as nothing", () => {
    expect(parse(null)).toBeNull();
  });
});

describe("anything that could point off-site is dropped", () => {
  it.each([
    ["an absolute URL", "https://evil.example/pay"],
    ["a bare scheme", "javascript:alert(1)"],
    ["a protocol-relative path — the one that looks local and is not", "//evil.example/jobs"],
    ["a relative path with no leading slash", "jobs"],
    ["an empty string", ""],
    ["a non-string", 42],
  ])("drops %s", (_label, value) => {
    expect(parse(value)).toBeNull();
  });

  it("drops rather than throws, so a bad link never costs the feedback", () => {
    const result = feedbackSchema.safeParse({
      category: "bug",
      message: "The export button produced a blank PDF twice in a row.",
      pagePath: "https://evil.example/pay",
    });
    expect(result.success).toBe(true);
    expect(result.data!.pagePath).toBeNull();
    expect(result.data!.message).toContain("blank PDF");
  });
});

describe("the rest of the form", () => {
  it("refuses a message too short to act on", () => {
    const r = feedbackSchema.safeParse({ category: "bug", message: "broken", pagePath: null });
    expect(r.success).toBe(false);
  });

  it("refuses a category outside the three the column allows", () => {
    const r = feedbackSchema.safeParse({
      category: "urgent",
      message: "A perfectly reasonable length of message goes here.",
      pagePath: null,
    });
    expect(r.success).toBe(false);
  });

  it("offers exactly the three enum values the database has, and no others", () => {
    // A fourth option in the picker would be a runtime insert failure, not a
    // type error: the value only meets the enum at the database.
    expect(FEEDBACK_CATEGORIES.map((c) => c.value)).toEqual(["bug", "idea", "other"]);
  });

  it("shows a label, not the column value", () => {
    for (const c of FEEDBACK_CATEGORIES) expect(c.label).not.toBe(c.value);
  });
});
