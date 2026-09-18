import { describe, it, expect } from "vitest";
import { markdownToDoc, docToMarkdown } from "@/lib/employer/markdown-editor/document";
import { renderJobDescriptionMarkdown } from "@/lib/farah/render-markdown";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * send-367 — the single most important test this feature has: an existing
 * posting's stored string, loaded into the editor and saved with NO edits,
 * must not silently change. A regression here means the first time an
 * employer re-opens a real posting in Edit and hits Save, their description
 * changes underneath them.
 *
 * Four DOCUMENTED, non-semantic normalizations apply on any round trip
 * through this editor (see document.ts's own header for why each is safe
 * and why it's four, not zero): CRLF/CR line endings become LF; `_italic_`
 * re-emits as `*italic*`; multiple consecutive blank lines between blocks
 * collapse to exactly one; leading/trailing whitespace at a block's own
 * edges is stripped (a real, if accidental, one-space example of this
 * exists in real production data — the Senior Product Manager fixture
 * below — and it round-trips one space shorter on purpose). `normalize()`
 * below applies exactly these four to BOTH sides of every comparison —
 * nothing else. A real behavioural drift would still show up as a
 * mismatch after normalization; only the four named exceptions do not.
 */
function normalize(markdown: string): string {
  return markdown
    .replace(/\r\n|\r/g, "\n")
    .replace(/_(.+?)_/g, "*$1*")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/^[ \t]+/gm, "");
}

function roundTrip(markdown: string): string {
  return docToMarkdown(markdownToDoc(markdown));
}

describe("markdown editor round-trip: real production descriptions", () => {
  /**
   * Pulled directly from production (`nytwbbzfpytctjsoczzq`, `job_postings`,
   * `source_type = 'internal'`) via the Supabase MCP connector on
   * 2026-09-18 — the only 3 internal (employer-authored, therefore
   * EDITABLE through this form) postings that exist. Real `\r\n` line
   * endings and a real, unedited multi-line caption block (no blank line
   * before the following bulleted list) preserved verbatim, because that
   * exact shape is what caught the "always join blocks with a blank line"
   * bug during development — see document.ts's `tight` tracking.
   */
  const FABRICATOR = [
    "A Fabricator\r\nLocation: Lagos, Nigeria\r\nType: Full-Time\r\nSalary: ₦250,000 per month\r\n",
    "\r\nWe are hiring skilled and experienced Fabricators to join our client’s steel manufacturing operations.\r\nThe ideal candidate should have strong hands-on experience in steel fabrication, welding, and assembly, with the ability to work accurately and safely in a factory environment.\r\n",
    "\r\nWhat You’ll Do\r\n* Read and interpret technical drawings, measurements, and fabrication specifications\r\n* ⁠Measure, mark, and cut steel materials accurately\r\n* ⁠Fabricate, weld, and assemble steel components and structures\r\n\r\n",
    "🚫 Not for candidates without practical steel fabrication and welding experience\r\n✅ Apply only if you have strong hands-on fabrication skills and can work safely and efficiently in a manufacturing environment\r\n\r\nTo Apply, send your CV to hr.orvalondigital@gmail.com",
  ].join("");

  const SENIOR_PM = [
    "We're hiring a Senior Product Manager\r\n\r\n",
    "Let's be honest about what this job actually is: you're going to own a product area from \"here's a messy problem\" all the way to \"here's a shipped feature people actually use.\" Strategy, discovery, building it, launching it, then obsessing over the numbers until it's genuinely great. No handing off the hard parts to someone else. It's yours.\r\n\r\n",
    "Here's the non-negotiable bit: you need real experience in cross-border payments and remittances. Not \"I read about it once.\" Actual hands-on time in the trenches. \r\n\r\n",
    "Here's what we need you to bring:\r\n5+ years of product management experience, with strong experience in fintech and payments.\r\nProven experience managing fintech/payment products from ideation to launch and scale.\r\nExperience in cross-border payments and remittances is mandatory.\r\n\r\n",
    "How to apply: https://lnkd.in/e_ZuGXSQ\r\nDeadline: September 15, 2026\r\nOnly shortlisted candidates will be contacted.",
  ].join("");

  it("Fabricator posting round-trips (normalized: CRLF, blank-line-count)", () => {
    const output = roundTrip(FABRICATOR);
    expect(normalize(output)).toBe(normalize(FABRICATOR));
  });

  it("Senior Product Manager posting round-trips, including the bare URL", () => {
    const output = roundTrip(SENIOR_PM);
    expect(normalize(output)).toBe(normalize(SENIOR_PM));
    expect(output).toContain("https://lnkd.in/e_ZuGXSQ");
  });

  it("a real production listing's own bare-URL line renders exactly as it does today after round-tripping", () => {
    const output = roundTrip(SENIOR_PM);
    const html = renderToStaticMarkup(renderJobDescriptionMarkdown(output) as React.ReactElement);
    expect(html).toContain('href="https://lnkd.in/e_ZuGXSQ"');
  });

  it("the tight (no blank line) caption-then-list shape survives exactly", () => {
    // "What You'll Do" immediately followed by a bulleted list, no blank
    // line — the real shape found in the Fabricator posting, isolated.
    const md = "What You'll Do\n* Read drawings\n* Cut steel";
    expect(roundTrip(md)).toBe(md);
  });
});

describe("markdown editor round-trip: every construct, hand-written", () => {
  const CASES: Array<[string, string]> = [
    ["plain paragraph", "Just a plain sentence with nothing special in it."],
    ["bold", "This is **bold text** in a sentence."],
    ["italic (canonical marker)", "This is *italic text* in a sentence."],
    ["bold and italic in the same paragraph", "A **bold** word and an *italic* word together."],
    ["heading level 1", "# A top-level heading"],
    ["heading level 2", "## A second-level heading"],
    ["heading level 3", "### A third-level heading"],
    ["heading level 6", "###### A sixth-level heading"],
    ["unordered list", "- First item\n- Second item\n- Third item"],
    ["unordered list, asterisk marker", "* First item\n* Second item"],
    ["ordered list", "1. First step\n2. Second step\n3. Third step"],
    ["horizontal rule, exactly 3 dashes", "Above the rule.\n\n---\n\nBelow the rule."],
    ["horizontal rule, longer dash run", "Above.\n\n----------\n\nBelow."],
    ["single-line blockquote", "> A quoted line of text."],
    ["multi-line blockquote", "> First quoted line\n> Second quoted line"],
    ["bare URL autolinks and round-trips", "Read more at https://example.com/path?query=1 for details."],
    [
      "two paragraphs separated by one blank line",
      "First paragraph here.\n\nSecond paragraph here.",
    ],
    [
      "a multi-line paragraph with no blank line internally (soft-wrapped)",
      "Line one of the same paragraph\nLine two of the same paragraph",
    ],
    [
      "every construct in one document",
      [
        "# Senior Widget Engineer",
        "",
        "We build **widgets** that are *genuinely* delightful.",
        "",
        "## Responsibilities",
        "- Design widgets",
        "- Ship widgets",
        "- Support widgets",
        "",
        "## Requirements",
        "1. 3+ years of widget experience",
        "2. A portfolio of shipped widgets",
        "",
        "> \"Best widget team I've worked with.\" — a candid reference",
        "",
        "---",
        "",
        "Apply at https://widgets.example.com/careers today.",
      ].join("\n"),
    ],
  ];

  it.each(CASES)("%s", (_label, markdown) => {
    expect(roundTrip(markdown)).toBe(markdown);
  });

  it("an empty description deserializes and re-serializes to an empty string", () => {
    expect(roundTrip("")).toBe("");
  });
});
