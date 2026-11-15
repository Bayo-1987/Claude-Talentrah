/**
 * JOBS-LIFECYCLE-1 stage 1, W0: the dry run (src/lib/jobs/lifecycle.ts) and the flags, against a recording fake of the service client (no database).
 *
 * What it pins: the dry run WRITES NOTHING (every write method of the fake throws and records, and the module's own source has none); it reads the same predicates as the owner's SQL (plan 2g); it
 * reports would-close and would-delete by class with the references that blocked each; the employer classes are counted and nothing more; only the BLOCKING tables are looked at (the exempt five are
 * not); the handler's guard is the ADMIN SESSION (origin, 401, 403, with no client created before it passes) and writes no audit row; and with the flags OFF no wave may run.
 *
 * Named mutants (in the report): the dry run writes; the flag is ignored.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import {
  BLOCKING_REFERENCES,
  LIFECYCLE_DRY_RUN_PERMISSION,
  LIFECYCLE_FLAG_KEYS,
  SHEET_NO_DEADLINE_DAYS,
  UNREFERENCED_CLOSED_HOURS,
  classOfPosting,
  handleDryRun,
  lifecycleDryRun,
  lifecycleWaveAllowed,
  readLifecycleFlags,
  type LifecycleReadClient,
} from "@/lib/jobs/lifecycle";
import { JOB_POSTING_BLOCKING, JOB_POSTING_EXEMPT_TABLES } from "../support/job-posting-references";

const NOW = new Date("2026-11-14T12:00:00Z");

type Row = { id: string; source_type: string; external_source: string | null; import_feed_id: string | null };
interface World {
  flags?: Array<{ key: string; enabled: boolean }>;
  flagsError?: boolean;
  openSheetCount?: number;
  eligible?: Row[];
  /** table -> rows of { <column>: job id } */
  refs?: Record<string, Array<Record<string, string>>>;
  failTable?: string;
}
interface Recorded {
  from: string[];
  filters: Array<{ table: string; method: string; args: unknown[] }>;
  writes: string[];
  selects: Array<{ table: string; columns: string; options?: unknown }>;
}

function fake(world: World): { client: LifecycleReadClient; rec: Recorded } {
  const rec: Recorded = { from: [], filters: [], writes: [], selects: [] };
  const client = {
    from(table: string) {
      rec.from.push(table);
      const writer = (name: string) => () => {
        rec.writes.push(`${table}.${name}`);
        throw new Error(`WRITE ${table}.${name}`);
      };
      return {
        insert: writer("insert"),
        update: writer("update"),
        delete: writer("delete"),
        upsert: writer("upsert"),
        select(columns: string, options?: unknown) {
          rec.selects.push({ table, columns, options });
          const state: { in?: [string, string[]]; range?: [number, number]; closed?: boolean } = {};
          const q = {
            eq(c: string, v: unknown) { rec.filters.push({ table, method: "eq", args: [c, v] }); if (c === "status" && v === "closed") state.closed = true; return q; },
            not(c: string, op: string, v: unknown) { rec.filters.push({ table, method: "not", args: [c, op, v] }); return q; },
            lt(c: string, v: unknown) { rec.filters.push({ table, method: "lt", args: [c, v] }); return q; },
            like(c: string, p: string) { rec.filters.push({ table, method: "like", args: [c, p] }); return q; },
            or(f: string) { rec.filters.push({ table, method: "or", args: [f] }); return q; },
            in(c: string, v: readonly string[]) { rec.filters.push({ table, method: "in", args: [c, [...v]] }); state.in = [c, [...v]]; return q; },
            order(c: string) { rec.filters.push({ table, method: "order", args: [c] }); return q; },
            range(a: number, b: number) { rec.filters.push({ table, method: "range", args: [a, b] }); state.range = [a, b]; return q; },
            then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
              let result: { data: unknown[] | null; count?: number | null; error: { message: string } | null };
              if (world.failTable === table) result = { data: null, error: { message: `boom ${table}` } };
              else if (table === "feature_flags") result = world.flagsError ? { data: null, error: { message: "no flags" } } : { data: world.flags ?? [], error: null };
              else if (table === "job_postings" && (options as { head?: boolean } | undefined)?.head) result = { data: null, count: world.openSheetCount ?? 0, error: null };
              else if (table === "job_postings") result = { data: (world.eligible ?? []).slice(state.range?.[0] ?? 0, (state.range?.[1] ?? 999_999) + 1), error: null };
              else {
                const [col, ids] = state.in ?? ["", []];
                result = { data: (world.refs?.[table] ?? []).filter((r) => ids.includes(r[col])), error: null };
              }
              return Promise.resolve(result).then(resolve, reject);
            },
          };
          return q;
        },
      };
    },
  } as unknown as LifecycleReadClient;
  return { client, rec };
}

const row = (id: string, cls: "sheet" | "aggregator" | "employer" | "employer_feed"): Row => ({
  id,
  source_type: cls === "employer" || cls === "employer_feed" ? "internal" : "external",
  external_source: cls === "sheet" ? "manual-sheet-2026-11-02" : cls === "aggregator" ? "schema-org:workable-nigeria" : null,
  import_feed_id: cls === "employer_feed" ? "feed-1" : null,
});

describe("the classes", () => {
  it("sheet = external with a manual- source; aggregator = every other external (null source included); employer = internal; employer_feed = internal with a feed", () => {
    expect(classOfPosting(row("a", "sheet"))).toBe("sheet");
    expect(classOfPosting(row("a", "aggregator"))).toBe("aggregator");
    expect(classOfPosting({ source_type: "external", external_source: null, import_feed_id: null })).toBe("aggregator");
    expect(classOfPosting(row("a", "employer"))).toBe("employer");
    expect(classOfPosting(row("a", "employer_feed"))).toBe("employer_feed");
  });
});

describe("the lists agree", () => {
  it("BLOCKING_REFERENCES equals the migration test's blocking list (15), and contains none of the five exempt tables", () => {
    expect([...BLOCKING_REFERENCES].map(([t, c]) => `${t}.${c}`).sort()).toEqual(JOB_POSTING_BLOCKING.map(([t, c]) => `${t}.${c}`).sort());
    expect(BLOCKING_REFERENCES).toHaveLength(15);
    for (const [t] of BLOCKING_REFERENCES) expect(JOB_POSTING_EXEMPT_TABLES as readonly string[]).not.toContain(t);
  });
  it("the thresholds are the owner's: 7 days, 24 hours; the permission is the existing jobs_import", () => {
    expect(SHEET_NO_DEADLINE_DAYS).toBe(7);
    expect(UNREFERENCED_CLOSED_HOURS).toBe(24);
    expect(LIFECYCLE_DRY_RUN_PERMISSION).toBe("jobs_import");
  });
});

describe("the dry run: what it reports", () => {
  const world: World = {
    flags: [{ key: LIFECYCLE_FLAG_KEYS.closeImports, enabled: false }, { key: LIFECYCLE_FLAG_KEYS.deleteUnreferenced, enabled: false }],
    openSheetCount: 5,
    eligible: [row("s1", "sheet"), row("s2", "sheet"), row("s3", "sheet"), row("a1", "aggregator"), row("a2", "aggregator"), row("e1", "employer"), row("e2", "employer"), row("f1", "employer_feed")],
    refs: {
      applications: [{ job_posting_id: "s2" }, { job_posting_id: "s2" }],
      resumes: [{ tailored_for_job_id: "s2" }, { tailored_for_job_id: "s3" }],
      job_posting_reports: [{ job_posting_id: "e1" }],
      // An EXEMPT table: must never be asked about, so this row must change nothing.
      match_scores: [{ job_posting_id: "s1" }, { job_posting_id: "a1" }],
    },
  };

  it("POSITIVE CONTROL: would-close, would-delete by class, what blocked each, the employer classes as counts only", async () => {
    const { client } = fake(world);
    const r = await lifecycleDryRun(client, NOW);
    expect(r.would_close).toEqual({ sheet: 5 });
    expect(r.would_delete.sheet).toEqual({ eligible: 3, blocked: 2, would_delete: 1, blocked_by: { applications: 1, resumes: 2 } });
    expect(r.would_delete.aggregator).toEqual({ eligible: 2, blocked: 0, would_delete: 2, blocked_by: {} });
    expect(r.out_of_scope).toEqual({ employer: { eligible: 2 }, employer_feed: { eligible: 1 } });
    expect(r.flags).toEqual({ closeImports: false, deleteUnreferenced: false });
    expect(r.thresholds).toEqual({ sheet_no_deadline_days: 7, unreferenced_closed_hours: 24 });
    expect(r.truncated).toBe(false);
    expect(r.generated_at).toBe(NOW.toISOString());
  });

  it("uses the owner's predicates: open + manual- + no stated deadline + older than 7 days; closed + closed_at older than 24 hours", async () => {
    const { client, rec } = fake(world);
    await lifecycleDryRun(client, NOW);
    const on = (table: string, method: string) => rec.filters.filter((f) => f.table === table && f.method === method).map((f) => f.args);
    expect(on("job_postings", "eq")).toEqual(expect.arrayContaining([["status", "open"], ["status", "closed"]]));
    expect(on("job_postings", "like")).toEqual([["external_source", "manual-%"]]);
    expect(on("job_postings", "or")).toEqual([["expires_at_source.is.null,expires_at_source.eq.default"]]);
    expect(on("job_postings", "lt")).toEqual(expect.arrayContaining([["created_at", "2026-11-07T12:00:00.000Z"], ["closed_at", "2026-11-13T12:00:00.000Z"]]));
    expect(on("job_postings", "not")).toEqual([["closed_at", "is", null]]);
  });

  it("asks only the BLOCKING tables, only about the in-scope classes' ids, and never an exempt table or an employer id", async () => {
    const { client, rec } = fake(world);
    await lifecycleDryRun(client, NOW);
    // The reference lookups are the `.in(column, ids)` reads; the flags read is also an `.in`, on feature_flags.
    const asked = [...new Set(rec.filters.filter((f) => f.method === "in" && f.table !== "feature_flags").map((f) => f.table))];
    expect(new Set(asked)).toEqual(new Set(BLOCKING_REFERENCES.map(([t]) => t)));
    for (const t of JOB_POSTING_EXEMPT_TABLES) expect(asked).not.toContain(t);
    const askedIds = rec.filters.filter((f) => f.method === "in" && f.table !== "feature_flags").flatMap((f) => f.args[1] as string[]);
    expect(new Set(askedIds)).toEqual(new Set(["s1", "s2", "s3", "a1", "a2"]));
  });

  it("reads the eligible set in pages in a fixed order, and flags a set longer than the limit as truncated", async () => {
    const many: Row[] = Array.from({ length: 10_050 }, (_, i) => ({ ...row(`x${i}`, "aggregator"), id: `x${String(i).padStart(5, "0")}` }));
    const { client, rec } = fake({ eligible: many });
    const r = await lifecycleDryRun(client, NOW);
    expect(rec.filters.filter((f) => f.method === "range").map((f) => f.args)[0]).toEqual([0, 999]);
    expect(rec.filters.filter((f) => f.method === "order")).not.toHaveLength(0);
    expect(r.truncated).toBe(true);
    expect(r.would_delete.aggregator.eligible).toBe(10_000);
  });

  it("a read error anywhere fails the whole run (no partial report)", async () => {
    const { client } = fake({ ...world, failTable: "resumes" });
    await expect(lifecycleDryRun(client, NOW)).rejects.toThrow(/boom resumes/);
  });
});

describe("the dry run writes NOTHING", () => {
  it("not one insert, update, delete or upsert is attempted, and no lifecycle run row is created (every write method of the fake throws)", async () => {
    const { client, rec } = fake({ eligible: [row("s1", "sheet")], openSheetCount: 1 });
    await lifecycleDryRun(client, NOW);
    expect(rec.writes).toEqual([]);
    expect(rec.from).not.toContain("job_posting_lifecycle_runs");
    expect(rec.from).not.toContain("job_posting_tombstones");
  });

  it("the module has no write call in its source: no insert, update, delete, upsert or rpc", () => {
    const src = readFileSync(path.join(process.cwd(), "src/lib/jobs/lifecycle.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(src).not.toMatch(/\.(insert|update|delete|upsert|rpc)\s*\(/);
  });
});

describe("the flags", () => {
  it("both ship OFF in the migration, and an unreadable, missing or partial flag reads as OFF", async () => {
    expect(await readLifecycleFlags(fake({ flagsError: true }).client)).toEqual({ closeImports: false, deleteUnreferenced: false });
    expect(await readLifecycleFlags(fake({ flags: [] }).client)).toEqual({ closeImports: false, deleteUnreferenced: false });
    expect(await readLifecycleFlags(fake({ flags: [{ key: LIFECYCLE_FLAG_KEYS.closeImports, enabled: true }] }).client)).toEqual({ closeImports: true, deleteUnreferenced: false });
  });

  it("with the flags OFF no wave may run; each flag allows only its own wave", () => {
    const off = { closeImports: false, deleteUnreferenced: false };
    expect(lifecycleWaveAllowed(off, "close_imports")).toBe(false);
    expect(lifecycleWaveAllowed(off, "delete_unreferenced")).toBe(false);
    expect(lifecycleWaveAllowed({ closeImports: true, deleteUnreferenced: false }, "close_imports")).toBe(true);
    expect(lifecycleWaveAllowed({ closeImports: true, deleteUnreferenced: false }, "delete_unreferenced")).toBe(false);
    expect(lifecycleWaveAllowed({ closeImports: false, deleteUnreferenced: true }, "delete_unreferenced")).toBe(true);
  });

  it("the migration ships both flag rows OFF", () => {
    const sql = readFileSync(path.join(process.cwd(), "supabase/migrations/0279_job_posting_lifecycle.sql"), "utf8").replace(/\s+/g, " ");
    expect(sql).toMatch(new RegExp(`'${LIFECYCLE_FLAG_KEYS.closeImports}', '[^']+', false\\)`));
    expect(sql).toMatch(new RegExp(`'${LIFECYCLE_FLAG_KEYS.deleteUnreferenced}', '[^']+', false\\)`));
  });
});

describe("NO NEW PATH RUNS: with the flags off, the only code that closes or deletes differently is the guarded nightly delete (W-1, which has no flag by ruling and only reduces what it removes)", () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(name)) files.push(full);
    }
  };
  walk("src");
  const text = (f: string) => readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("the delete function is called from exactly one place in src: posting-deletion.ts (the generated types only declare it)", () => {
    const callers = files.filter((f) => /job_posting_delete_unreferenced/.test(text(f))).map((f) => f.split(path.sep).join("/"));
    expect(callers.sort()).toEqual(["src/lib/jobs/posting-deletion.ts", "src/lib/supabase/types.ts"]);
  });

  it("no file calls lifecycleWaveAllowed yet (W1, W2 and W3 are not built), and none writes a job_posting_lifecycle_runs or tombstone row", () => {
    for (const f of files) {
      if (f.endsWith("src/lib/jobs/lifecycle.ts") || f.endsWith("src/lib/supabase/types.ts")) continue;
      const t = text(f);
      expect(t, f).not.toMatch(/lifecycleWaveAllowed\(/);
      expect(t, f).not.toMatch(/from\(\s*["']job_posting_(lifecycle_runs|tombstones)["']\s*\)/);
    }
  });
});

describe("the handler's guard: the admin session, not the shared secret", () => {
  const url = "https://talentrah.test/admin/job-lifecycle/dry-run";
  const req = (origin: string | null = "https://talentrah.test") => new Request(url, { method: "POST", headers: origin ? { origin } : {} });
  const deps = (admin: { permissions: string[] } | null, world: World = {}) => {
    const f = fake(world);
    const state = { serviceCalls: 0, logs: [] as string[] };
    return {
      f,
      state,
      handlerDeps: () => ({
        getAdmin: async () => admin,
        service: () => { state.serviceCalls += 1; return f.client; },
        now: () => NOW,
        log: (c: string) => { state.logs.push(c); },
      }),
    };
  };

  it("POSITIVE CONTROL: an admin with jobs_import gets the report", async () => {
    const d = deps({ permissions: [LIFECYCLE_DRY_RUN_PERMISSION] }, { openSheetCount: 2 });
    const res = await handleDryRun(req(), d.handlerDeps());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.report.would_close).toEqual({ sheet: 2 });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("a request from another origin, or with none, is refused (403) before anything is read", async () => {
    for (const origin of ["https://evil.test", null]) {
      const d = deps({ permissions: [LIFECYCLE_DRY_RUN_PERMISSION] });
      expect((await handleDryRun(req(origin), d.handlerDeps())).status).toBe(403);
      expect(d.state.serviceCalls).toBe(0);
    }
  });

  it("no admin session is 401; an admin without the permission is 403; neither creates a database client, and neither writes anything (not even an audit row)", async () => {
    const none = deps(null);
    expect((await handleDryRun(req(), none.handlerDeps())).status).toBe(401);
    expect(none.state.serviceCalls).toBe(0);
    const wrong = deps({ permissions: ["blog", "operations", "people"] });
    const res = await handleDryRun(req(), wrong.handlerDeps());
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("missing_permission");
    expect(wrong.state.serviceCalls).toBe(0);
    expect(wrong.f.rec.writes).toEqual([]);
  });

  it("a read failure answers 500 with a class and never the database's own text", async () => {
    const d = deps({ permissions: [LIFECYCLE_DRY_RUN_PERMISSION] }, { failTable: "resumes", eligible: [row("s1", "sheet")] });
    const res = await handleDryRun(req(), d.handlerDeps());
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain("boom");
    expect(JSON.parse(text).code).toBe("read_failed");
    expect(d.state.logs).toEqual(["read_failed"]);
  });

  it("the route file is a POST only, guarded by the handler, and reads no body", () => {
    const route = readFileSync(path.join(process.cwd(), "src/app/admin/job-lifecycle/dry-run/route.ts"), "utf8");
    expect(route).toContain("export async function POST");
    expect(route).not.toMatch(/export async function (GET|PUT|PATCH|DELETE)/);
    expect(route).toContain("handleDryRun(request");
    expect(route).not.toMatch(/requireAdminSecret|requireCronSecret|CRON_SECRET|INGEST_SECRET/);
    expect(route).not.toMatch(/request\.(json|formData|text)\(/);
  });
});
