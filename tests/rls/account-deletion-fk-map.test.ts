/**
 * ACCT-1 — the foreign-key catalogue test: the most important test in the account-deletion work.
 *
 * Deleting a person is only safe if somebody has decided, for every place that points at them, what happens there. This reads the LIVE foreign keys
 * into `profiles` and `auth.users` (account_deletion_fk_catalog(), 0209) and the live storage buckets, and compares them with
 * docs/account-deletion-map.md:
 *
 *   - a foreign key the map does not classify FAILS (a new table that points at a person must be decided before it ships);
 *   - a map entry for a key that no longer exists FAILS (a stale classification is a wrong one);
 *   - an entry whose recorded ON DELETE disagrees with the database FAILS (someone changed a cascade without revisiting what deletion means);
 *   - a storage bucket the map does not classify FAILS, and so does a stale one.
 *
 * The `auth.*` row stands for every table in the auth schema pointing at auth.users.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { admin } from "../support/auth";
import { parseAccountDeletionMap } from "../support/account-deletion-map";

const map = parseAccountDeletionMap(readFileSync(join(__dirname, "../../docs/account-deletion-map.md"), "utf8"));

async function liveKeys() {
  const { data, error } = await admin.rpc("account_deletion_fk_catalog");
  expect(error).toBeNull();
  return (data ?? []) as Array<{ child_table: string; child_column: string; parent_table: string; on_delete: string; nullable: boolean }>;
}

describe("every foreign key into a person is classified in docs/account-deletion-map.md", () => {
  it("no live key is missing from the map", async () => {
    const live = await liveKeys();
    const known = new Set(map.keys.map((k) => k.key));
    const missing = live.filter((r) => !(r.child_table.startsWith("auth.") ? known.has("auth.*") : known.has(`${r.child_table}.${r.child_column}`)));
    expect(
      missing.map((r) => `${r.child_table}.${r.child_column} -> ${r.parent_table} (${r.on_delete})`),
      "a new foreign key into a person: add it to docs/account-deletion-map.md with a class",
    ).toEqual([]);
  });

  it("no map entry names a key that does not exist", async () => {
    const live = await liveKeys();
    const liveNames = new Set(live.filter((r) => !r.child_table.startsWith("auth.")).map((r) => `${r.child_table}.${r.child_column}`));
    const stale = map.keys.filter((k) => k.key !== "auth.*" && !liveNames.has(k.key));
    expect(stale.map((k) => k.key), "remove the stale entries from docs/account-deletion-map.md").toEqual([]);
    if (map.keys.some((k) => k.key === "auth.*")) expect(live.some((r) => r.child_table.startsWith("auth."))).toBe(true);
  });

  it("every recorded ON DELETE matches the database", async () => {
    const live = await liveKeys();
    const byKey = new Map(live.filter((r) => !r.child_table.startsWith("auth.")).map((r) => [`${r.child_table}.${r.child_column}`, r]));
    const wrong = map.keys
      .filter((k) => k.key !== "auth.*" && byKey.has(k.key))
      .filter((k) => byKey.get(k.key)!.on_delete !== k.onDelete || byKey.get(k.key)!.parent_table !== k.parent)
      .map((k) => `${k.key}: map says ${k.parent}/${k.onDelete}, database says ${byKey.get(k.key)!.parent_table}/${byKey.get(k.key)!.on_delete}`);
    expect(wrong).toEqual([]);
  });

  it("every SET NULL key is nullable (so the delete can actually null it)", async () => {
    const live = await liveKeys();
    expect(live.filter((r) => r.on_delete === "SET NULL" && !r.nullable).map((r) => `${r.child_table}.${r.child_column}`)).toEqual([]);
  });
});

describe("every storage bucket is classified", () => {
  it("the live buckets and the map's buckets are the same set", async () => {
    const { data, error } = await admin.storage.listBuckets();
    expect(error).toBeNull();
    const live = (data ?? []).map((b) => b.id).sort();
    expect(live, "a new storage bucket: add it to docs/account-deletion-map.md (is it the person's, or an organisation's?)").toEqual(map.buckets.map((b) => b.bucket).sort());
  });
});
