/**
 * 0278 (JOBS-POLISH-1, P5): job_postings.expires_at_source, read off real sessions. DATABASE-BACKED: written here, run by S3-21 on a local stack (this machine has no database), then by CI.
 *
 * What it pins: the owner's backfill rule at both edges of its window (it is one SQL function the migration's UPDATE uses, called here directly); the CHECK refuses any value but stated / default; the
 * column is readable by anon and by a signed-in user; no client can write it (a direct UPDATE, or an INSERT that carries a value, by an organisation member) while the same member's ordinary insert still works
 * (the positive control, so a refusal is the guard's and not a bad fixture); and the service role, which is how every writer sets it, can.
 */
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { Database } from "../../src/lib/supabase/types";
import { admin, createAuthedTestUser, deleteTestUsers } from "../support/auth";
import { deleteOrgsCascade, deletePostingsCascade } from "../support/delete-orgs";

type Authed = Awaited<ReturnType<typeof createAuthedTestUser>>;
let member: Authed;
let orgId = "";
let orgName = "";
const jobIds: string[] = [];
const anon = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });

const posting = (extra: Record<string, unknown> = {}) => ({
  source_type: "internal",
  organization_id: orgId,
  company_name: orgName,
  title: `B0278-TEST ${randomUUID().slice(0, 6)}`,
  description: "Fixture.",
  status: "open",
  dedup_fingerprint: `b0278-${randomUUID()}`,
  ...extra,
});

async function makeJob(extra: Record<string, unknown> = {}): Promise<string> {
  const { data, error } = await admin.from("job_postings").insert(posting(extra) as never).select("id").single();
  if (error || !data) throw new Error(`fixture job: ${error?.message}`);
  jobIds.push(data.id);
  return data.id;
}
const sourceOf = async (id: string) => (await admin.from("job_postings").select("expires_at_source").eq("id", id).single()).data?.expires_at_source ?? null;

beforeAll(async () => {
  member = await createAuthedTestUser("b0278-member");
  const org = await admin.from("organizations").insert({ name: `B0278-TEST Org ${randomUUID().slice(0, 8)}`, created_by: member.id, verified: true }).select("id, name").single();
  if (org.error || !org.data) throw new Error(`fixture org: ${org.error?.message}`);
  orgId = org.data.id;
  orgName = org.data.name;
  const mem = await admin.from("organization_members").insert({ organization_id: orgId, user_id: member.id, role: "owner" });
  if (mem.error) throw new Error(`fixture member: ${mem.error.message}`);
}, 240_000);

afterAll(async () => {
  await deletePostingsCascade(admin, jobIds);
  if (orgId) {
    await admin.from("organization_members").delete().eq("organization_id", orgId);
    await deleteOrgsCascade(admin, [orgId]);
  }
  if (member) await deleteTestUsers([member.id]);
}, 120_000);

describe("the backfill rule (expires_at_source_backfill), at both edges of its window", () => {
  const created = new Date("2026-10-01T09:00:00.000Z");
  const after = (minutes: number) => new Date(created.getTime() + minutes * 60_000).toISOString();
  const rule = async (expires: string | null) => {
    const { data, error } = await admin.rpc("expires_at_source_backfill", { p_expires_at: expires as never, p_created_at: created.toISOString() });
    expect(error, "the service role must be able to call the rule").toBeNull();
    return data;
  };
  const DAY = 24 * 60;

  it("POSITIVE CONTROL: exactly 30 days is the default lifetime", async () => {
    expect(await rule(after(30 * DAY))).toBe("default");
  });
  it("29 days 23 hours is default, and one minute earlier is stated (the window's lower edge, inclusive)", async () => {
    expect(await rule(after(29 * DAY + 23 * 60))).toBe("default");
    expect(await rule(after(29 * DAY + 23 * 60 - 1))).toBe("stated");
  });
  it("30 days 1 hour is default, and one minute later is stated (the window's upper edge, inclusive)", async () => {
    expect(await rule(after(30 * DAY + 60))).toBe("default");
    expect(await rule(after(30 * DAY + 60 + 1))).toBe("stated");
  });
  it("a deadline well inside or well outside the window is stated", async () => {
    expect(await rule(after(7 * DAY))).toBe("stated");
    expect(await rule(after(90 * DAY))).toBe("stated");
  });
  it("no date is no source (null)", async () => {
    expect(await rule(null)).toBeNull();
  });
  it("neither anon nor a signed-in user can call it", async () => {
    const args = { p_expires_at: after(7 * DAY) as never, p_created_at: created.toISOString() };
    expect((await anon.rpc("expires_at_source_backfill", args)).error, "anon").not.toBeNull();
    expect((await member.client.rpc("expires_at_source_backfill", args)).error, "authenticated").not.toBeNull();
  });
});

describe("which source a row gets (expires_at_source_resolve, what the backfill UPDATE uses): closing_date_source first, the window only where it is null", () => {
  const created = new Date("2026-10-01T09:00:00.000Z");
  const after = (minutes: number) => new Date(created.getTime() + minutes * 60_000).toISOString();
  const DAY = 24 * 60;
  const resolve = async (closing: string | null, expires: string | null) => {
    const { data, error } = await admin.rpc("expires_at_source_resolve", { p_closing_date_source: closing as never, p_expires_at: expires as never, p_created_at: created.toISOString() });
    expect(error, "the service role must be able to call it").toBeNull();
    return data;
  };

  it("an employer row 'chosen' with a date INSIDE the default window is stated (the window alone would call it default)", async () => {
    expect(await resolve("chosen", after(30 * DAY))).toBe("stated");
  });
  it("an employer row 'default' whose date was extended OUTSIDE the window is default (the window alone would call it stated)", async () => {
    expect(await resolve("default", after(60 * DAY))).toBe("default");
  });
  it("a row with no closing_date_source uses the window: inside is default, outside is stated, no date is null", async () => {
    expect(await resolve(null, after(30 * DAY))).toBe("default");
    expect(await resolve(null, after(7 * DAY))).toBe("stated");
    expect(await resolve(null, null)).toBeNull();
  });
  it("neither anon nor a signed-in user can call it", async () => {
    const args = { p_closing_date_source: "chosen" as never, p_expires_at: after(7 * DAY) as never, p_created_at: created.toISOString() };
    expect((await anon.rpc("expires_at_source_resolve", args)).error, "anon").not.toBeNull();
    expect((await member.client.rpc("expires_at_source_resolve", args)).error, "authenticated").not.toBeNull();
  });
});

describe("the column", () => {
  it("only stated and default are accepted; anything else is refused by the check (23514)", async () => {
    const id = await makeJob();
    for (const ok of ["stated", "default"]) {
      expect((await admin.from("job_postings").update({ expires_at_source: ok } as never).eq("id", id)).error, ok).toBeNull();
      expect(await sourceOf(id)).toBe(ok);
    }
    const bad = await admin.from("job_postings").update({ expires_at_source: "bogus" } as never).eq("id", id);
    expect(bad.error?.code).toBe("23514");
    expect(await sourceOf(id)).toBe("default");
  });

  it("is readable by anon and by a signed-in user", async () => {
    const id = await makeJob({ expires_at: new Date(Date.now() + 7 * 864e5).toISOString() });
    expect((await admin.from("job_postings").update({ expires_at_source: "stated" } as never).eq("id", id)).error).toBeNull();
    for (const [who, client] of [["anon", anon], ["authenticated", member.client]] as const) {
      const { data, error } = await client.from("job_postings").select("id, expires_at_source").eq("id", id).maybeSingle();
      expect(error, who).toBeNull();
      expect(data?.expires_at_source, who).toBe("stated");
    }
  });
});

describe("no client can write it", () => {
  it("POSITIVE CONTROL: an organisation member's ordinary insert is accepted", async () => {
    const { data, error } = await member.client.from("job_postings").insert(posting() as never).select("id, expires_at_source").single();
    expect(error, "an ordinary posting must still be accepted").toBeNull();
    expect(data?.expires_at_source).toBeNull();
    if (data) jobIds.push(data.id);
  });

  it("an insert that carries a value is refused by the guard, and nothing is written", async () => {
    const row = posting({ expires_at_source: "stated" });
    const { error } = await member.client.from("job_postings").insert(row as never);
    expect(error, "the insert must be refused").not.toBeNull();
    expect(error!.code).toBe("42501");
    expect(error!.message).toMatch(/server-managed/);
    const { data } = await admin.from("job_postings").select("id").eq("dedup_fingerprint", row.dedup_fingerprint);
    expect(data ?? []).toEqual([]);
  });

  it("a direct UPDATE by a member is refused and the value is unchanged", async () => {
    const id = await makeJob();
    expect((await admin.from("job_postings").update({ expires_at_source: "default" } as never).eq("id", id)).error).toBeNull();
    const { error } = await member.client.from("job_postings").update({ expires_at_source: "stated" } as never).eq("id", id);
    expect(error, "no column grant covers expires_at_source").not.toBeNull();
    expect(error!.code).toBe("42501");
    expect(await sourceOf(id)).toBe("default");
  });
});
