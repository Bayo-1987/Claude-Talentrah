/**
 * decodeHtmlEntities (src/lib/jobs/extract-jd.ts) — the double-escaping gap.
 *
 * Found live: a real posting's JD text rendered "monitoring, evaluation
 * &amp; learning" verbatim in the /tailor JD box instead of "monitoring,
 * evaluation & learning". A single pass of `.replace(/&amp;/g, "&")` only
 * unwraps ONE layer of escaping — `&amp;amp;` becomes `&amp;`, not `&`,
 * because `String.replace` with `/g` finds every match in the ORIGINAL
 * string in one pass and never rescans its own output. Looping the same
 * six replacements until a pass changes nothing closes this for any depth
 * of repeated escaping, not just the one layer this incident happened to
 * have.
 */
import { describe, expect, it } from "vitest";
import { decodeHtmlEntities, stripHtml } from "@/lib/jobs/extract-jd";

describe("decodeHtmlEntities", () => {
  it("decodes a single layer of escaping, the common case", () => {
    expect(decodeHtmlEntities("monitoring, evaluation &amp; learning")).toBe(
      "monitoring, evaluation & learning",
    );
  });

  it("decodes a double-escaped ampersand — the exact bug found live", () => {
    expect(decodeHtmlEntities("monitoring, evaluation &amp;amp; learning")).toBe(
      "monitoring, evaluation & learning",
    );
  });

  it("decodes triple-escaping too — the fix is depth-independent, not a special case for two layers", () => {
    expect(decodeHtmlEntities("Terms &amp;amp;amp; Conditions")).toBe("Terms & Conditions");
  });

  it("still handles cross-entity double-escaping (&amp;nbsp; for a literal &nbsp;)", () => {
    // This case already worked before the fix — confirms the loop didn't
    // regress the one case the original single-pass comment was written for.
    expect(decodeHtmlEntities("A&amp;nbsp;B")).toBe("A B");
  });

  it("leaves plain text with no entities untouched", () => {
    expect(decodeHtmlEntities("Nothing to decode here.")).toBe("Nothing to decode here.");
  });

  it("does not loop forever on input containing a literal, un-escapable ampersand", () => {
    // A real "&" with no entity around it must reach a fixed point immediately
    // rather than the loop somehow never terminating.
    expect(decodeHtmlEntities("Ben & Jerry's")).toBe("Ben & Jerry's");
  });
});

describe("stripHtml still decodes correctly end to end", () => {
  it("strips tags and fully decodes a double-escaped ampersand in the same pass", () => {
    expect(stripHtml("<p>Monitoring, Evaluation &amp;amp; Learning</p>")).toBe(
      "Monitoring, Evaluation & Learning",
    );
  });
});
