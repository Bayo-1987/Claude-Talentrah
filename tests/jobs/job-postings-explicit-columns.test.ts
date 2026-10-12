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

describe("no star or argument-less select reaches job_postings from src or scripts, however the chain is split", () => {
  // The chain scan above stops at the first statement end, so `const q = admin.from("job_postings");` followed later by `q.select("*")` is
  // invisible to it. This pass looks at every `.select()` / `.select("*")` in a file that names the table: it belongs to the nearest
  // `.from("<table>")` before it in the same statement, and a select with no `.from` in its statement (a chain held in a variable) is
  // refused, because the file cannot show which table it reads. Service-role code may read everything, but it still has to say so here.
  const SERVICE_ROLE_STAR_READS: Record<string, string> = {
    // "path/to/file.ts": "why a service-role read of every column is needed",
  };

  const SCRIPTS = join(ROOT, "scripts");
  const SCANNED = [
    ...FILES,
    ...walkAny(SCRIPTS).map((p) => ({ path: relative(ROOT, p), text: readFileSync(p, "utf8") })),
  ];

  function walkAny(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walkAny(p, out);
      else if (/\.(ts|tsx|mjs|js)$/.test(name)) out.push(p);
    }
    return out;
  }

  function offenders(files: { path: string; text: string }[]): string[] {
    const found: string[] = [];
    for (const { path, text: raw } of files) {
      const text = stripComments(raw);
      if (!/job_postings/.test(text)) continue;
      for (const m of text.matchAll(/\.select\(\s*(?:["'`]\s*\*[^"'`]*["'`])?\s*\)/g)) {
        const upToHere = text.slice(0, m.index);
        const stmtStart = Math.max(upToHere.lastIndexOf(";\n"), 0);
        const statement = upToHere.slice(stmtStart);
        const froms = [...statement.matchAll(/\.from\(\s*["'`]([\w.]+)["'`]\s*\)/g)];
        const table = froms.length ? froms[froms.length - 1][1] : null;
        if (table !== null && table !== "job_postings") continue;
        if (SERVICE_ROLE_STAR_READS[path]) continue;
        const line = upToHere.split("\n").length;
        found.push(`${path}:${line} ${m[0]} ${table === null ? "(table not visible in this statement)" : "(job_postings)"}`);
      }
    }
    return found;
  }

  it("scans src and scripts and finds the queries it is supposed to be scanning (the scan itself is not empty)", () => {
    const fromScripts = SCANNED.filter((f) => f.path.startsWith("scripts/") && /\.from\(\s*["'`]job_postings["'`]\s*\)/.test(f.text));
    expect(fromScripts.length, "no script reads job_postings, so scripts/ is not being scanned").toBeGreaterThanOrEqual(1);
    expect(SCANNED.filter((f) => f.path.startsWith("src/")).length).toBeGreaterThan(500);
  });

  it("no .select() or .select('*') belongs to job_postings, or to a chain whose table the statement does not show", () => {
    expect(offenders(SCANNED), "name the columns (src/lib/jobs/job-columns.ts) or, for a service-role read of everything, add the file to SERVICE_ROLE_STAR_READS with the reason").toEqual([]);
  });

  it("the scan itself catches each shape it exists for (checked on strings, not on the repo)", () => {
    const one = (text: string) => offenders([{ path: "x.ts", text: `// job_postings\n${text}` }]);
    expect(one('const r = await supabase.from("job_postings").select("*").eq("id", id);')).toHaveLength(1);
    expect(one('const r = await supabase.from("job_postings").insert(row).select();')).toHaveLength(1);
    expect(one('const q = admin.from("job_postings");\nconst r = await q.select("*");')).toHaveLength(1);
    expect(one('const r = await supabase.from("scholarships").select("*").eq("id", id);')).toHaveLength(0);
    expect(one('const r = await supabase.from("job_postings").select("id, title").eq("id", id);')).toHaveLength(0);
  });

  it("every allowlisted file exists, mentions the table and carries a reason", () => {
    for (const [path, reason] of Object.entries(SERVICE_ROLE_STAR_READS)) {
      const file = SCANNED.find((f) => f.path === path);
      expect(file, `${path} is allowlisted but not scanned`).toBeDefined();
      expect(file!.text, `${path} is allowlisted but does not read job_postings`).toMatch(/job_postings/);
      expect(file!.text, `${path} is allowlisted but is not service-role code`).toMatch(/createServiceRoleClient|SUPABASE_SERVICE_ROLE_KEY/);
      expect(reason.trim().length, `${path}: say why`).toBeGreaterThan(10);
    }
  });
});

describe("job_postings embedded from other tables names its columns too", () => {
  // `applications(... job_postings(title, company_name) ...)`, `job_postings!inner(...)`, `alias:job_postings(...)`: an embed's list is read as
  // the caller, so a `*` in one is the same dependency as a `select("*")` on the table itself.
  function embeds(): { path: string; embed: string }[] {
    const out: { path: string; embed: string }[] = [];
    for (const { path, text } of FILES) {
      for (const m of stripComments(text).matchAll(/(?<!from\(\s*["'`])\bjob_postings(?:![\w]+)?\s*\(([^)]*)\)/g)) {
        const before = stripComments(text).slice(Math.max(0, m.index! - 8), m.index!);
        if (/from\(\s*["'`]$/.test(before)) continue;
        out.push({ path, embed: m[0] });
      }
    }
    return out;
  }

  it("finds the embeds it is supposed to scan (the scan itself is not empty)", () => {
    expect(embeds().length).toBeGreaterThanOrEqual(10);
  });

  it("no embed of job_postings selects *", () => {
    expect(embeds().filter((e) => /\*/.test(e.embed)).map((e) => `${e.path}: ${e.embed}`)).toEqual([]);
  });

  it("a select whose argument is a named constant resolves to a literal list with no * and not the internal column", () => {
    const NOTE = ["admin", "review", "note"].join("_");
    const checked: string[] = [];
    for (const { path, chain } of jobPostingChains()) {
      const text = FILES.find((f) => f.path === path)!.text;
      for (const m of chain.matchAll(/\.select\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*[,)]/g)) {
        const name = m[1];
        const def = new RegExp(`const\\s+${name}\\s*=\\s*([\\s\\S]*?);`).exec(stripComments(text));
        if (!def) continue; // a function parameter (saved-set.ts): its caller passes one of the constants resolved here
        checked.push(`${path}:${name}`);
        expect(def[1], `${path}: ${name} selects *`).not.toMatch(/\*/);
        expect(def[1], `${path}: ${name} names the internal column`).not.toContain(NOTE);
      }
    }
    expect(checked.length, "no named-constant select lists were found, so the check proved nothing").toBeGreaterThanOrEqual(3);
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
    // 0246: import_key and employer_closed_at are the import sync's own bookkeeping, unreadable by anon and authenticated (tests/rls/job-postings-column-grants.test.ts); import_feed_id IS in the list.
    expect(left).toEqual([NOTE, "search_vector", "import_key", "employer_closed_at"].sort());
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
