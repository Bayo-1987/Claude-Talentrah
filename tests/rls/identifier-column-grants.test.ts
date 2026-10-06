/**
 * Which columns of four public tables the API roles can read is an explicit list (0232), checked against a real database (CI only).
 *
 * The tables are organizations, scholarships, blog_posts and mentorship_reviews, and THEY ARE READABLE BY BOTH ROLES: a signed-out visitor (anon) and a signed-in user (authenticated) hold SELECT on every column
 * by name except the withheld ones (tests/support/identifier-column-guard-titles.ts lists them): the user id of whoever created, edited or reviewed a row, a moderation note, an employer's company-registration details,
 * and which mentee wrote which review of which session. Those are read only on the server, with the service role. A column added later is therefore NOT readable by either role until a migration grants it. This test holds:
 *   - for each role and table, every column except exactly the withheld ones is readable, each withheld one is refused (42501), and `select *` is stopped;
 *   - the one policy that read a withheld column still works: an employer creates an organisation and joins it, and another user cannot join it (the rule now asks is_organization_creator).
 * It fails in both directions: a new column with no grant says "add `grant select (<col>) on public.<table> to anon, authenticated` in the migration that adds it, or add it to the withheld list here on purpose",
 * and a withheld column that became readable again (a re-granted table-level SELECT, a widened grant) fails by name.
 * Reading a column singly is deliberate: once any column is withheld `select *` is rejected outright, which would say nothing about WHICH one.
 *
 * Where the column list comes from: the generated types (src/lib/supabase/types.ts), joined with the keys of a real row when the table has one (a service-role read returns every column), so a column the types do
 * not know about yet is still picked up. mentorship_reviews has no rows on production; where the table is empty the types alone supply the list. DB-backed: runs in CI only, where the local stack applies every migration.
 * The REQUIRED list in scripts/assert-named-tests-ran.ts names these tests so a run in which they were skipped fails.
 */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { Database } from "@/lib/supabase/types";
import { admin, createAuthedTestUser, deleteTestUsers, type TestUser } from "../support/auth";
import { compareColumnGrants } from "../support/column-grants";
import { deleteTestOrgs } from "../support/cleanup";
import { IDENTIFIER_DESCRIBE, IDENTIFIER_ROLES, IDENTIFIER_TABLES, WITHHELD_IDENTIFIER_COLUMNS, identifierNames } from "../support/identifier-column-guard-titles";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const anon: SupabaseClient<Database> = createClient<Database>(URL, ANON, { auth: { autoRefreshToken: false, persistSession: false } });

type AuthedUser = TestUser & { client: SupabaseClient<Database> };
let user: AuthedUser;
let other: AuthedUser;
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
  user = await createAuthedTestUser("ident-col-grants");
  other = await createAuthedTestUser("ident-col-other");
  for (const table of IDENTIFIER_TABLES) {
    const found = new Set(typedColumns(table));
    const { data, error } = await (admin.from(table as "organizations") as unknown as { select: (c: string) => { limit: (n: number) => Promise<{ data: Record<string, unknown>[] | null; error: { message: string } | null }> } })
      .select("*")
      .limit(1);
    if (error) throw new Error(`service-role read of ${table} failed: ${error.message}`);
    for (const k of Object.keys(data?.[0] ?? {})) found.add(k);
    columns[table] = [...found].sort();
  }
}, 120_000);

afterAll(async () => {
  const ids = [user?.id, other?.id].filter((x): x is string => !!x);
  if (ids.length) await deleteTestUsers(ids);
}, 60_000);

type Probe = { select: (c: string) => { limit: (n: number) => Promise<{ error: { code?: string } | null }> } };

async function unreadable(client: SupabaseClient<Database>, table: string): Promise<string[]> {
  const out: string[] = [];
  for (const column of columns[table]) {
    // A granted column returns rows or an empty list with no error (row-level security decides which rows); an ungranted column returns 42501.
    const { error } = await (client.from(table as "organizations") as unknown as Probe).select(column).limit(1);
    if (error) {
      expect(error.code, `${table}.${column}: expected permission denied (42501), got something else`).toBe("42501");
      out.push(column);
    }
  }
  return out;
}

const clientFor = (role: (typeof IDENTIFIER_ROLES)[number]): SupabaseClient<Database> => (role === "a signed-out visitor" ? anon : user.client);

describe(IDENTIFIER_DESCRIBE, () => {
  it(identifierNames.found, () => {
    for (const table of IDENTIFIER_TABLES) {
      expect(columns[table].length, `${table} columns`).toBeGreaterThan(4);
      for (const w of WITHHELD_IDENTIFIER_COLUMNS[table]) expect(columns[table], `${w} is a real column of ${table}`).toContain(w);
    }
  });

  for (const table of IDENTIFIER_TABLES) {
    for (const role of IDENTIFIER_ROLES) {
      it(identifierNames.columns(role, table), async () => {
        const restricted = WITHHELD_IDENTIFIER_COLUMNS[table];
        const { ungranted, restrictedButReadable } = compareColumnGrants({ columns: columns[table], unreadable: await unreadable(clientFor(role), table), restricted });
        expect(
          ungranted,
          `Not granted to anon and authenticated on ${table}: add \`grant select (<col>) on public.${table} to anon, authenticated\` in the migration that adds each column, or add it to WITHHELD_IDENTIFIER_COLUMNS (tests/support/identifier-column-guard-titles.ts) on purpose`,
        ).toEqual([]);
        expect(restrictedButReadable, `a withheld ${table} column became readable again by ${role}`).toEqual([]);
      }, 60_000);
    }
  }

  for (const table of IDENTIFIER_TABLES) {
    for (const role of IDENTIFIER_ROLES) {
      it(identifierNames.star(role, table), async () => {
        const { error } = await (clientFor(role).from(table as "organizations") as unknown as Probe).select("*").limit(1);
        expect(error?.code, `select * on ${table} as ${role} should be permission denied (42501)`).toBe("42501");
      }, 60_000);
    }
  }

  it(identifierNames.creator, async () => {
    const { data: org, error: createError } = await user.client
      .from("organizations")
      .insert({ name: `IDENT-GRANTS-TEST ${randomUUID().slice(0, 8)}`, created_by: user.id })
      .select("id")
      .single();
    expect(createError, "an ordinary organisation creation (RETURNING id) must still succeed").toBeNull();
    try {
      const joined = await user.client.from("organization_members").insert({ organization_id: org!.id, user_id: user.id, role: "owner" });
      expect(joined.error, "the creator must still be able to join the organisation they created").toBeNull();
      const stranger = await other.client.from("organization_members").insert({ organization_id: org!.id, user_id: other.id, role: "owner" });
      expect(stranger.error, "a user who did not create the organisation joined it").not.toBeNull();
      const { data: rows } = await admin.from("organization_members").select("user_id").eq("organization_id", org!.id);
      expect((rows ?? []).map((r) => r.user_id)).toEqual([user.id]);
    } finally {
      if (org?.id) await deleteTestOrgs([org.id]);
    }
  }, 60_000);
});
