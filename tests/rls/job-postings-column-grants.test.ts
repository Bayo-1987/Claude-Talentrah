/**
 * Which job_postings columns the API roles can read is an explicit list (0218), checked against a real database.
 *
 * anon and authenticated hold SELECT on each column by name, not on the table, so a column added to job_postings is NOT readable by them
 * until a migration grants it. This test finds the table's real columns (a service-role read returns every one of them), asks for each
 * column on its own as anon and as a signed-in user, and requires that the set of columns they CANNOT read is exactly RESTRICTED below.
 *
 * It fails in both directions:
 *   - a new column with no grant: "add `grant select (<col>) on public.job_postings to anon, authenticated` in the migration that adds
 *     it, or, if it is meant to be internal, add it to RESTRICTED in this test on purpose";
 *   - a restricted column that became readable again (a re-granted table-level SELECT, a widened grant).
 * Reading a column singly is deliberate: `select *` is refused outright once any column is restricted, which would say nothing about WHICH one.
 * DB-backed: runs in CI only (the local stack applies every migration, 0218 included).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { admin, createAuthedTestUser, deleteTestUsers, type TestUser } from "../support/auth";
import { compareColumnGrants } from "../support/column-grants";

/** The columns anon and authenticated must NOT be able to read. Adding to this list is a decision, not a fix for a failing test. */
const RESTRICTED = ["admin_review_note"] as const;

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const anon: SupabaseClient<Database> = createClient<Database>(URL, ANON, { auth: { autoRefreshToken: false, persistSession: false } });

let user: TestUser & { client: SupabaseClient<Database> };
let columns: string[] = [];

beforeAll(async () => {
  user = await createAuthedTestUser("jp-col-grants");
  const { data, error } = await admin.from("job_postings").select("*").limit(1);
  if (error) throw new Error(`service-role read of job_postings failed: ${error.message}`);
  if (!data?.length) throw new Error("job_postings has no row to read the column list from; the seed did not run");
  columns = Object.keys(data[0]).sort();
});

afterAll(async () => {
  await deleteTestUsers([user.id]);
});

async function unreadable(client: SupabaseClient<Database>): Promise<string[]> {
  const out: string[] = [];
  for (const column of columns) {
    // A column that is granted returns rows or an empty list with no error; a column that is not granted returns 42501.
    const { error } = await (client.from("job_postings") as unknown as { select: (c: string) => { limit: (n: number) => Promise<{ error: { code?: string } | null }> } })
      .select(column)
      .limit(1);
    if (error) {
      expect(error.code, `${column}: expected permission denied (42501), got something else`).toBe("42501");
      out.push(column);
    }
  }
  return out;
}

describe("the columns of job_postings that the API roles cannot read are exactly the restricted ones", () => {
  it("found the table's columns (the check is not empty)", () => {
    expect(columns.length).toBeGreaterThan(30);
    expect(columns).toContain("title");
    for (const r of RESTRICTED) expect(columns, `${r} is a real column`).toContain(r);
  });

  it.each([
    ["anon", () => anon],
    ["a signed-in user", () => user.client],
  ])("%s", async (_who, client) => {
    const { ungranted, restrictedButReadable } = compareColumnGrants({ columns, unreadable: await unreadable(client()), restricted: RESTRICTED });
    expect(
      ungranted,
      `Not readable by the API roles: add \`grant select (<col>) on public.job_postings to anon, authenticated\` in the migration that adds each column, or add it to RESTRICTED in this test on purpose.`,
    ).toEqual([]);
    expect(restrictedButReadable, "a restricted column became readable again").toEqual([]);
  }, 60_000);

  it("the service role still reads every column", () => {
    for (const r of RESTRICTED) expect(columns).toContain(r);
  });
});
