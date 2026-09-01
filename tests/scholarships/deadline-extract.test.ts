import { describe, expect, it } from "vitest";
import { extractDeadlineCandidates, htmlToText } from "@/lib/scholarships/deadline-extract";

/**
 * The extractor feeding the daily deadline recheck. The rule it enforces
 * upstream: act only on EXACTLY ONE plausible date — so what these tests pin
 * hardest is what does NOT count as a candidate: dates far from any deadline
 * keyword, dates in the past, malformed dates, and dates inside scripts.
 *
 * The fixtures mirror the real pages' phrasings as found on 2026-09-01
 * (Chevening: "until 6 October 2026, at 11:00 (UTC)"; Knight-Hennessy: "The
 * application closes on October 6, 2026"), so if a provider's phrasing drifts,
 * updating a fixture here is the record of that drift.
 */

const TODAY = "2026-09-01";

describe("date formats near a deadline keyword", () => {
  it('reads "6 October 2026" (Chevening phrasing)', () => {
    const html = "<p>Open for applications until 6 October 2026, at 11:00 (UTC)</p>";
    expect(extractDeadlineCandidates(html, TODAY)).toEqual(["2026-10-06"]);
  });

  it('reads "October 6, 2026" (Knight-Hennessy phrasing)', () => {
    const html = "<p>The application closes on October 6, 2026, at 1 pm, Pacific Time.</p>";
    expect(extractDeadlineCandidates(html, TODAY)).toEqual(["2026-10-06"]);
  });

  it('reads ordinals: "8th December 2026"', () => {
    const html = "<td>Application deadline</td><td>Tuesday 8th December 2026</td>";
    expect(extractDeadlineCandidates(html, TODAY)).toEqual(["2026-12-08"]);
  });

  it("reads ISO dates", () => {
    const html = "<span>Applications close 2026-10-20.</span>";
    expect(extractDeadlineCandidates(html, TODAY)).toEqual(["2026-10-20"]);
  });

  it("collapses the same date in two formats to one candidate", () => {
    const html =
      "<p>Deadline: 20 October 2026.</p><p>Submit by 2026-10-20 or your application closes.</p>";
    expect(extractDeadlineCandidates(html, TODAY)).toEqual(["2026-10-20"]);
  });
});

describe("what must NOT count", () => {
  it("a date with no deadline keyword anywhere near it", () => {
    const html = "<p>The programme was founded on 6 October 2000 and thrives today.</p>";
    expect(extractDeadlineCandidates(html, TODAY)).toEqual([]);
  });

  it("a past date, even next to a keyword — last cycle's page must not re-verify", () => {
    const html = "<p>Applications closed on 8 January 2026.</p>";
    expect(extractDeadlineCandidates(html, TODAY)).toEqual([]);
  });

  it("an impossible date does not roll over into a real one", () => {
    // 31 February would become 2/3 March through Date rollover; reject instead.
    const html = "<p>Deadline: 31 February 2027.</p>";
    expect(extractDeadlineCandidates(html, TODAY)).toEqual([]);
  });

  it("dates inside script tags are stripped before matching", () => {
    const html =
      '<script>var closes = "25 December 2026"; // deadline config</script><p>No dates in prose.</p>';
    expect(extractDeadlineCandidates(html, TODAY)).toEqual([]);
  });

  it("several distinct future deadlines all come back — the caller's ambiguity rule needs them", () => {
    const html =
      "<p>US round deadline: October 14, 2026. International round closes 8 December 2026 or 6 January 2027.</p>";
    expect(extractDeadlineCandidates(html, TODAY)).toEqual([
      "2026-10-14",
      "2026-12-08",
      "2027-01-06",
    ]);
  });
});

describe("htmlToText", () => {
  it("strips tags, scripts, styles and collapses whitespace", () => {
    const html =
      "<style>p{color:red}</style><div><p>Apply   by</p><script>x()</script><b>20 October 2026</b></div>";
    expect(htmlToText(html)).toBe("Apply by 20 October 2026");
  });
});
