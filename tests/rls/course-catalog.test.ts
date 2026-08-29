/**
 * The course catalog's access shape, and the one rule the admin screen adds.
 *
 * 0061 got this right on the day and this suite is the standing proof, because
 * "right today" is how 0064 described itself an hour before a test found the
 * hole. The shape is unusual enough to be worth pinning: PUBLICLY READABLE and
 * WRITABLE BY NOBODY. Every other table in this repo that anyone can read is
 * also writable by someone.
 *
 * Note what makes 0061's revoke work where 0064's first attempt did not. 0061
 * revoked the VERBS at TABLE level — `revoke insert, update, delete` — which is
 * the level that actually removes the privilege. 0064 tried to revoke a single
 * COLUMN while the table-level UPDATE grant was still live, and a table grant
 * overrides a column revoke, so it did nothing. Same distinction, opposite
 * outcome, and only measurement tells them apart.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { admin, createAuthedTestUser, deleteTestUsers, type DB } from "../support/auth";
import type { Database } from "@/lib/supabase/types";

const anon: DB = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

let seeker: Awaited<ReturnType<typeof createAuthedTestUser>>;
let rowId: string;
const FIXTURE_TITLE = `CATALOG-TEST ${randomUUID()}`;

beforeAll(async () => {
  seeker = await createAuthedTestUser("catalog");
  // Its own row, never a borrowed one — the mistake corrected in c3e8eae.
  const { data, error } = await admin
    .from("course_recommendations")
    .insert({
      skill_tag: "catalog-test",
      provider: "CATALOG-TEST Provider",
      title: FIXTURE_TITLE,
      affiliate_url: "https://example.test/catalog?ref=talentrah-placeholder",
      price_tier: "free",
      active: false,
    })
    .select("id")
    .single();
  if (error) throw new Error(`could not create the fixture course: ${error.message}`);
  rowId = data.id;
});

afterAll(async () => {
  const { error } = await admin.from("course_recommendations").delete().eq("id", rowId);
  if (error) console.warn(`[cleanup] fixture course survived: ${error.message}`);
  await deleteTestUsers([seeker.id]);
});

describe("the catalog is readable by everyone", () => {
  it("a signed-out visitor can read it — this is marketing content", async () => {
    const { data, error } = await anon
      .from("course_recommendations")
      .select("id, title, active")
      .eq("id", rowId);
    expect(error).toBeNull();
    // Readable even while inactive: the SELECT policy is `using (true)`, and
    // the active filter lives in the application's query, not in RLS.
    expect(data).toHaveLength(1);
  });
});

describe("and writable by nobody but the service role", () => {
  it("a signed-in user cannot flip a course live", async () => {
    // The escalation that matters: `active` is what puts an affiliate link in
    // front of every user of the product.
    const { error } = await seeker.client
      .from("course_recommendations")
      .update({ active: true })
      .eq("id", rowId);
    expect(error, "a seeker could activate a course — the revoke is gone").not.toBeNull();

    // A revoked privilege errors; a policy denial silently affects zero rows.
    // Only the service role can tell those apart from success.
    const { data } = await admin
      .from("course_recommendations")
      .select("active")
      .eq("id", rowId)
      .single();
    expect(data?.active).toBe(false);
  });

  it("a signed-in user cannot rewrite an affiliate URL to their own", async () => {
    const { error } = await seeker.client
      .from("course_recommendations")
      .update({ affiliate_url: "https://evil.test/?ref=theirs" })
      .eq("id", rowId);
    expect(error).not.toBeNull();

    const { data } = await admin
      .from("course_recommendations")
      .select("affiliate_url")
      .eq("id", rowId)
      .single();
    expect(data?.affiliate_url).toContain("example.test");
  });

  it("a signed-in user cannot insert a course of their own", async () => {
    const { error } = await seeker.client.from("course_recommendations").insert({
      skill_tag: "catalog-test",
      provider: "CATALOG-TEST Intruder",
      title: `CATALOG-TEST intruder ${randomUUID()}`,
      affiliate_url: "https://evil.test/?ref=theirs",
      price_tier: "free",
    });
    expect(error).not.toBeNull();
  });

  it("a signed-in user cannot delete one", async () => {
    const { error } = await seeker.client
      .from("course_recommendations")
      .delete()
      .eq("id", rowId);
    expect(error).not.toBeNull();

    const { count } = await admin
      .from("course_recommendations")
      .select("id", { count: "exact", head: true })
      .eq("id", rowId);
    expect(count).toBe(1);
  });

  it("a signed-out visitor cannot write either", async () => {
    const { error } = await anon
      .from("course_recommendations")
      .update({ active: true })
      .eq("id", rowId);
    expect(error).not.toBeNull();
  });
});

describe("the click log stays closed", () => {
  it("nobody but the service role can read who clicked what", async () => {
    // Telemetry about people, including people with no account. The admin
    // screen shows a COUNT per course and never crosses this line.
    for (const [label, client] of [
      ["anon", anon],
      ["seeker", seeker.client],
    ] as const) {
      const { data, error } = await client
        .from("course_recommendation_clicks")
        .select("user_id")
        .limit(1);
      expect(error, `${label} could read the click log`).not.toBeNull();
      expect(data).toBeNull();
    }
  });
});
