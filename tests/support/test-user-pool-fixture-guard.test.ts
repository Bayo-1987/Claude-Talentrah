/**
 * #593 — standing guard: no test may put a leaseless row into `test_user_pool`.
 *
 * WHY. `claim_test_pool_user` (0188) hands out any row with `leased_by is null`. A row a test inserts by hand without a
 * lease is therefore claimable by whichever other test file claims next, and the auth user behind it is then deleted
 * by the file that made it. The claimant's `updateUserById` fails (404 `user_not_found`, or a 5xx while the delete is
 * in flight). `tests/rls/test-user-pool-privileges.test.ts` did exactly this.
 *
 * THE RULE. In every `.ts`/`.tsx` file under `tests/` and `e2e/` (this file excepted), every call shaped
 * `<receiver>.from("test_user_pool").insert(…)` or `.upsert(…)` must mention `leased_by` in its argument — measured on
 * the text with whitespace collapsed and parentheses balanced, so a chain split over lines or an argument containing
 * `new Date().toISOString()` is read whole. The only receivers exempt are `anon` and `authedUser.client`: those calls
 * are the assertions that the write is REFUSED, and nothing lands. Any other receiver — including a new name for the
 * service-role client — is checked, so a new offender fails by default rather than slipping past an allowlist of names.
 *
 * NOT COVERED. `update` (e.g. setting `leased_by: null`), raw SQL, and `rpc("add_test_pool_user")` — that function
 * always inserts with a lease. The guard also cannot see a row inserted some way this scan does not recognise; the
 * sanity check below fails if the scan stops finding the call sites it is supposed to be reading.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const REFUSED_WRITE_RECEIVERS = new Set(["anon", "authedUser.client"]);

export interface PoolInsertSite {
  receiver: string;
  verb: "insert" | "upsert";
  args: string;
  leased: boolean;
  exempt: boolean;
}

/** Every `X.from("test_user_pool").insert|upsert(…)` call in `source`, with its argument text. */
export function findPoolInsertSites(source: string): PoolInsertSite[] {
  const flat = source.replace(/\s+/g, " ");
  const head = /([\w.]+) ?\. ?from\( ?["']test_user_pool["'] ?\) ?\. ?(insert|upsert) ?\(/g;
  const sites: PoolInsertSite[] = [];
  for (let m = head.exec(flat); m; m = head.exec(flat)) {
    let depth = 1;
    let i = head.lastIndex;
    while (i < flat.length && depth > 0) {
      if (flat[i] === "(") depth++;
      else if (flat[i] === ")") depth--;
      i++;
    }
    const args = flat.slice(head.lastIndex, i - 1);
    sites.push({
      receiver: m[1],
      verb: m[2] as "insert" | "upsert",
      args,
      leased: /\bleased_by\b/.test(args),
      exempt: REFUSED_WRITE_RECEIVERS.has(m[1]),
    });
  }
  return sites;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe("the scan itself (synthetic sources)", () => {
  it("flags a leaseless insert, including one split over lines and one with nested parentheses", () => {
    expect(findPoolInsertSites(`await admin\n  .from("test_user_pool")\n  .insert({ user_id: id });`)[0]).toMatchObject({
      receiver: "admin",
      leased: false,
      exempt: false,
    });
    const nested = findPoolInsertSites(
      `await sb.from('test_user_pool').upsert({ user_id: id, leased_at: new Date().toISOString() });`,
    );
    expect(nested).toHaveLength(1);
    expect(nested[0]).toMatchObject({ receiver: "sb", verb: "upsert", leased: false, exempt: false });
  });

  it("accepts an insert that names leased_by, and exempts only the refused-write receivers", () => {
    expect(findPoolInsertSites(`admin.from("test_user_pool").insert({ user_id: id, leased_by: "x" })`)[0].leased).toBe(true);
    expect(findPoolInsertSites(`anon.from("test_user_pool").insert({ user_id: id })`)[0].exempt).toBe(true);
    expect(findPoolInsertSites(`authedUser.client.from("test_user_pool").insert({ user_id: id })`)[0].exempt).toBe(true);
    expect(findPoolInsertSites(`otherClient.from("test_user_pool").insert({ user_id: id })`)[0].exempt).toBe(false);
  });

  it("ignores reads, updates and other tables", () => {
    expect(findPoolInsertSites(`admin.from("test_user_pool").select("user_id")`)).toEqual([]);
    expect(findPoolInsertSites(`admin.from("test_user_pool").update({ prefix: "x" })`)).toEqual([]);
    expect(findPoolInsertSites(`admin.from("profiles").insert({ id })`)).toEqual([]);
  });
});

describe("no test seeds a claimable row into test_user_pool", () => {
  const root = process.cwd();
  const files = ["tests", "e2e"].flatMap((d) => walk(join(root, d))).filter((f) => !f.endsWith("test-user-pool-fixture-guard.test.ts"));
  const sites = files.flatMap((f) => findPoolInsertSites(readFileSync(f, "utf8")).map((s) => ({ file: relative(root, f), ...s })));

  it("reads the call sites it is meant to guard (a scan that finds nothing proves nothing)", () => {
    expect(sites.some((s) => !s.exempt), "no service-role insert into test_user_pool found — has the scan gone blind?").toBe(true);
    expect(sites.some((s) => s.exempt), "no refused-write assertion found — has the scan gone blind?").toBe(true);
  });

  it("every insert/upsert that can land carries a lease (leased_by)", () => {
    const offenders = sites.filter((s) => !s.exempt && !s.leased).map((s) => `${s.file}: ${s.receiver}.from("test_user_pool").${s.verb}(${s.args})`);
    expect(offenders, "a leaseless test_user_pool row is claimable by any concurrent test file (#593)").toEqual([]);
  });
});
