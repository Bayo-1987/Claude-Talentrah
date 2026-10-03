/**
 * scripts/handoff-fill-merge-facts: finds docs/handoff entries whose PR row still says "(filled at merge)" or "the merge commit
 * of this PR" (an entry ships inside its own PR, so it cannot quote its own merge commit) and fills the merged-at time and the merge
 * SHA from the GitHub API, read-only. It rewrites ONLY those two cells.
 *
 * The API responses are RECORDED (tests/fixtures/github/pull-<n>.json, fetched 2026-10-02 from pulls/670, 647 and 661 and trimmed to
 * the keys the script reads), so the test does not touch the network. The three recorded shapes are the three that matter:
 *   670  merged            -> facts available
 *   647  closed, unmerged  -> no facts (merged: false, merge_commit_sha null)
 *   661  OPEN              -> merged: false, but merge_commit_sha is NON-NULL (GitHub's test-merge commit). Reading the SHA without
 *                            checking `merged` would write a commit that is not on main: the trap this fixture exists for.
 *
 * The module is loaded at runtime (loadModule) so that, before it exists, every test fails on its own assertion.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadModule } from "../support/load-module";

interface Facts {
  mergedAt: string;
  sha: string;
  date: string;
}
type Pull = Record<string, unknown>;
interface FileResult {
  file: string;
  pr: number;
  status: "filled" | "already-filled" | "not-merged" | "date-mismatch" | "fetch-error" | "no-pr-row";
  detail?: string;
  before?: string;
  after?: string;
}
interface Core {
  mergeFactsFromPull(pull: Pull): Facts | null;
  hasPlaceholderRow(body: string, pr: number): boolean;
  fillRow(body: string, pr: number, facts: Facts): { body: string; changed: boolean };
  planDirectory(dir: string, getPull: (pr: number) => Promise<Pull>): Promise<FileResult[]>;
  renderDiff(results: FileResult[]): string;
  run(
    argv: string[],
    deps: { dir: string; getPull: (pr: number) => Promise<Pull>; out: (s: string) => void },
  ): Promise<number>;
}

const load = () => loadModule<Core>(path.resolve(process.cwd(), "scripts/handoff-fill-merge-facts-core.ts"));
const fixture = (n: number): Pull => JSON.parse(readFileSync(path.join(process.cwd(), `tests/fixtures/github/pull-${n}.json`), "utf8"));

const SHA_670 = "e9b6c47737164e2996a217a18234d5e17f75afb1";

function entry(pr: number, mergedAt = "(filled at merge)", sha = "(filled at merge)"): string {
  return [
    `## Opened 2026-10-02 — PR #${pr}, a thing (send-1)`,
    "",
    "| PR | Branch | Merged at (UTC) | Merge SHA |",
    "|----|--------|-----------------|-----------|",
    `| [#${pr}](https://github.com/Bayo-1987/Claude-Talentrah/pull/${pr}) | \`fix/some-branch-${pr}\` | ${mergedAt} | ${sha} |`,
    "",
    "### What changed",
    "Text that must never be touched, with a | pipe | in it.",
    "",
    "### Verification",
    "**1.** a **2.** b **3.** c **4.** d",
    "",
  ].join("\n");
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "handoff-fill-"));
  mkdirSync(path.join(dir, "legacy"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const write = (name: string, body: string, sub = "") => writeFileSync(path.join(dir, sub, name), body);
const read = (name: string) => readFileSync(path.join(dir, name), "utf8");

describe("mergeFactsFromPull — only a MERGED pull has facts", () => {
  it("a merged pull gives the merged-at (UTC, 'YYYY-MM-DD HH:MM:SS'), the 40-hex SHA and the date", async () => {
    const { mergeFactsFromPull } = await load();
    expect(mergeFactsFromPull(fixture(670))).toEqual({ mergedAt: "2026-10-02 17:14:01", sha: SHA_670, date: "2026-10-02" });
  });

  it("a closed, unmerged pull has none", async () => {
    const { mergeFactsFromPull } = await load();
    expect(mergeFactsFromPull(fixture(647))).toBeNull();
  });

  it("an OPEN pull has none even though GitHub reports a merge_commit_sha for it (the test-merge commit)", async () => {
    const { mergeFactsFromPull } = await load();
    const open = fixture(661);
    expect(open.merge_commit_sha, "the recorded fixture must carry the trap").toBeTruthy();
    expect(mergeFactsFromPull(open)).toBeNull();
  });

  it("`merged: false` is decisive even when a time and a SHA are present", async () => {
    const { mergeFactsFromPull } = await load();
    expect(mergeFactsFromPull({ ...fixture(670), merged: false })).toBeNull();
  });

  it("a malformed answer (merged but no SHA, or a short SHA) has none rather than a half-fact", async () => {
    const { mergeFactsFromPull } = await load();
    expect(mergeFactsFromPull({ ...fixture(670), merge_commit_sha: null })).toBeNull();
    expect(mergeFactsFromPull({ ...fixture(670), merge_commit_sha: "abc123" })).toBeNull();
    expect(mergeFactsFromPull({ ...fixture(670), merged_at: null })).toBeNull();
  });
});

describe("fillRow — rewrites only the two cells", () => {
  const facts = { mergedAt: "2026-10-02 17:14:01", sha: SHA_670, date: "2026-10-02" };

  it("fills '(filled at merge)' in both cells and changes exactly one line", async () => {
    const { fillRow } = await load();
    const before = entry(670);
    const { body, changed } = fillRow(before, 670, facts);
    expect(changed).toBe(true);
    const a = before.split("\n");
    const b = body.split("\n");
    expect(b).toHaveLength(a.length);
    const differing = a.map((l, i) => i).filter((i) => a[i] !== b[i]);
    expect(differing, "exactly the PR row changes").toHaveLength(1);
    expect(b[differing[0]]).toBe(
      `| [#670](https://github.com/Bayo-1987/Claude-Talentrah/pull/670) | \`fix/some-branch-670\` | 2026-10-02 17:14:01 | \`${SHA_670}\` |`,
    );
  });

  it("fills 'the merge commit of this PR' (the other placeholder some entries use) the same way", async () => {
    const { fillRow } = await load();
    const { body } = fillRow(entry(670, "the merge commit of this PR", "the merge commit of this PR"), 670, facts);
    expect(body).toContain(`| 2026-10-02 17:14:01 | \`${SHA_670}\` |`);
    expect(body).not.toMatch(/merge commit of this PR/);
  });

  it("keeps the link cell and the branch cell byte for byte, and everything else in the file", async () => {
    const { fillRow } = await load();
    const before = entry(670);
    const { body } = fillRow(before, 670, facts);
    expect(body).toContain("| [#670](https://github.com/Bayo-1987/Claude-Talentrah/pull/670) | `fix/some-branch-670` |");
    expect(body).toContain("Text that must never be touched, with a | pipe | in it.");
    expect(body.replace(/\| 2026-10-02 17:14:01 \| `[0-9a-f]{40}` \|/, "| (filled at merge) | (filled at merge) |")).toBe(before);
  });

  it("is idempotent: filling a filled row changes nothing", async () => {
    const { fillRow } = await load();
    const once = fillRow(entry(670), 670, facts).body;
    const twice = fillRow(once, 670, facts);
    expect(twice.changed).toBe(false);
    expect(twice.body).toBe(once);
  });

  it("only touches the row of the PR it was asked about", async () => {
    const { fillRow } = await load();
    const two = entry(670) + "\n" + entry(671).split("\n").slice(4, 5).join("\n") + "\n";
    const { body } = fillRow(two, 670, facts);
    expect(body).toContain("| [#671](https://github.com/Bayo-1987/Claude-Talentrah/pull/671) | `fix/some-branch-671` | (filled at merge) | (filled at merge) |");
  });
});

describe("hasPlaceholderRow", () => {
  it("is true for either placeholder and false for real facts", async () => {
    const { hasPlaceholderRow } = await load();
    expect(hasPlaceholderRow(entry(670), 670)).toBe(true);
    expect(hasPlaceholderRow(entry(670, "the merge commit of this PR", "the merge commit of this PR"), 670)).toBe(true);
    expect(hasPlaceholderRow(entry(670, "2026-10-02 17:14:01", `\`${SHA_670}\``), 670)).toBe(false);
  });
});

describe("planDirectory", () => {
  it("fills a merged PR's entry, leaves an unmerged or open one alone, and says why", async () => {
    const { planDirectory } = await load();
    write("2026-10-02-pr-670.md", entry(670));
    write("2026-10-02-pr-647.md", entry(647));
    write("2026-10-02-pr-661.md", entry(661));
    const results = await planDirectory(dir, async (n) => fixture(n));
    const by = Object.fromEntries(results.map((r) => [r.pr, r]));
    expect(by[670].status).toBe("filled");
    expect(by[647].status).toBe("not-merged");
    expect(by[661].status).toBe("not-merged");
  });

  it("never calls the API for an entry that has no placeholder, and ignores legacy/ and TEMPLATE.md", async () => {
    const { planDirectory } = await load();
    write("2026-10-02-pr-670.md", entry(670, "2026-10-02 17:14:01", `\`${SHA_670}\``));
    write("TEMPLATE.md", entry(999));
    write("2026-08-25-pr-35.md", entry(35), "legacy");
    const asked: number[] = [];
    const results = await planDirectory(dir, async (n) => {
      asked.push(n);
      return fixture(670);
    });
    expect(asked).toEqual([]);
    expect(results.map((r) => r.status)).toEqual(["already-filled"]);
  });

  it("refuses a file whose name date is not the merged date (the format test would fail it); it reports and does not rewrite", async () => {
    const { planDirectory } = await load();
    write("2026-10-01-pr-670.md", entry(670));
    const [r] = await planDirectory(dir, async () => fixture(670));
    expect(r.status).toBe("date-mismatch");
    expect(r.detail).toMatch(/2026-10-02/);
    expect(r.after).toBeUndefined();
  });

  it("reports a fetch error per file and carries on with the others", async () => {
    const { planDirectory } = await load();
    write("2026-10-02-pr-670.md", entry(670));
    write("2026-10-02-pr-671.md", entry(671));
    const results = await planDirectory(dir, async (n) => {
      if (n === 671) throw new Error("HTTP 502");
      return fixture(670);
    });
    const by = Object.fromEntries(results.map((r) => [r.pr, r]));
    expect(by[670].status).toBe("filled");
    expect(by[671].status).toBe("fetch-error");
    expect(by[671].detail).toMatch(/502/);
  });

  it("a file with no row for its own PR is reported, not guessed at", async () => {
    const { planDirectory } = await load();
    write("2026-10-02-pr-670.md", "## Opened 2026-10-02 — PR #670\n\nno table here (filled at merge)\n");
    const [r] = await planDirectory(dir, async () => fixture(670));
    expect(r.status).toBe("no-pr-row");
  });
});

describe("renderDiff and run", () => {
  it("renderDiff prints the file name and exactly one removed and one added line per filled file", async () => {
    const { planDirectory, renderDiff } = await load();
    write("2026-10-02-pr-670.md", entry(670));
    const text = renderDiff(await planDirectory(dir, async () => fixture(670)));
    expect(text).toContain("2026-10-02-pr-670.md");
    const lines = text.split("\n");
    expect(lines.filter((l) => l.startsWith("-") && !l.startsWith("---"))).toHaveLength(1);
    expect(lines.filter((l) => l.startsWith("+") && !l.startsWith("+++"))).toHaveLength(1);
    expect(text).toContain(SHA_670);
  });

  it("DRY RUN (the default) prints the diff and writes nothing", async () => {
    const { run } = await load();
    write("2026-10-02-pr-670.md", entry(670));
    const before = read("2026-10-02-pr-670.md");
    const out: string[] = [];
    const code = await run(["--dry-run"], { dir, getPull: async () => fixture(670), out: (s) => out.push(s) });
    expect(code).toBe(0);
    expect(read("2026-10-02-pr-670.md")).toBe(before);
    expect(out.join("\n")).toContain(SHA_670);
    expect(out.join("\n")).toMatch(/dry run/i);
  });

  it("with no flag it is also a dry run: writing needs an explicit --write", async () => {
    const { run } = await load();
    write("2026-10-02-pr-670.md", entry(670));
    const before = read("2026-10-02-pr-670.md");
    await run([], { dir, getPull: async () => fixture(670), out: () => {} });
    expect(read("2026-10-02-pr-670.md")).toBe(before);
  });

  it("--write rewrites the file, and a second run finds nothing to do", async () => {
    const { run } = await load();
    write("2026-10-02-pr-670.md", entry(670));
    const out: string[] = [];
    expect(await run(["--write"], { dir, getPull: async () => fixture(670), out: (s) => out.push(s) })).toBe(0);
    expect(read("2026-10-02-pr-670.md")).toContain(`| 2026-10-02 17:14:01 | \`${SHA_670}\` |`);
    const again: string[] = [];
    expect(await run(["--write"], { dir, getPull: async () => fixture(670), out: (s) => again.push(s) })).toBe(0);
    expect(again.join("\n")).toMatch(/nothing to fill/i);
  });

  it("exits 1 when any file could not be resolved because of an error, but still writes the ones that could", async () => {
    const { run } = await load();
    write("2026-10-02-pr-670.md", entry(670));
    write("2026-10-02-pr-671.md", entry(671));
    const code = await run(["--write"], {
      dir,
      getPull: async (n) => {
        if (n === 671) throw new Error("HTTP 502");
        return fixture(670);
      },
      out: () => {},
    });
    expect(code).toBe(1);
    expect(read("2026-10-02-pr-670.md")).toContain(SHA_670);
    expect(read("2026-10-02-pr-671.md")).toContain("(filled at merge)");
  });

  it("an unmerged PR is not an error (exit 0): it simply stays a placeholder until it merges", async () => {
    const { run } = await load();
    write("2026-10-02-pr-661.md", entry(661));
    expect(await run(["--write"], { dir, getPull: async () => fixture(661), out: () => {} })).toBe(0);
    expect(read("2026-10-02-pr-661.md")).toContain("(filled at merge)");
  });

  it("an unknown flag is refused (exit 2) instead of silently running", async () => {
    const { run } = await load();
    expect(await run(["--delete-everything"], { dir, getPull: async () => fixture(670), out: () => {} })).toBe(2);
  });

  it("the directory is not created or written when there is nothing to fill", async () => {
    const { run } = await load();
    const code = await run(["--write"], { dir, getPull: async () => fixture(670), out: () => {} });
    expect(code).toBe(0);
    expect(existsSync(path.join(dir, "legacy"))).toBe(true);
  });
});

describe("the CLI is read-only against GitHub", () => {
  it("issues GET requests to pulls/:n and no write method anywhere in the script", () => {
    const src = readFileSync(path.join(process.cwd(), "scripts/handoff-fill-merge-facts.ts"), "utf8");
    expect(src).toMatch(/method:\s*"GET"/);
    expect(src).toMatch(/\/pulls\/\$\{pr\}/);
    expect(src).not.toMatch(/method:\s*"(POST|PUT|PATCH|DELETE)"/i);
    expect(src).not.toMatch(/\.(post|put|patch|delete)\(/);
  });
});
