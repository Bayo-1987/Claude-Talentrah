/**
 * Which columns of five payment and verification tables the API roles can read is an explicit list (0231), checked against a real database.
 *
 * The tables are payment_transactions, user_passes, talent_directory_subscriptions, talent_verifications and ad_wallet_ledger. anon holds no privilege on any of them. On the four tables that have restricted columns,
 * authenticated holds SELECT on each column by name, not on the table, EXCEPT the columns in RESTRICTED below: the card authorisation codes, the renewal references and the reviewer's payment record, which are read only
 * on the server. A column added later is therefore NOT readable by authenticated until a migration grants it. ad_wallet_ledger has no restricted column, so authenticated keeps its whole-table SELECT there. The payment
 * reference (paystack_reference) stays readable on payment_transactions and ad_wallet_ledger on purpose. This test holds all of it:
 *   - anon cannot read ANY column of any of the five tables;
 *   - a signed-in user can read every column of each table except exactly RESTRICTED, and `select *` is stopped where something is restricted and allowed on ad_wallet_ledger.
 * It fails in both directions:
 *   - a new column with no grant: "add `grant select (<col>) on public.<table> to authenticated` in the migration that adds it, or add it to RESTRICTED here on purpose";
 *   - a restricted column that became readable again (a re-granted table-level SELECT, a widened grant).
 * Reading a column singly is deliberate: once any column is restricted `select *` is rejected outright, which would say nothing about WHICH one.
 *
 * Where the column list comes from: the generated types (src/lib/supabase/types.ts), joined with the keys of a real row when the table has one (a service-role read returns every column), so a column the types
 * do not know about yet is still picked up. DB-backed: runs in CI only (the local stack applies every migration, 0231 included).
 */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { admin, createAuthedTestUser, deleteTestUsers, type TestUser } from "../support/auth";
import { compareColumnGrants } from "../support/column-grants";

/** The columns authenticated must NOT be able to read, per table. Adding to this list is a decision, not a fix for a failing test. */
const RESTRICTED: Record<string, readonly string[]> = {
  payment_transactions: ["authorization_code"],
  user_passes: ["authorization_code", "pending_renewal_reference"],
  talent_directory_subscriptions: ["authorization_code", "pending_renewal_reference"],
  talent_verifications: ["reviewer_id", "reviewer_notes", "reviewer_paid_at", "reviewer_payout_ngn", "reviewer_payout_reference"],
  ad_wallet_ledger: [],
};
const TABLES = Object.keys(RESTRICTED);
const WITH_RESTRICTED = TABLES.filter((t) => RESTRICTED[t].length > 0);

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const anon: SupabaseClient<Database> = createClient<Database>(URL, ANON, { auth: { autoRefreshToken: false, persistSession: false } });

let user: TestUser & { client: SupabaseClient<Database> };
const columns: Record<string, string[]> = {};

/** The Row keys of a table in the generated types. */
function typedColumns(table: string): string[] {
  const text = readFileSync("src/lib/supabase/types.ts", "utf8");
  const m = text.match(new RegExp(`\\n      ${table}: \\{\\n        Row: \\{\\n([\\s\\S]*?)\\n        \\}\\n        Insert`));
  if (!m) throw new Error(`could not find ${table} in the generated types`);
  return m[1].split("\n").flatMap((l) => {
    const c = l.match(/^\s+([a-z_0-9]+)\??:/);
    return c ? [c[1]] : [];
  });
}

beforeAll(async () => {
  user = await createAuthedTestUser("pay-col-grants");
  for (const table of TABLES) {
    const found = new Set(typedColumns(table));
    const { data, error } = await (admin.from(table as "payment_transactions") as unknown as { select: (c: string) => { limit: (n: number) => Promise<{ data: Record<string, unknown>[] | null; error: { message: string } | null }> } })
      .select("*")
      .limit(1);
    if (error) throw new Error(`service-role read of ${table} failed: ${error.message}`);
    for (const k of Object.keys(data?.[0] ?? {})) found.add(k);
    columns[table] = [...found].sort();
  }
}, 120_000);

afterAll(async () => {
  if (user) await deleteTestUsers([user.id]);
}, 60_000);

type Probe = { select: (c: string) => { limit: (n: number) => Promise<{ error: { code?: string } | null }> } };

async function unreadable(client: SupabaseClient<Database>, table: string): Promise<string[]> {
  const out: string[] = [];
  for (const column of columns[table]) {
    // A granted column returns rows or an empty list with no error (row-level security shows another user nothing); an ungranted column returns 42501.
    const { error } = await (client.from(table as "payment_transactions") as unknown as Probe).select(column).limit(1);
    if (error) {
      expect(error.code, `${table}.${column}: expected permission denied (42501), got something else`).toBe("42501");
      out.push(column);
    }
  }
  return out;
}

describe("payment and verification tables: anon reads nothing; a signed-in user reads every column except the restricted ones", () => {
  it("found each table's columns (the check is not empty)", () => {
    for (const table of TABLES) {
      expect(columns[table].length, `${table} columns`).toBeGreaterThan(5);
      for (const r of RESTRICTED[table]) expect(columns[table], `${r} is a real column of ${table}`).toContain(r);
    }
    expect(columns.talent_verifications, "ai_feedback stays readable: the candidate is shown it").toContain("ai_feedback");
    expect(RESTRICTED.payment_transactions, "paystack_reference stays readable: the billing page and the receipt e-mail show it to the person who paid").not.toContain("paystack_reference");
  });

  it.each(TABLES)("anon: no column of %s is readable", async (table) => {
    const { ungranted, restrictedButReadable } = compareColumnGrants({ columns: columns[table], unreadable: await unreadable(anon, table), restricted: columns[table] });
    expect(ungranted).toEqual([]);
    expect(restrictedButReadable, `anon can read a ${table} column`).toEqual([]);
  }, 60_000);

  it.each(TABLES)("a signed-in user: every column of %s except the restricted ones is readable, and none was added without a grant", async (table) => {
    const { ungranted, restrictedButReadable } = compareColumnGrants({ columns: columns[table], unreadable: await unreadable(user.client, table), restricted: RESTRICTED[table] });
    expect(
      ungranted,
      `Not granted to authenticated on ${table}: add \`grant select (<col>) on public.${table} to authenticated\` in the migration that adds each column, or add it to RESTRICTED in this test on purpose`,
    ).toEqual([]);
    expect(restrictedButReadable, `a restricted ${table} column became readable again by the API roles`).toEqual([]);
  }, 60_000);

  it.each(WITH_RESTRICTED)("a signed-in user: select * on %s is stopped", async (table) => {
    const { error } = await (user.client.from(table as "payment_transactions") as unknown as Probe).select("*").limit(1);
    expect(error?.code, `select * on ${table} should be permission denied (42501)`).toBe("42501");
  }, 60_000);

  it("a signed-in user: select * on ad_wallet_ledger is allowed (nothing is restricted there; row-level security shows another user nothing)", async () => {
    const { error } = await (user.client.from("ad_wallet_ledger" as "payment_transactions") as unknown as Probe).select("*").limit(1);
    expect(error, "select * on ad_wallet_ledger should not be denied").toBeNull();
  }, 60_000);
});
