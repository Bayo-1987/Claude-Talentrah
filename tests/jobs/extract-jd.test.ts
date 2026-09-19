/**
 * extractStructuredJd's skill extraction (src/lib/jobs/extract-jd.ts) —
 * Stage 8's vocabulary expansion.
 *
 * The board this feeds is occupationally diverse (trades, hospitality,
 * franchise operators, NGO field roles, agriculture — not just tech/product),
 * and the original 48-term vocabulary structurally could not see most of it.
 * Every new term here was found by real document-frequency measurement
 * against 184 real "thin" production postings — see SKILL_VOCABULARY's own
 * header comment for the numbers. These tests exist so a short term like
 * "pos" or "aml" can never silently start matching a substring of an
 * unrelated word, which is exactly the failure mode a naive `.includes()`
 * would have and `\b` word-boundary matching exists to prevent.
 */
import { describe, expect, it } from "vitest";
import {
  extractStructuredJd,
  SKILL_VOCABULARY,
  NON_SCREENABLE_SKILLS,
  stripHtml,
  stripMarkdownToPlainText,
} from "@/lib/jobs/extract-jd";

describe("Stage 8 additions extract real, distinct terms", () => {
  it.each([
    ["pos", "Experience with POS reconciliation is required."],
    ["crm", "You will manage our CRM and update customer records daily."],
    ["quality assurance", "Own quality assurance for every release."],
    ["agriculture", "5+ years of experience in agriculture extension services."],
    ["procurement", "Lead procurement for all field office supplies."],
    ["reconciliation", "Daily reconciliation of till and POS records."],
    ["google sheets", "Comfortable building trackers in Google Sheets."],
    ["microsoft office", "Proficiency in Microsoft Office is required."],
    ["credit risk", "Assess credit risk for new loan applicants."],
    ["sabre", "Must be certified in Sabre and Amadeus."],
    ["amadeus", "Must be certified in Sabre and Amadeus."],
    ["travelport", "Experience with Travelport is a plus."],
    ["budgeting", "Own budgeting and forecasting for the department."],
    ["powerpoint", "Build client decks in PowerPoint."],
    ["haccp", "Certified in HACCP food safety standards."],
    ["fraud detection", "Support fraud detection and investigation."],
    ["food safety", "Ensure food safety compliance across kitchens."],
    ["kyc", "Run KYC checks on new business accounts."],
    ["aml", "Familiarity with AML regulations is required."],
    ["agronomy", "A background in agronomy or crop science."],
    ["vendor management", "Own vendor management for regional suppliers."],
    ["fleet management", "Oversee fleet management for the logistics team."],
  ])("extracts %j from real posting language", (term, text) => {
    expect(extractStructuredJd(text).skills).toContain(term);
  });
});

describe("SABOTAGE-PROOF TARGET: short new terms do not match inside unrelated words", () => {
  it("'pos' does not match inside 'position', 'purpose', or 'compose'", () => {
    const text =
      "This position requires you to compose reports whose purpose is executive review.";
    expect(extractStructuredJd(text).skills).not.toContain("pos");
  });

  it("'crm' does not match inside a longer unrelated token", () => {
    expect(extractStructuredJd("acrmony is not a word, but this checks it anyway").skills).not.toContain(
      "crm",
    );
  });

  it("'aml' does not match inside 'family' or 'example'", () => {
    const text = "For example, this role suits a family-oriented candidate.";
    expect(extractStructuredJd(text).skills).not.toContain("aml");
  });

  it("'sap' is deliberately NOT in the vocabulary yet — too rare on this board to add", () => {
    // Documents a real decision, not a gap: see SKILL_VOCABULARY's own
    // header for why "sap" was measured (7/184) and left out at this pass.
    expect(SKILL_VOCABULARY).not.toContain("sap");
  });
});

describe("nothing added here was accidentally marked non-screenable", () => {
  const added = [
    "pos", "crm", "quality assurance", "agriculture", "procurement", "reconciliation",
    "google sheets", "microsoft office", "credit risk", "sabre", "budgeting", "powerpoint",
    "haccp", "fraud detection", "food safety", "kyc", "aml", "agronomy", "amadeus",
    "travelport", "vendor management", "fleet management",
  ];

  it.each(added)("%s is screenable (not in NON_SCREENABLE_SKILLS)", (term) => {
    expect(NON_SCREENABLE_SKILLS.has(term)).toBe(false);
  });
});

/**
 * stripHtml — screenshot-confirmed against the same job's Greenhouse source:
 * Greenhouse shows real bold sub-headers and tight, consistent bullet
 * spacing; this page showed plain unstyled text and a full blank line
 * between every bullet. Two compounding causes, both fixed here: every tag
 * but `<li>`/`<br>`/`</p>` (including `<strong>`/`<b>`) became a bare space,
 * and Greenhouse's own list markup (real whitespace between tags, and
 * sometimes an inner `<p>` per `<li>`) stacked two newlines between
 * consecutive bullets — exactly two, which the old `\n{3,} -> \n\n` collapse
 * does not catch.
 */
describe("stripHtml preserves structure instead of destroying it", () => {
  it("SABOTAGE-PROOF TARGET: a <li><p>text</p></li> source produces one bullet line with no blank line before the next bullet", () => {
    const html = "<ul><li><p>First item</p></li><li><p>Second item</p></li></ul>";
    expect(stripHtml(html)).toBe("- First item\n- Second item");
  });

  it("also collapses the blank line Greenhouse's own newline-formatted markup introduces between BARE <li> siblings (no inner <p>) — the actual shape of job 79a05392's own source", () => {
    const html =
      '<ul>\n<li style="font-weight: 400;">First item.</li>\n<li style="font-weight: 400;">Second item.</li>\n</ul>';
    expect(stripHtml(html)).toBe("- First item.\n- Second item.");
  });

  it("converts <strong>/<b> to markdown bold instead of deleting it to a bare space", () => {
    expect(stripHtml("<p><strong>Bold header</strong></p><p>Body text.</p>")).toBe(
      "**Bold header**\n\nBody text.",
    );
  });

  it("a paragraph break between two top-level paragraphs survives as a blank line, not a single line break", () => {
    // Necessary, not cosmetic: renderJobDescriptionMarkdown (render-markdown.tsx)
    // only starts a new paragraph BLOCK on a blank line — a single "\n" would
    // merge every paragraph in a posting into one.
    expect(stripHtml("<p>First.</p><p>Second.</p>")).toBe("First.\n\nSecond.");
  });

  it("SABOTAGE-PROOF TARGET: fully resolves the double-escaped '&amp;' this job actually shipped with, end to end through stripHtml", () => {
    const html = "<li><p><strong>Program &amp;amp; Curriculum Development</strong></p></li>";
    const out = stripHtml(html);
    expect(out).not.toContain("&amp;");
    expect(out).toContain("Program & Curriculum Development");
  });
});

describe("stripMarkdownToPlainText undoes what stripHtml produces, for consumers that never render markdown", () => {
  it("SABOTAGE-PROOF TARGET: a real stripHtml output shows as plain readable text, no literal ** or leading '- '", () => {
    const description = "**Program & Curriculum**\n- Led a team of 5";
    const out = stripMarkdownToPlainText(description);
    expect(out).not.toContain("**");
    expect(out).not.toMatch(/^-\s/m);
    expect(out).toBe("Program & Curriculum\nLed a team of 5");
  });

  it("strips a bold pair anywhere in the middle of a sentence, not just at the start", () => {
    expect(stripMarkdownToPlainText("Own the roadmap for **merchant payments** end to end.")).toBe(
      "Own the roadmap for merchant payments end to end.",
    );
  });

  it("strips multiple bullet lines, each independently", () => {
    const out = stripMarkdownToPlainText("- First point\n- Second point\n- Third point");
    expect(out).toBe("First point\nSecond point\nThird point");
  });

  it("leaves a genuine hyphen mid-sentence alone — only a leading '- ' at a line start is a bullet marker", () => {
    expect(stripMarkdownToPlainText("A well-structured, results-oriented team.")).toBe(
      "A well-structured, results-oriented team.",
    );
  });

  it("leaves plain text with no markdown syntax completely unchanged", () => {
    const plain = "Own the merchant payments dashboard used by 40,000+ SMB merchants.";
    expect(stripMarkdownToPlainText(plain)).toBe(plain);
  });

  /**
   * send-397: live-production regression, verified word for word against
   * https://claude-talentrah.vercel.app/jobs/remote on 2026-09-19 — the
   * "Site Reliability Engineer" (Moniepoint, Remote India) card there
   * literally rendered:
   *
   *   Location: India**Who We Are** Moniepoint Inc. is Africa's
   *   all-in-one financial platform...
   *
   * i.e. genuine, un-rendered `**` characters on screen — confirming the
   * bug is exactly as reported and distinct from send-382's
   * meta-description/JSON-LD fix (`plainDescription()`), which this
   * component never touches. The source posting's `<strong>Who We
   * Are</strong>` sits directly against "India" with no whitespace on that
   * side, while whitespace already exists on the OTHER side (before
   * "Moniepoint") — a one-sided boundary case, not a symmetric one. This
   * pins `stripMarkdownToPlainText`'s own contract directly: the OLD bare
   * `"$1"` replacement strips the `**` markers but glues "India" and "Who"
   * into one word with no separator ("IndiaWho We Are Moniepoint") — a
   * distinct, still-visible defect from the literal asterisks seen live,
   * but the same root cause (no boundary handling), and this is the
   * behaviour actually reachable by unit-testing the function in isolation.
   */
  it("send-397: inserts a word boundary when a bold pair has no whitespace on either side (the live Moniepoint case)", () => {
    const description =
      "Location: India**Who We Are** Moniepoint Inc. is Africa's all-in-one financial platform, helping 20 million businesses and individuals access seamless payments, banking, credit, cross-border, and business management tools each month.";
    const out = stripMarkdownToPlainText(description);
    expect(out).not.toContain("**");
    expect(out).not.toContain("IndiaWho");
    expect(out).toBe(
      "Location: India Who We Are Moniepoint Inc. is Africa's all-in-one financial platform, helping 20 million businesses and individuals access seamless payments, banking, credit, cross-border, and business management tools each month.",
    );
  });

  it("send-397: only adds a boundary space on the side that's actually missing one — a pair glued on one side and spaced on the other doesn't get a double space", () => {
    expect(stripMarkdownToPlainText("India**Who We Are** Moniepoint")).toBe("India Who We Are Moniepoint");
    expect(stripMarkdownToPlainText("India **Who We Are**Moniepoint")).toBe("India Who We Are Moniepoint");
  });

  it("send-397: a bold pair at the very start or end of the string only grows the boundary that actually needs it", () => {
    // No character before the opening "**" (start of string) — nothing to
    // separate from there, but "Moniepoint" still needs a space before it.
    expect(stripMarkdownToPlainText("**Who We Are**Moniepoint")).toBe("Who We Are Moniepoint");
    // No character after the closing "**" (end of string) — nothing to
    // separate from there, but "Moniepoint" still needs a space after it.
    expect(stripMarkdownToPlainText("Moniepoint**Who We Are**")).toBe("Moniepoint Who We Are");
  });

  /**
   * send-413: the ACTUAL originally-reported live artifact — literal,
   * visible "**" characters on screen — traced to the real raw
   * `description` of production job_postings id
   * 6d94d5dc-2caf-4864-ad05-2512e89e6fa0 (Moniepoint, "Site Reliability
   * Engineer", Remote India), pulled directly from the production Supabase
   * project on 2026-09-19: `**Location:** India******Who We Are**\n\n…` —
   * two bold markers glued together with no separating whitespace, forming
   * a run of six consecutive asterisks. send-397's own fixture two tests
   * above ("Location: India**Who We Are** Moniepoint…") was a simplified
   * two-star stand-in, verified by that session but not the literal
   * production text — this is the literal production text.
   *
   * Ruled out the alternative "location field joined against description
   * with no separator, at the CARD level" theory before writing this:
   * job-card.tsx renders `metaParts.join(" · ")` (which never includes
   * `location` bare — see WORK_TYPE_LABEL usage) in one <div> and the
   * stripped description in a separate, sibling <p> — two distinct DOM
   * nodes, never concatenated into one JS string. public-job-row.tsx (the
   * other consumer named in PR #499) does the same. So a join-point fix
   * would touch nothing real; the "Location: India" text seen live is part
   * of the raw JD body itself (that employer's own ad copy literally opens
   * with a "**Location:** <value>" line), not code-assembled — this
   * function is the only place that can fix it.
   *
   * Proved this test catches the bug: reverting just the `\*{2,}` collapse
   * line (keeping the send-397 boundary-space fix intact) reproduces
   * literal asterisks in the output — `"Location: India * *Who We Are …"` —
   * failing this assertion exactly as production did.
   */
  it("send-413: collapses a run of 3+ consecutive asterisks (two bold markers glued together) instead of leaving literal '*' behind", () => {
    const description =
      "**Location:** India******Who We Are**\n\nMoniepoint Inc. is Africa's all-in-one financial platform, helping 20 million businesses and individuals access seamless payments, banking, credit, cross-border, and business management tools each month.";
    const out = stripMarkdownToPlainText(description);
    expect(out).not.toContain("*");
    expect(out).toBe(
      "Location: India Who We Are\n\nMoniepoint Inc. is Africa's all-in-one financial platform, helping 20 million businesses and individuals access seamless payments, banking, credit, cross-border, and business management tools each month.",
    );
  });

  it("send-413: a well-formed, correctly-spaced bold pair is unaffected by the run-collapse", () => {
    expect(stripMarkdownToPlainText("Own the roadmap for **merchant payments** end to end.")).toBe(
      "Own the roadmap for merchant payments end to end.",
    );
  });
});
