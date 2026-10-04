/**
 * Every read of `job_postings` names its columns.
 *
 * A query that selects `*` (or `select()` with no list, which PostgREST expands to `*`) is a promise that every column on the table
 * is readable by the caller. That promise is what stops the table's column privileges from ever being tightened without every page
 * that reads it going blank, so the rule is held here: no `select("*")`, no empty `select()`, in any query of this app that starts
 * from `.from("job_postings")`. The two loaders that used to do it (the public job page and the employer edit page) now take their
 * lists from src/lib/jobs/job-columns.ts, and that file's lists are checked against the generated types so a renamed or dropped
 * column fails here rather than as an empty page.
 *
 * Pure source scan, no database: it runs everywhere.
 */
import { describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(__dirname, "..", "..");
const SRC = join(ROOT, "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const FILES = walk(SRC).map((p) => ({ path: relative(ROOT, p), text: readFileSync(p, "utf8") }));

/** The code without its comments, so a sentence that mentions `.select()` is not read as a call. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/(^|[\s;{}(,])\/\/.*$/gm, "$1");
}

/** Every `.from("job_postings")` chain, up to its first statement end (`;` at end of line) or 1200 characters. */
function jobPostingChains(): { path: string; chain: string }[] {
  const out: { path: string; chain: string }[] = [];
  for (const { path, text: raw } of FILES) {
    const text = stripComments(raw);
    const re = /\.from\(\s*["'`]job_postings["'`]\s*\)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const rest = text.slice(m.index, m.index + 1200);
      const end = rest.search(/;\s*(\n|$)/);
      out.push({ path, chain: end === -1 ? rest : rest.slice(0, end) });
    }
  }
  return out;
}

describe("no job_postings read selects *", () => {
  it("finds the queries it is supposed to be scanning (the scan itself is not empty)", () => {
    const chains = jobPostingChains();
    expect(chains.length, "the scan found no job_postings queries at all, so it proves nothing").toBeGreaterThan(40);
    expect(chains.filter((c) => /\.select\(/.test(c.chain)).length).toBeGreaterThan(30);
  });

  it("no query that starts at .from('job_postings') calls select('*') or select() with no list", () => {
    const offenders: string[] = [];
    for (const { path, chain } of jobPostingChains()) {
      for (const m of chain.matchAll(/\.select\(\s*([^)]*?)\s*[,)]/g)) {
        const first = m[1];
        if (first === "" || /^["'`]\s*\*/.test(first)) offenders.push(`${path}: .select(${first || ""})`);
      }
      if (/\.select\(\s*\)/.test(chain)) offenders.push(`${path}: .select()`);
    }
    expect([...new Set(offenders)], "name the columns a page reads; see src/lib/jobs/job-columns.ts").toEqual([]);
  });
});

describe("the one internal column that no page may read", () => {
  // The columns a decision writes. Only the service-role admin code and the generated types may mention it by name, so no list a page
  // reads can contain it. A new file that names it must be a deliberate decision, made here.
  const ALLOWED = [
    "src/app/(app)/jobs/(feed)/page.tsx",
    "src/components/jobs/job-card.tsx",
    "src/components/jobs/public-job-row.tsx",
    "src/lib/admin/moderation/actions.ts",
    "src/lib/jobs/search.ts",
    "src/lib/matching/compute-and-store.ts",
    "src/lib/seo/job-posting-jsonld.ts",
    "src/lib/seo/landing-page-data.ts",
    "src/lib/supabase/types.ts",
  ];

  it("is named only in the admin write, the generated types and the type-omit lists", () => {
    const column = ["admin", "review", "note"].join("_");
    const files = FILES.filter((f) => f.text.includes(column)).map((f) => f.path).sort();
    expect(files).toEqual(ALLOWED);
  });
});

describe("src/lib/jobs/job-columns.ts", () => {
  const types = readFileSync(join(SRC, "lib/supabase/types.ts"), "utf8");
  const row = /job_postings: \{\s*Row: \{([\s\S]*?)\n {8}\}/.exec(types)![1];
  const realColumns = [...row.matchAll(/^\s{10}(\w+)\??:/gm)].map((m) => m[1]);
  const split = (s: string) => s.split(",").map((c) => c.trim()).filter(Boolean);
  const NOTE = ["admin", "review", "note"].join("_");

  it("reads the generated Row to find the real columns (the scan itself is not empty)", () => {
    expect(realColumns.length).toBeGreaterThan(30);
    expect(realColumns).toContain("title");
  });

  it("each list names only real columns, once each, never * and never the internal note", async () => {
    const mod = await import("@/lib/jobs/job-columns");
    for (const [name, list] of [["JOB_DETAIL_COLUMNS", mod.JOB_DETAIL_COLUMNS], ["JOB_EDIT_COLUMNS", mod.JOB_EDIT_COLUMNS]] as const) {
      const cols = split(list);
      expect(cols.length, name).toBeGreaterThan(5);
      expect(cols.filter((c) => !realColumns.includes(c)), `${name}: a name that is not a job_postings column`).toEqual([]);
      expect(new Set(cols).size, `${name}: a column listed twice`).toBe(cols.length);
      expect(cols, name).not.toContain("*");
      expect(cols, name).not.toContain(NOTE);
    }
  });

  it("the detail list is every column except the internal ones it deliberately leaves out", async () => {
    const mod = await import("@/lib/jobs/job-columns");
    const left = realColumns.filter((c) => !split(mod.JOB_DETAIL_COLUMNS).includes(c)).sort();
    expect(left).toEqual([NOTE, "search_vector"].sort());
  });
});

describe("jobForRequest passes the explicit list", () => {
  it("selects JOB_DETAIL_COLUMNS plus the organisation's verified flag, never *", async () => {
    const select = vi.fn().mockReturnThis();
    const chain: Record<string, unknown> = {};
    chain.select = select;
    chain.eq = vi.fn(() => chain);
    chain.gte = vi.fn(() => chain);
    chain.maybeSingle = vi.fn(async () => ({ data: null }));
    vi.resetModules();
    vi.doMock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: () => chain }) }));
    const { jobForRequest } = await import("@/app/(app)/jobs/[id]/job-for-request");
    const { JOB_DETAIL_COLUMNS } = await import("@/lib/jobs/job-columns");
    await jobForRequest("00000000-0000-0000-0000-000000000000");
    expect(select).toHaveBeenCalledTimes(1);
    const arg = select.mock.calls[0][0] as string;
    expect(arg).toBe(`${JOB_DETAIL_COLUMNS}, organizations!job_postings_organization_id_fkey(verified)`);
    expect(arg).not.toContain("*");
    vi.doUnmock("@/lib/supabase/server");
  });
});
