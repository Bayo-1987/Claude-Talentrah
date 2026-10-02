/**
 * send-513 — migration 0210 pins mentor_unpaid_hold()'s search_path with an ALTER, not a create-or-replace.
 *
 * Supabase's security advisor flags `public.mentor_unpaid_hold` ("Function Search Path Mutable"): 0203 created it without a pinned search_path. The fix
 * is `ALTER FUNCTION ... SET search_path = ''`, so the function BODY cannot drift (a create-or-replace restates the body, and 0203 and a later copy could
 * then disagree about the 30 minutes that UNPAID_HOLD_MINUTES mirrors). The same migration adds a service-role-only catalog read so a test can see the
 * function's config (supabase-js cannot query pg_proc).
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";

const FILE = "supabase/migrations/0210_mentor_unpaid_hold_search_path.sql";
const sql = existsSync(FILE) ? readFileSync(FILE, "utf8") : "";
const code = sql
  .split("\n")
  .filter((l) => !l.trimStart().startsWith("--"))
  .join("\n");

describe("0210", () => {
  it("exists", () => {
    expect(existsSync(FILE), `${FILE} must exist`).toBe(true);
  });

  it("pins the search_path with ALTER FUNCTION, to the empty string", () => {
    expect(code).toMatch(/alter function public\.mentor_unpaid_hold\(\)\s+set search_path = ''\s*;/i);
  });

  it("does not restate the function body (no create-or-replace of mentor_unpaid_hold)", () => {
    expect(code).not.toMatch(/create (or replace )?function public\.mentor_unpaid_hold/i);
  });

  it("verifies in the same migration that the hold is still 30 minutes after the pin", () => {
    expect(code).toMatch(/mentor_unpaid_hold\(\)/);
    expect(code).toMatch(/1800/);
  });

  it("adds the catalog read as service-role only, with its own search_path pinned", () => {
    expect(code).toMatch(/create or replace function public\.function_search_path_audit\(\)/i);
    expect(code).toMatch(/revoke all on function public\.function_search_path_audit\(\) from public, anon, authenticated;/i);
    expect(code).toMatch(/grant execute on function public\.function_search_path_audit\(\) to service_role;/i);
    expect(code).toMatch(/set search_path = ''/i);
  });
});
