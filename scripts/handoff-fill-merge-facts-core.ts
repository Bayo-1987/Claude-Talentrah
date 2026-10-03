import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * The logic behind scripts/handoff-fill-merge-facts.ts, kept free of the network and the repo layout so a test can drive it
 * with recorded GitHub responses (tests/scripts/handoff-fill-merge-facts.test.ts).
 *
 * WHY THIS EXISTS. A handoff entry ships INSIDE its own PR, so it cannot quote its own merge commit: its PR row says
 * "(filled at merge)" or "the merge commit of this PR". Left alone those placeholders live forever. This finds them, asks GitHub
 * (read-only, GET only) when each PR actually merged and with what commit, and rewrites ONLY the two cells of that row.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *  - It never trusts `merge_commit_sha` on its own. GitHub reports one for an OPEN pull request too (the test-merge commit), which
 *    is not on main. Facts exist only when `merged` is true.
 *  - It never renames a file. The handoff format test requires the file name's date to be the merged-at date (UTC); when they
 *    differ the file is reported (`date-mismatch`) and left alone, because fixing it is a rename a person should decide on.
 *  - It never touches legacy/, TEMPLATE.md, or an entry that already carries real facts.
 */

export interface Facts {
  /** "YYYY-MM-DD HH:MM:SS", UTC. */
  mergedAt: string;
  /** 40 hex. */
  sha: string;
  /** "YYYY-MM-DD", UTC; the date the file name has to carry. */
  date: string;
}

export type Pull = Record<string, unknown>;

export type FileStatus = "filled" | "already-filled" | "not-merged" | "date-mismatch" | "fetch-error" | "no-pr-row";

export interface FileResult {
  file: string;
  pr: number;
  status: FileStatus;
  detail?: string;
  before?: string;
  after?: string;
}

const PLACEHOLDER = /filled at merge|the merge commit of this PR/i;
const NAME = /^(\d{4}-\d{2}-\d{2})-pr-(\d+)\.md$/;

/** Facts from a pulls/:n response, or null unless the pull is MERGED and carries a well-formed time and SHA. */
export function mergeFactsFromPull(pull: Pull): Facts | null {
  if (pull.merged !== true) return null;
  const at = pull.merged_at;
  const sha = pull.merge_commit_sha;
  if (typeof at !== "string" || typeof sha !== "string" || !/^[0-9a-f]{40}$/.test(sha)) return null;
  const m = at.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})Z$/);
  if (!m) return null;
  return { mergedAt: `${m[1]} ${m[2]}`, sha, date: m[1] };
}

/** The PR row of entry `pr`: `| [#n](...) | `branch` | <merged at> | <sha> |`, as four captures around the two cells. */
function rowRegex(pr: number): RegExp {
  return new RegExp(`^(\\|\\s*\\[#${pr}\\]\\([^)]*\\)\\s*\\|\\s*\`[^\`]+\`\\s*\\|)([^|\\n]*)\\|([^|\\n]*)\\|[ \\t]*$`, "m");
}

export function hasPlaceholderRow(body: string, pr: number): boolean {
  const m = body.match(rowRegex(pr));
  return !!m && (PLACEHOLDER.test(m[2]) || PLACEHOLDER.test(m[3]));
}

/** Rewrites the merged-at and SHA cells of entry `pr`'s row, and nothing else. Idempotent. */
export function fillRow(body: string, pr: number, facts: Facts): { body: string; changed: boolean } {
  const m = body.match(rowRegex(pr));
  if (!m || !(PLACEHOLDER.test(m[2]) || PLACEHOLDER.test(m[3]))) return { body, changed: false };
  const row = `${m[1]} ${facts.mergedAt} | \`${facts.sha}\` |`;
  return { body: body.replace(m[0], row), changed: true };
}

/** Looks at every docs/handoff/<date>-pr-<n>.md still holding a placeholder row and decides what would be written. Does not write. */
export async function planDirectory(dir: string, getPull: (pr: number) => Promise<Pull>): Promise<FileResult[]> {
  const results: FileResult[] = [];
  for (const file of readdirSync(dir).sort()) {
    const name = file.match(NAME);
    if (!name) continue; // TEMPLATE.md, the legacy/ directory, anything else
    const pr = Number(name[2]);
    const before = readFileSync(path.join(dir, file), "utf8");
    if (!rowRegex(pr).test(before)) {
      if (PLACEHOLDER.test(before)) results.push({ file, pr, status: "no-pr-row", detail: `no PR row for #${pr} to fill` });
      continue;
    }
    if (!hasPlaceholderRow(before, pr)) {
      results.push({ file, pr, status: "already-filled" });
      continue;
    }
    let pull: Pull;
    try {
      pull = await getPull(pr);
    } catch (e) {
      results.push({ file, pr, status: "fetch-error", detail: e instanceof Error ? e.message : String(e) });
      continue;
    }
    const facts = mergeFactsFromPull(pull);
    if (!facts) {
      results.push({ file, pr, status: "not-merged", detail: `#${pr} is not merged yet` });
      continue;
    }
    if (facts.date !== name[1]) {
      results.push({
        file,
        pr,
        status: "date-mismatch",
        detail: `#${pr} merged on ${facts.date} (UTC) but the file is named for ${name[1]}; rename it (git mv) and re-run`,
      });
      continue;
    }
    const { body, changed } = fillRow(before, pr, facts);
    results.push(changed ? { file, pr, status: "filled", before, after: body } : { file, pr, status: "already-filled" });
  }
  return results;
}

/** A minimal unified-style diff of the one changed line per filled file (the only line this script ever changes). */
export function renderDiff(results: FileResult[]): string {
  const parts: string[] = [];
  for (const r of results) {
    if (r.status !== "filled" || r.before === undefined || r.after === undefined) continue;
    const a = r.before.split("\n");
    const b = r.after.split("\n");
    parts.push(`--- a/docs/handoff/${r.file}`, `+++ b/docs/handoff/${r.file}`);
    for (let i = 0; i < a.length; i++) {
      if (a[i] === b[i]) continue;
      parts.push(`@@ line ${i + 1} @@`, `-${a[i]}`, `+${b[i]}`);
    }
  }
  return parts.join("\n");
}

export interface RunDeps {
  dir: string;
  getPull: (pr: number) => Promise<Pull>;
  out: (line: string) => void;
}

/**
 * Exit codes: 0 done (including "nothing to fill" and "some PRs not merged yet"); 1 at least one file hit a fetch error or a
 * no-PR-row problem or a date mismatch that needs a person; 2 bad arguments. Writing needs an explicit --write; the default and
 * --dry-run print the diff and change nothing.
 */
export async function run(argv: string[], deps: RunDeps): Promise<number> {
  const known = new Set(["--write", "--dry-run"]);
  const bad = argv.filter((a) => !known.has(a));
  if (bad.length > 0) {
    deps.out(`unknown argument(s): ${bad.join(" ")}\nusage: handoff-fill-merge-facts [--dry-run | --write]`);
    return 2;
  }
  const write = argv.includes("--write") && !argv.includes("--dry-run");
  const results = await planDirectory(deps.dir, deps.getPull);
  const filled = results.filter((r) => r.status === "filled");
  const problems = results.filter((r) => r.status === "fetch-error" || r.status === "no-pr-row" || r.status === "date-mismatch");

  if (filled.length === 0) deps.out("nothing to fill");
  else {
    deps.out(renderDiff(results));
    if (write) {
      for (const r of filled) writeFileSync(path.join(deps.dir, r.file), r.after as string);
      deps.out(`wrote ${filled.length} file(s)`);
    } else deps.out(`dry run: ${filled.length} file(s) would change; re-run with --write to apply`);
  }
  for (const r of results.filter((x) => x.status === "not-merged")) deps.out(`left as a placeholder: ${r.file} (${r.detail})`);
  for (const r of problems) deps.out(`NEEDS ATTENTION: ${r.file}: ${r.status}${r.detail ? ` (${r.detail})` : ""}`);
  return problems.length > 0 ? 1 : 0;
}
