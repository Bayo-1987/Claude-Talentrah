/**
 * The shape of the handoff record: ONE FILE PER MERGED PR, in docs/handoff/.
 *
 * WHY. Every merged PR used to add an entry to one shared file (handoff-status.md). Under merge-heavy days three
 * PRs editing the same insertion point conflicted constantly (#645, #642, #647) and each conflict cost a full CI
 * cycle. A PR that adds its own file cannot conflict with another PR's.
 *
 * WHAT IS ENFORCED
 *  - docs/handoff/<yyyy-mm-dd>-pr-<n>.md, one per merged PR, PR numbers unique across all files;
 *  - the filename's date is the merged-at date (UTC) in the file's own table, and its PR number is in that table;
 *  - each merged file carries: the PR row (PR, branch, merged-at UTC, 40-hex merge SHA) and the four-part verification
 *    (GitHub API, fresh clone, production, full suite on merged main). A "Flakes and reruns" line is the convention
 *    but is not enforced: several sessions write these files and the line was never part of their template;
 *  - only a file headed "## Merged" has to carry the merge facts, and because an entry ships inside its own PR those may be the
 *    explicit placeholder ("(filled at merge)", "the merge commit of this PR") instead of the SHA, filled in by a follow-up docs commit; one written inside its own PR before the merge
 *    (headed "## Opened" or just "## PR #n") only has to name its PR;
 *  - handoff-status.md stops being a log: no "## Merged" headings (the log is the directory).
 *  - docs/handoff/legacy/ holds entries written before this format existed. They are exempt from the field checks
 *    (they have no PR table with a SHA) but still need a unique <yyyy-mm-dd>-pr-<n>.md name.
 * A "multi-PR" write-up (one narrative for several PRs) lives in the lowest-numbered PR's file; each other PR's file
 * has its own row and a "Shared write-up:" line naming that file.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// HANDOFF_ROOT lets the test be pointed at another checkout (used to show it red against the pre-restructure tree).
const ROOT = process.env.HANDOFF_ROOT ?? process.cwd();
const DIR = path.join(ROOT, "docs/handoff");
const LEGACY = path.join(DIR, "legacy");
const NAME = /^(\d{4}-\d{2}-\d{2})-pr-(\d+)\.md$/;

// TEMPLATE.md is what sessions copy; it is not an entry, so it is excluded from every per-PR check below (and pinned separately).
const TEMPLATE = "TEMPLATE.md";
const list = (d: string) => (existsSync(d) ? readdirSync(d).filter((f) => f.endsWith(".md") && f !== TEMPLATE) : []);
const modern = list(DIR);
const legacy = list(LEGACY);
const all = [...modern.map((f) => ({ f, dir: DIR })), ...legacy.map((f) => ({ f, dir: LEGACY }))];

describe("docs/handoff is the record, one file per merged PR", () => {
  it("exists and is not empty (this test is not vacuous)", () => {
    expect(modern.length, "docs/handoff/ has no entries").toBeGreaterThan(0);
  });

  it("every file is named <yyyy-mm-dd>-pr-<n>.md", () => {
    expect(all.filter(({ f }) => !NAME.test(f)).map(({ f }) => f)).toEqual([]);
  });

  it("no PR number appears in two files", () => {
    const seen = new Map<string, string>();
    const dups: string[] = [];
    for (const { f } of all) {
      const n = f.match(NAME)?.[2];
      if (!n) continue;
      if (seen.has(n)) dups.push(`#${n}: ${seen.get(n)} and ${f}`);
      seen.set(n, f);
    }
    expect(dups).toEqual([]);
  });

  describe("each current-format file", () => {
    for (const f of modern) {
      it(f, () => {
        const m = f.match(NAME);
        expect(m, "bad filename").not.toBeNull();
        const [, date, n] = m!;
        const body = readFileSync(path.join(DIR, f), "utf8");

        // Only a file headed "## Merged" claims a merge, so only it has to carry the merge facts. A file written inside its
        // own PR before the merge ("## Opened ...", or a bare "## PR #n ...") has no merge SHA yet; the merger renames the
        // heading and fills the row. It still has to name its PR number.
        if (!/^## Merged /.test(body)) {
          expect(body, `does not name its PR, #${n}`).toMatch(new RegExp(`#${n}\\b`));
          return;
        }

        // The PR row: [#n](…) | `branch` | merged-at | merge SHA. An entry ships INSIDE its own PR, so it can never quote its own
        // merge commit; there are two honest ways to write that, and both are accepted: the real facts (YYYY-MM-DD HH:MM:SS and a
        // 40-hex SHA, filled in later), or the explicit placeholder "(filled at merge)" / "the merge commit of this PR" in both
        // cells. Anything else (an empty cell, a short SHA, a wrong date) is a mistake.
        const rowRe = new RegExp(`\\|\\s*\\[#${n}\\]\\([^)]*\\)\\s*\\|\\s*\`[^\`]+\`\\s*\\|([^|\\n]+)\\|([^|\\n]+)\\|`);
        const row = body.match(rowRe);
        expect(row, `no PR row for #${n} (a | [#${n}](…) | \`branch\` | merged-at | SHA | row)`).not.toBeNull();
        const placeholder = /filled at merge|the merge commit of this PR/i;
        const [, mergedAt, sha] = row!;
        if (placeholder.test(mergedAt) || placeholder.test(sha)) {
          expect(placeholder.test(mergedAt) && placeholder.test(sha), "merged-at and SHA must be placeholders together").toBe(true);
        } else {
          const when = mergedAt.trim().match(/^(\d{4}-\d{2}-\d{2}) \d{2}:\d{2}:\d{2}$/);
          expect(when, `merged-at "${mergedAt.trim()}" is not YYYY-MM-DD HH:MM:SS (UTC)`).not.toBeNull();
          expect(when![1], "filename date must be the merged-at date (UTC)").toBe(date);
          expect(sha.trim(), "merge SHA must be 40 hex in backticks").toMatch(/^`[0-9a-f]{40}`$/);
        }

        // A pointer file carries only its own row; the verification lives in the shared write-up.
        const shared = body.match(/Shared write-up:\s*`?([\w./-]+\.md)`?/);
        if (shared) {
          expect(modern.includes(path.basename(shared[1])), `Shared write-up ${shared[1]} not found`).toBe(true);
          return;
        }

        // Four-part verification, each part named.
        for (const part of ["1.", "2.", "3.", "4."]) {
          expect(body, `verification part ${part} missing`).toMatch(new RegExp(`(\\*\\*${part.replace(".", "\\.")}|\\n${part.replace(".", "\\.")}\\s)`));
        }
        expect(body, "no Verification section").toMatch(/Verification/);
      });
    }
  });
});

describe("docs/handoff/TEMPLATE.md is what a session copies", () => {
  const file = path.join(DIR, TEMPLATE);

  it("exists, and is not counted as an entry (no per-PR check runs on it)", () => {
    expect(existsSync(file), "docs/handoff/TEMPLATE.md was deleted").toBe(true);
    expect(modern).not.toContain(TEMPLATE);
    expect(all.map(({ f }) => f)).not.toContain(TEMPLATE);
  });

  it("keeps the headings every entry should have", () => {
    const body = readFileSync(file, "utf8");
    // PR number and title; merge SHA and merged-at UTC.
    expect(body).toMatch(/^## Merged .*PR #<n>/m);
    expect(body).toMatch(/Merged at \(UTC\)/);
    expect(body).toMatch(/Merge SHA/);
    // The four-part verification, each part named.
    for (const part of ["1. GitHub API", "2. Fresh clone", "3. Production", "4. Full suite on merged main"]) {
      expect(body, `template lost verification part ${part}`).toContain(`**${part}:**`);
    }
    expect(body).toMatch(/^### Flakes and reruns/m);
    expect(body).toMatch(/^### Follow-ups/m);
    // For migrations: where, when (UTC) and the sha256 of what was applied.
    expect(body).toMatch(/^### Migration apply record/m);
    expect(body).toMatch(/sha256/);
    expect(body).toMatch(/talentrah-preview/);
  });

  it("is named in the shared file's index header", () => {
    expect(readFileSync(path.join(ROOT, "handoff-status.md"), "utf8")).toContain("docs/handoff/TEMPLATE.md");
  });
});

describe("the shared file is an index, not a log", () => {
  it("carries no list of entries (a shared list is a shared insertion point: every PR would conflict on it again)", () => {
    const body = readFileSync(path.join(ROOT, "handoff-status.md"), "utf8");
    expect(body.match(/^- \[\d{4}-\d{2}-\d{2} — #\d+\]\(docs\/handoff\//gm)?.length ?? 0).toBe(0);
    expect(body, "must point at the directory").toMatch(/docs\/handoff\//);
  });

  it("handoff-status.md has no '## Merged' entries left", () => {
    const body = readFileSync(path.join(ROOT, "handoff-status.md"), "utf8");
    expect(body.match(/^## Merged /gm)?.length ?? 0).toBe(0);
  });
});
