/**
 * #704 — reviewer-addressed commentary must never sit in a column an applicant can read. ONE definition of the trigger phrases and of the public text columns
 * (src/lib/scholarships/reviewer-commentary.ts) feeds the approval guard, the source-config test and the data-fix query; this file pins that definition.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CHECKED_PUBLIC_TEXT_COLUMNS,
  EXCLUDED_PUBLIC_TEXT_COLUMNS,
  REVIEWER_PHRASES,
  findReviewerCommentary,
  normaliseForCheck,
  phraseRegex,
  reviewerCommentaryCountsQuery,
} from "@/lib/scholarships/reviewer-commentary";
import { PUBLIC_COLUMNS } from "@/lib/scholarships/public";
import { SEED_SCHOLARSHIPS } from "@/lib/scholarships/sources.config";
import { EXAMPLE_COMMENTARY_ROW, LEGITIMATE_CORPUS, PHRASE_TO_FIELD } from "../support/scholarship-commentary-fixture";

describe("the trigger list", () => {
  it("is exactly the five specific reviewer phrases (no stand-alone 'this pass' or 'before publishing')", () => {
    expect([...REVIEWER_PHRASES].sort()).toEqual(
      ["a human should", "needs a human to confirm", "not independently confirmed", "not machine-verified", "see moderation_note"].sort(),
    );
  });

  it("normalises curly quotes, non-breaking hyphens and runs of whitespace the same way everywhere", () => {
    expect(normaliseForCheck("A  human\n should “open”   it")).toBe('a human should "open" it');
    expect(normaliseForCheck("Not machine‑verified")).toBe("not machine-verified");
  });
});

describe("findReviewerCommentary", () => {
  it("flags the synthetic Example University fixture, naming the column and the phrase for each shape", () => {
    const found = findReviewerCommentary(EXAMPLE_COMMENTARY_ROW);
    for (const [phrase, column] of Object.entries(PHRASE_TO_FIELD)) {
      expect(found, `${phrase} in ${column}`).toContainEqual({ column, phrase });
    }
    expect(found).toHaveLength(Object.keys(PHRASE_TO_FIELD).length);
  });

  it("passes the whole corpus of legitimate text, including the provenance wording", () => {
    for (const { column, text } of LEGITIMATE_CORPUS) {
      expect(findReviewerCommentary({ [column]: text }), `${column}: ${text}`).toEqual([]);
    }
  });

  it("reads array columns too (a remark inside one tag is still public)", () => {
    expect(findReviewerCommentary({ field_tags: ["engineering", "needs a human to confirm"] })).toEqual([
      { column: "field_tags", phrase: "needs a human to confirm" },
    ]);
  });

  it("ignores columns that are not public text (the review note is the one place commentary belongs)", () => {
    expect(findReviewerCommentary({ moderation_note: "A human should open the link." })).toEqual([]);
  });

  it.each(Object.entries(PHRASE_TO_FIELD))("MUTATION: without the %s phrase its field is no longer flagged", (phrase, column) => {
    const without = REVIEWER_PHRASES.filter((p) => p !== phrase);
    const found = findReviewerCommentary(EXAMPLE_COMMENTARY_ROW, { phrases: without });
    expect(found.map((f) => f.column)).not.toContain(column);
  });
});

describe("one definition, three consumers", () => {
  it("the data-fix query is generated from the same list: it contains every phrase and every checked column", () => {
    const sql = reviewerCommentaryCountsQuery();
    for (const phrase of REVIEWER_PHRASES) expect(sql).toContain(phraseRegex(phrase));
    for (const column of CHECKED_PUBLIC_TEXT_COLUMNS) expect(sql).toContain(`'${column}'`);
    expect(sql).toMatch(/read only|select/i);
    expect(sql).not.toMatch(/\b(update|insert|delete|drop|alter)\b/i);
  });

  it("every source-config listing is free of reviewer wording (paths 2 and 6: ingest auto-publish and the seeds)", () => {
    const bad = SEED_SCHOLARSHIPS.flatMap((s) =>
      findReviewerCommentary({
        provider: s.provider,
        program_name: s.programName,
        host_institution: s.hostInstitution,
        field_tags: s.fieldTags,
        funding_covers: s.fundingCovers,
        eligibility_nationalities: s.eligibilityNationalities,
        eligibility_prior_degree: s.eligibilityPriorDegree,
        eligibility_age: s.eligibilityAge,
        eligibility_other: s.eligibilityOther,
        source_name: s.sourceName,
        deadline_note: s.deadlineNote,
      }).map((f) => `${s.programName}: ${f.column} ("${f.phrase}")`),
    );
    expect(bad).toEqual([]);
  });
});

describe("which columns are checked (derived, so a new public text column cannot slip past)", () => {
  const typesSource = readFileSync("src/lib/supabase/types.ts", "utf8");
  const rowBlock = typesSource.split("scholarships: {")[1].split("Insert:")[0];
  const textColumns = [...rowBlock.matchAll(/^\s+([a-z_]+): (string(?:\[\])?)(?: \| null)?$/gm)].map((m) => m[1]);

  const landingColumns = /LANDING_PREVIEW_COLUMNS =\s*"([^"]+)"/.exec(readFileSync("src/lib/seo/landing-page-data.ts", "utf8"))![1];
  const publicSelectColumns = new Set(
    [PUBLIC_COLUMNS, landingColumns].flatMap((list) => list.split(",").map((c) => c.trim())),
  );

  it("has the text columns of the scholarships row to reason about (the test is not vacuous)", () => {
    expect(textColumns).toContain("deadline_note");
    expect(textColumns).toContain("moderation_note");
    expect(publicSelectColumns.has("deadline_note")).toBe(true);
  });

  it("every text column a public query selects is either checked or explicitly excluded with a reason", () => {
    const publicText = textColumns.filter((c) => publicSelectColumns.has(c));
    const covered = new Set<string>([...CHECKED_PUBLIC_TEXT_COLUMNS, ...Object.keys(EXCLUDED_PUBLIC_TEXT_COLUMNS)]);
    expect(publicText.filter((c) => !covered.has(c))).toEqual([]);
  });

  it("an exclusion carries a reason, and moderation_note is never public", () => {
    for (const [column, reason] of Object.entries(EXCLUDED_PUBLIC_TEXT_COLUMNS)) expect(reason.length, column).toBeGreaterThan(10);
    expect(publicSelectColumns.has("moderation_note")).toBe(false);
  });

  it("a column is not both checked and excluded", () => {
    for (const c of CHECKED_PUBLIC_TEXT_COLUMNS) expect(Object.keys(EXCLUDED_PUBLIC_TEXT_COLUMNS)).not.toContain(c);
  });
});
