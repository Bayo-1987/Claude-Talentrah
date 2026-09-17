/**
 * The standing enforcement test for docs/match-confidence-invariant.md's own
 * rule: no consumer of a match score may present more confidence than the
 * screenable-tag denominator supports. Mirrors
 * tests/rls/column-privileges.test.ts's own spirit — "add a value-bearing
 * column and this fails until you decide deliberately" — pointed at a
 * source-code invariant instead of a database grant.
 *
 * ── WHAT THIS ACTUALLY CATCHES, AND WHY IT'S THESE TWO SIGNALS ────────────
 *
 * The two REAL gaps this whole investigation found (the weekly digest,
 * src/lib/digest/template.ts, and send-138's proactive alert,
 * src/lib/notifications/proactive-match-alert/template.ts) shared an exact
 * shape: each built its own `${score}% ${MATCH_TIER_LABEL[tier]}` string by
 * hand instead of calling `describeMatchConfidence` (match-tier.ts) — the
 * same function `MatchTierBadge` already used. So this test scans every
 * `.ts`/`.tsx` file under `src/` for that exact shape, in its two component
 * parts:
 *
 *   (A) `MATCH_TIER_LABEL` used directly anywhere outside its own module
 *       (match-tier.ts). Every other file that wants a tier word should be
 *       getting it from `describeMatchConfidence`'s `label`, never looking
 *       the raw map up itself.
 *   (B) A `score`-named value interpolated into a template literal that also
 *       contains a `%` sign — the literal shape of "printing a percentage
 *       directly from a score field" — outside a short, explicit, commented
 *       allowlist of the render sites that are KNOWN to do this safely
 *       (match-tier.ts and match-tier-badge.tsx themselves, which the
 *       function's own tests already cover).
 *
 * Measured before relying on it (docs/ci-and-tooling-gaps.md's own
 * discipline: prove a check finds real things, not just that it runs):
 * running this scan against the pre-fix state of this branch's two target
 * files returned exactly the six lines the "already audited" section of this
 * PR's own task description named — no more, no fewer, and nothing in
 * src/lib/tailoring or src/lib/resume (which also display unrelated
 * percentages, e.g. an ATS score) false-positived. See this file's own
 * "catches a real violation" describe block below for the same proof kept
 * executable rather than only asserted in a commit message.
 *
 * ── WHAT THIS DELIBERATELY DOES NOT COVER ──────────────────────────────────
 *
 * `compute-and-store.ts` and `refresh-job.ts` call `getMatchTier` directly to
 * WRITE `match_scores.tier` — that IS the tier computation, not a consumer of
 * it, so it's allowlisted rather than routed through a display function it
 * has no reason to call. `auto-apply/queue.ts` and
 * `proactive-match-alert/select.ts` call tier/thinness predicates directly
 * for ELIGIBILITY decisions (what to queue, what to alert on), not display —
 * a gate deciding whether something happens is a different kind of consumer
 * than a renderer deciding what to print, and match-tier.ts's own predicates
 * (`getMatchTier`, `isThinScreenableTagSet`) are exactly what an eligibility
 * gate should call directly. Farah chat is the strongest case of all and
 * isn't in this scan at all: it never reads a score or tier in the first
 * place (docs/match-confidence-invariant.md's own "already audited" list).
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const SRC_ROOT = path.resolve(__dirname, "../../src");

function findSourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      found.push(...findSourceFiles(full));
    } else if (/\.tsx?$/.test(entry)) {
      found.push(full);
    }
  }
  return found;
}

function rel(absPath: string): string {
  return path.relative(SRC_ROOT, absPath).split(path.sep).join("/");
}

/**
 * Strip block and line comments before scanning, same as
 * tests/auth/entry-points-agree.test.ts's own `stripComments`. Several of
 * this PR's own files (digest/send.ts, digest/template.ts) narrate the OLD,
 * buggy `${score}% ${MATCH_TIER_LABEL[tier]}` shape in a doc comment
 * explaining why the fix exists — exactly the history a comment should be
 * free to discuss without tripping a check aimed at executable code. What
 * must not come back is the pattern in code that actually runs.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/**
 * Signal (A): a raw `MATCH_TIER_LABEL[...]` lookup, or importing the map at
 * all, anywhere other than the module that defines it.
 */
function usesMatchTierLabelDirectly(source: string): boolean {
  return /\bMATCH_TIER_LABEL\b/.test(source);
}

/**
 * Signal (B): a template-literal expression containing a `score`-named
 * identifier, on a line that also contains a literal "%" — the exact shape
 * every real violation took (`${j.score}%`, `${String(job.score))}%`, etc.).
 * Scoped to lines, not the whole file, because that keeps the match
 * specific enough that it doesn't fire on unrelated code far away in a large
 * file — matching this repo's own preference (see
 * tests/auth/entry-points-agree.test.ts's `functionBody` helper) for a
 * narrowly-scoped check over a whole-file one.
 */
const RAW_SCORE_TEMPLATE = /\$\{[^}]*\bscore\b[^}]*\}/i;

function linesWithRawScorePercent(source: string): string[] {
  return source
    .split("\n")
    .filter((line) => RAW_SCORE_TEMPLATE.test(line) && line.includes("%"));
}

/**
 * Files allowed to trip signal (A) and/or (B) — each with a reason, per this
 * repo's own "additive allowlist" convention (CLAUDE.md's own column-grant
 * note). Adding a file here should be a deliberate act someone can find
 * later, not an accident of the scan missing it.
 */
const ALLOWLIST: Record<string, { labelOk?: boolean; scorePercentOk?: boolean; reason: string }> = {
  "lib/match-tier.ts": {
    labelOk: true,
    scorePercentOk: true,
    reason:
      "the shared function's own home — defines MATCH_TIER_LABEL and describeMatchConfidence, and its own doc comments legitimately mention both by name.",
  },
  "components/ui/match-tier-badge.tsx": {
    labelOk: false,
    scorePercentOk: true,
    reason:
      "the canonical shared renderer. Its own `displayScore` variable never trips (A) after this fix, since the label now comes pre-built from describeMatchConfidence — but it deliberately keeps ONE raw `${score}%` (the showRawWhenCapped hover annotation, for Auto-Apply's review-before-submit context, where the real uncapped number is the thing being acted on) — see the component's own prop comment.",
  },
  "components/employer/applicant-filter-bar.tsx": {
    labelOk: true,
    reason:
      "send-326: MATCH_TIER_LABEL names a FILTER CATEGORY ('Excellent'/'Good'/'Fair' as facets to toggle), not a confidence claim about any specific applicant's score — there is no score in scope here to overclaim about. The per-applicant badge that DOES render a real confidence claim (applicant-list.tsx, via MatchTierBadge) is unaffected and still routes through describeMatchConfidence as required.",
  },
};

const sourceFiles = findSourceFiles(SRC_ROOT);

describe("match-confidence-invariant enforcement", () => {
  it("found source files to scan — a suite that checks nothing proves nothing", () => {
    expect(sourceFiles.length).toBeGreaterThan(50);
  });

  describe("signal (A): MATCH_TIER_LABEL used outside its own module", () => {
    const offenders = sourceFiles
      .map((f) => ({ path: rel(f), source: stripComments(readFileSync(f, "utf8")) }))
      .filter(({ path: p, source }) => p !== "lib/match-tier.ts" && usesMatchTierLabelDirectly(source));

    it("every hit is on the explicit allowlist", () => {
      const unlisted = offenders.filter((o) => !ALLOWLIST[o.path]?.labelOk);
      expect(
        unlisted.map((o) => o.path),
        "these files look up MATCH_TIER_LABEL directly instead of calling describeMatchConfidence " +
          "(match-tier.ts) — either route through the shared function, or add an explicit, commented " +
          "allowlist entry here if there's a real reason not to.",
      ).toEqual([]);
    });
  });

  describe("signal (B): a raw score interpolated as a percent", () => {
    const offenders = sourceFiles
      .map((f) => ({ path: rel(f), lines: linesWithRawScorePercent(stripComments(readFileSync(f, "utf8"))) }))
      .filter((o) => o.lines.length > 0);

    it("every hit is on the explicit allowlist", () => {
      const unlisted = offenders.filter((o) => !ALLOWLIST[o.path]?.scorePercentOk);
      expect(
        unlisted.map((o) => `${o.path}: ${o.lines.join(" | ")}`),
        "these files interpolate a raw score directly into a percent display instead of calling " +
          "describeMatchConfidence (match-tier.ts), which is what MatchTierBadge, the digest email and " +
          "the proactive alert all now do — see docs/match-confidence-invariant.md.",
      ).toEqual([]);
    });
  });

  describe("proof this scan catches a real violation (prove-the-test-catches-the-bug discipline)", () => {
    /*
     * The exact shape of both real gaps this PR fixes, reproduced here as
     * strings rather than files, so this test's own claim to catch them is
     * verified on every run rather than trusted from a commit message.
     */
    it("would have failed on the digest's own pre-fix line", () => {
      const preFixDigestLine = 'return `${j.score}% ${MATCH_TIER_LABEL[j.tier]} — ${j.title}`;';
      expect(usesMatchTierLabelDirectly(preFixDigestLine)).toBe(true);
      expect(linesWithRawScorePercent(preFixDigestLine)).toHaveLength(1);
    });

    it("would have failed on the proactive alert's own pre-fix line", () => {
      const preFixAlertLine =
        "body: `${job.title} at ${job.companyName} is a ${job.score}% match`,";
      expect(linesWithRawScorePercent(preFixAlertLine)).toHaveLength(1);
    });

    it("does NOT fire on the fixed versions of those same two lines", () => {
      const fixedDigestLine = "return `${displayScore}% ${label} — ${j.title}`;";
      const fixedAlertLine = "body: `${job.title} at ${job.companyName} is a ${displayScoreFor(job)}% match`,";
      expect(usesMatchTierLabelDirectly(fixedDigestLine)).toBe(false);
      expect(linesWithRawScorePercent(fixedDigestLine)).toHaveLength(0);
      expect(linesWithRawScorePercent(fixedAlertLine)).toHaveLength(0);
    });

    it("does NOT false-positive on an unrelated percent display (e.g. an ATS score, a progress percent)", () => {
      const unrelated = "return `${atsScorePercent}% ATS match` + `${completionPercent}% complete`;";
      // Deliberately named to NOT contain the bare word "score" as its own
      // token — "atsScorePercent" and "completionPercent" — the same way
      // "displayScore" inside match-tier-badge.tsx doesn't trip \bscore\b
      // either (see RAW_SCORE_TEMPLATE's own word-boundary regex).
      expect(linesWithRawScorePercent(unrelated)).toHaveLength(0);
    });
  });
});
