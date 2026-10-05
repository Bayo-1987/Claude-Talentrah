/**
 * Keeps the usage counter from being touched by tests that do not own it. The counter row for today is shared by every test run against one database, and
 * tests/farah/llm-usage-counter.test.ts reads its totals as deltas; a second test adding to it concurrently would break that, so only the files listed here may reach it.
 * Source scans, no database.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "../..");
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}
const rel = (p: string) => p.slice(ROOT.length + 1);
const files = [...walk(join(ROOT, "tests")), ...walk(join(ROOT, "e2e"))].map((p) => ({ path: rel(p), text: readFileSync(p, "utf8") }));

/** Files that call the counter's RPC by name, on purpose. */
const MAY_CALL_THE_RPC = new Set([
  "tests/farah/llm-usage-counter.test.ts",
  "tests/rls/llm-usage-grants.test.ts",
  "tests/farah/spend-tally.test.ts",
  "tests/farah/tally-isolation.test.ts",
  "tests/supabase/migration-0223-shape.test.ts",
  // names the migration FILE (to pin its bytes); never touches the table or the function
  "tests/supabase/applied-migrations-not-edited.test.ts",
]);

describe("only the counter's own tests reach the usage counter", () => {
  it("the RPC name appears in no other test or e2e file", () => {
    const offenders = files.filter((f) => f.text.includes("add_llm_usage") && !MAY_CALL_THE_RPC.has(f.path)).map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it("no e2e spec touches the counter", () => {
    expect(files.filter((f) => f.path.startsWith("e2e/") && /add_llm_usage|llm_daily_usage/.test(f.text)).map((f) => f.path)).toEqual([]);
  });

  it("every test file that imports the chat route installs a spend-tally mock (the helper's, or its own)", () => {
    // A real import of the route (static or dynamic), not a test that merely reads its source as text.
    const routeTests = files.filter((f) => f.path.startsWith("tests/") && /(from\s+|import\(\s*)["']@\/app\/api\/farah\/chat\/route["']/.test(f.text));
    expect(routeTests.length).toBeGreaterThan(5);
    const missing = routeTests.filter((f) => !/vi\.mock\(\s*["']@\/lib\/farah\/spend-tally["']/.test(f.text)).map((f) => f.path);
    expect(missing).toEqual([]);
  });

  it("the usage table is read or written directly only by the counter's own tests and its migration", () => {
    const offenders = files.filter((f) => f.text.includes("llm_daily_usage") && !MAY_CALL_THE_RPC.has(f.path)).map((f) => f.path);
    expect(offenders).toEqual([]);
  });
});
