/**
 * Migration 0236 (the atomic free-message claim for Farah chat) — its shape, read from the file (no database). The behaviour is in tests/farah/free-claim.test.ts (CI only); this pins what a reviewer
 * would otherwise have to find by reading the SQL.
 *
 * WHAT IT IS. Today the gate reads how many free messages an account has used and, if fewer than 3, answers "free"; nothing is written until after the model call. Parallel requests all pass that read,
 * all call the model and all commit, so an account can use more than 3 free messages (tests/farah/chat-gate-concurrent-commit.test.ts characterised it). The claim makes the decision ONE locked step
 * taken BEFORE the model call: a function counts committed free messages plus unexpired pending claims for the account under a per-account lock, and records a pending claim only if the count is below
 * the allowance. A successful reply commits the claim into the existing free-allowance event; a failed one releases it; one that is never settled (a crash) expires by itself.
 *
 * It adds one table and three functions and changes nothing that exists (not credit_gate_events, not its policies or grants, not 0223 or 0235).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseAccountDeletionMap } from "../support/account-deletion-map";

const FILE = join(__dirname, "../../supabase/migrations/0236_farah_free_claims.sql");
const ROLLBACK = join(__dirname, "../../supabase/rollbacks/0236_farah_free_claims.rollback.sql");
const strip = (t: string) => t.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n").replace(/\s+/g, " ").toLowerCase();
const sql = existsSync(FILE) ? readFileSync(FILE, "utf8") : "";
const flat = strip(sql);
const T = "public.farah_free_claims";
const between = (from: string, to?: string) => {
  const a = flat.indexOf(from);
  const b = to ? flat.indexOf(to, a + 1) : -1;
  return a < 0 ? "" : flat.slice(a, b < 0 ? undefined : b);
};
const claim = between("create or replace function public.claim_farah_free_message(", "create or replace function public.commit_farah_free_claim(");
const commit = between("create or replace function public.commit_farah_free_claim(", "create or replace function public.release_farah_free_claim(");
const release = between("create or replace function public.release_farah_free_claim(");

describe("0236: the file", () => {
  it("exists, under this exact name (0236 is the number the owner assigned)", () => {
    expect(existsSync(FILE)).toBe(true);
  });
});

describe("0236: it adds one table and three functions and touches nothing that exists", () => {
  it("creates exactly one table, with the four columns, an id that generates itself, and a link to the account that goes with it", () => {
    expect((flat.match(/\bcreate table\b/g) ?? []).length).toBe(1);
    expect(flat).toContain(`create table ${T} (`);
    expect(flat).toMatch(/id uuid primary key default gen_random_uuid\(\)/);
    expect(flat).toMatch(/user_id uuid not null references public\.profiles\(id\) on delete cascade/);
    expect(flat).toMatch(/claimed_at timestamptz not null default now\(\)/);
    expect(flat).toMatch(/expires_at timestamptz not null/);
    expect(flat).toMatch(/check \(expires_at > claimed_at\)/);
  });

  it("indexes the lookup the claim makes (this account's claims by expiry)", () => {
    expect(flat).toMatch(/create index [a-z_]+ on public\.farah_free_claims \(user_id, expires_at\)/);
  });

  it("alters, drops or redefines nothing that exists: not credit_gate_events, not the usage counter of 0223, not the 0235 objects", () => {
    expect(flat).not.toMatch(/\balter table\b(?! public\.farah_free_claims)/);
    expect(flat).not.toMatch(/\bdrop\b/);
    expect(flat).not.toMatch(/\bcreate policy\b/);
    expect(flat).not.toMatch(/(update|delete from|truncate( table)?) public\.credit_gate_events/);
    // (the names are assembled so that the isolation test, which keeps the usage counter's names out of every other test file, does not mistake this guard for a user of the counter)
    const counterObjects = [["llm", "daily", "usage"], ["add", "llm", "usage"], ["claim", "llm", "alert", "attempt"], ["mark", "llm", "alert", "sent"]].map((parts) => parts.join("_"));
    for (const name of counterObjects) expect(flat, name).not.toContain(name);
  });

  it("creates exactly three functions", () => {
    expect((flat.match(/\bcreate (or replace )?function\b/g) ?? []).length).toBe(3);
  });
});

describe("0236: the table is server-only", () => {
  it("row level security on, and no policy at all", () => {
    expect(flat).toContain(`alter table ${T} enable row level security`);
  });

  it("every privilege revoked from everyone, then select, insert and delete (not update) granted to service_role only", () => {
    expect(flat).toContain(`revoke all on table ${T} from public, anon, authenticated, service_role`);
    const grants = [...flat.matchAll(new RegExp(`grant ([a-z, ]+) on table ${T.replace(".", "\\.")} to ([a-z_, ]+)`, "g"))].map((m) => `${m[1].trim()} -> ${m[2].trim()}`);
    expect(grants).toEqual(["select, insert, delete -> service_role"]);
  });
});

describe("0236: claim_farah_free_message: one locked step decides, in the database, whether this account may have a free message", () => {
  it("signature, defaults (3 free, a 30 day window, a 120 second hold), returns (ok, claim_id, used), SECURITY INVOKER, search_path pinned to empty", () => {
    expect(claim).toContain("claim_farah_free_message(p_user_id uuid, p_allowance integer default 3, p_window_days integer default 30, p_hold_seconds integer default 120)");
    expect(claim).toMatch(/returns table \(ok boolean, claim_id uuid, used integer\)/);
    expect(claim).toMatch(/language plpgsql security invoker set search_path = ''/);
    expect(claim).not.toMatch(/security definer/);
  });

  it("refuses a missing account and out-of-range limits with SQLSTATE 22023, so a bad caller cannot switch the bound off", () => {
    expect(claim).toMatch(/p_user_id is null/);
    expect(claim).toMatch(/p_allowance is null or p_allowance < 1 or p_allowance > 10(?!\d)/);
    expect(claim).toMatch(/p_window_days is null or p_window_days < 1 or p_window_days > 400(?!\d)/);
    expect(claim).toMatch(/p_hold_seconds is null or p_hold_seconds < 10 or p_hold_seconds > 600(?!\d)/);
    expect((claim.match(/errcode = '22023'/g) ?? []).length).toBe(4);
  });

  it("takes a per-account advisory lock BEFORE it counts, so two claims for one account cannot both count the same state", () => {
    const lock = claim.indexOf("pg_advisory_xact_lock(pg_catalog.hashtextextended('farah_free_claim:' || p_user_id::text, 0))");
    expect(lock).toBeGreaterThan(-1);
    expect(lock).toBeLessThan(claim.indexOf("count(*)"));
    expect(lock).toBeLessThan(claim.indexOf("insert into"));
  });

  it("sweeps THIS account's expired claims, then counts committed free messages in the window PLUS unexpired claims in ONE statement (one snapshot, so a commit in between cannot be missed or counted twice)", () => {
    expect(claim).toMatch(/delete from public\.farah_free_claims where user_id = p_user_id and expires_at <= pg_catalog\.now\(\)/);
    const count = claim.slice(claim.indexOf("select (select"), claim.indexOf("into v_used"));
    expect(count).toContain("from public.credit_gate_events e");
    expect(count).toMatch(/e\.reason = 'farah_chat_message'/);
    expect(count).toMatch(/e\.outcome = 'covered_by_free_allowance'/);
    expect(count).toMatch(/e\.created_at >= pg_catalog\.now\(\) - pg_catalog\.make_interval\(days => p_window_days\)/);
    expect(count).toContain("from public.farah_free_claims c");
    expect(count).toMatch(/c\.expires_at > pg_catalog\.now\(\)/);
    expect(count).toContain(") + (select");
    expect((claim.match(/\bselect \(select\b/g) ?? []).length).toBe(1);
  });

  it("inserts one pending claim only when the count is below the allowance, and answers (true, its id, the count including it) or (false, null, the count)", () => {
    expect((claim.match(/\binsert into\b/g) ?? []).length).toBe(1);
    expect(claim).toMatch(/if v_used < p_allowance then insert into public\.farah_free_claims \(user_id, expires_at\) values \(p_user_id, pg_catalog\.now\(\) \+ pg_catalog\.make_interval\(secs => p_hold_seconds\)\) returning id into v_id;/);
    expect(claim).toMatch(/return query select true, v_id, v_used \+ 1/);
    expect(claim).toMatch(/return query select false, null::uuid, v_used/);
  });
});

describe("0236: commit_farah_free_claim: the claim becomes the free-allowance event, in one statement, once", () => {
  it("signature, returns boolean, SECURITY INVOKER, search_path pinned to empty, bad input refused with 22023", () => {
    expect(commit).toContain("commit_farah_free_claim(p_claim_id uuid, p_user_id uuid, p_credits_available integer) returns boolean");
    expect(commit).toMatch(/language plpgsql security invoker set search_path = ''/);
    expect(commit).toMatch(/p_claim_id is null or p_user_id is null or p_credits_available is null or p_credits_available < 0/);
    expect(commit).toMatch(/errcode = '22023'/);
  });

  it("is ONE statement: delete this account's claim, and insert the committed event from it only if it had not expired (an expired one is removed and records nothing)", () => {
    expect(commit).toMatch(/with c as \(delete from public\.farah_free_claims where id = p_claim_id and user_id = p_user_id returning expires_at\)/);
    expect(commit).toContain("insert into public.credit_gate_events (user_id, reason, credits_required, credits_available, outcome)");
    expect(commit).toMatch(/select p_user_id, 'farah_chat_message'::public\.credit_reason, 0, p_credits_available, 'covered_by_free_allowance'::public\.credit_gate_outcome from c where c\.expires_at > pg_catalog\.now\(\) returning 1 into v_done/);
    expect(commit).toMatch(/return v_done is not null/);
    expect((commit.match(/\binsert into\b/g) ?? []).length).toBe(1);
  });
});

describe("0236: release_farah_free_claim: gives the slot back", () => {
  it("signature, returns boolean, SECURITY INVOKER, search_path pinned to empty; one delete of this account's claim", () => {
    expect(release).toContain("release_farah_free_claim(p_claim_id uuid, p_user_id uuid) returns boolean");
    expect(release).toMatch(/language plpgsql security invoker set search_path = ''/);
    expect(release).toMatch(/delete from public\.farah_free_claims where id = p_claim_id and user_id = p_user_id returning 1 into v_released/);
    expect(release).toMatch(/return v_released is not null/);
    expect((release.match(/\bdelete from\b/g) ?? []).length).toBe(1);
  });
});

describe("0236: all three functions are service_role only", () => {
  it("states the grants: revoked from everyone, executable by service_role only, for each function", () => {
    for (const sig of ["claim_farah_free_message(uuid, integer, integer, integer)", "commit_farah_free_claim(uuid, uuid, integer)", "release_farah_free_claim(uuid, uuid)"]) {
      expect(flat).toContain(`revoke all on function public.${sig} from public, anon, authenticated, service_role`);
    }
    const grants = [...flat.matchAll(/grant execute on function (public\.[a-z_]+\([a-z, ]+\)) to ([a-z_, ]+)/g)].map((m) => `${m[1]} -> ${m[2].trim()}`);
    expect(grants).toEqual([
      "public.claim_farah_free_message(uuid, integer, integer, integer) -> service_role",
      "public.commit_farah_free_claim(uuid, uuid, integer) -> service_role",
      "public.release_farah_free_claim(uuid, uuid) -> service_role",
    ]);
  });

  it("checks itself when applied: no client role can execute any of them or touch the table, PUBLIC cannot, service_role can (and can read and write the free-allowance events), none is SECURITY DEFINER, RLS is on with no policy", () => {
    expect(flat).toMatch(/\bdo \$[a-z]*\$/);
    expect(flat).toMatch(/has_function_privilege\(r, v_fn, 'execute'\)/);
    expect(flat).toMatch(/has_table_privilege\(r, v_table, 'select, insert, update, delete, truncate, references, trigger'\)/);
    expect(flat).toMatch(/has_table_privilege\('service_role', 'public\.credit_gate_events', 'insert'\)/);
    // claim_farah_free_message READS credit_gate_events to count the committed free messages, so the check needs SELECT as its own test (a comma list passes on either privilege)
    expect(flat).toMatch(/has_table_privilege\('service_role', 'public\.credit_gate_events', 'select'\)/);
    expect(flat).toContain("0236 self-check: service_role cannot select from public.credit_gate_events");
    expect(flat).toMatch(/relrowsecurity/);
    expect(flat).toMatch(/prosecdef/);
    expect(flat).toMatch(/pg_policy/);
    expect(flat).toMatch(/raise exception '0236 self-check/);
  });
});

describe("0236: the rollback sits beside it, outside the migrations directory", () => {
  const rb = existsSync(ROLLBACK) ? strip(readFileSync(ROLLBACK, "utf8")) : "";

  it("exists", () => {
    expect(existsSync(ROLLBACK)).toBe(true);
  });

  it("drops the three functions (with their exact argument lists) and then the table, and nothing else", () => {
    const drops = [...rb.matchAll(/\bdrop (function|table)\b ([^;]+);/g)].map((m) => `${m[1]} ${m[2].trim()}`);
    expect(drops).toEqual([
      "function public.claim_farah_free_message(uuid, integer, integer, integer)",
      "function public.commit_farah_free_claim(uuid, uuid, integer)",
      "function public.release_farah_free_claim(uuid, uuid)",
      `table ${T}`,
    ]);
    expect(rb).not.toMatch(/\bdelete from\b|\btruncate\b|alter table|credit_gate_events/);
  });

  it("checks that all four are gone", () => {
    expect(rb).toMatch(/\bdo \$[a-z]*\$/);
    expect(rb).toMatch(/raise exception '0236 rollback self-check/);
  });
});

describe("0236: the new foreign key into a person is classified in the account-deletion map", () => {
  // tests/rls/account-deletion-fk-map.test.ts compares the LIVE keys with the map but needs a database (CI only); this is the same decision checked without one, so a missing row fails here first.
  const map = parseAccountDeletionMap(readFileSync(join(__dirname, "../../docs/account-deletion-map.md"), "utf8"));
  const entry = map.keys.find((k) => k.key === "farah_free_claims.user_id");

  it("the table points at profiles and cascades (the file says so)", () => {
    expect(flat).toMatch(/user_id uuid not null references public\.profiles\(id\) on delete cascade/);
  });

  it("docs/account-deletion-map.md has a row for farah_free_claims.user_id, recording the same parent and ON DELETE, with the class 'delete'", () => {
    expect(entry, "add the key to docs/account-deletion-map.md with a class").toBeTruthy();
    expect({ parent: entry?.parent, onDelete: entry?.onDelete }).toEqual({ parent: "profiles", onDelete: "CASCADE" });
    expect(entry?.cls).toBe("delete");
  });
});
