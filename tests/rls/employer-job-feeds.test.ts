/**
 * Migration 0246 (employer job feeds, database part). DATABASE-BACKED: runs in CI (the per-job local stack applies every migration) and needs minted sessions. Written against the plan
 * (reports/S1/2026-10-08-employer-job-import-plan.md); the migration's own self-check holds the grants at apply time, these cases hold what a row can and cannot do afterwards.
 *
 *   FEEDS: a member reads their organisation's feed (the site-control code included); another organisation's member, a signed-in stranger and anon read nothing; nobody can write it from a client
 *     (insert, update, delete); the constraints refuse a non-https address, a host with a path or upper case, a short code; one live feed per (organisation, host) and per address, a removed feed frees both.
 *   ATTEMPTS: unreachable by every API role.
 *   MARKERS ON job_postings: a member's own posting insert still works; the same insert with any of the three markers set is refused by the policy; the markers cannot be updated by a client; import_feed_id is
 *     readable by anon and authenticated, import_key and employer_closed_at are not; both-or-neither, internal-only and unique-per-feed hold; a feed cannot be deleted while a posting points at it.
 *   WIDGET: org_job_widget lists the organisation's own posting and never its imported one.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { admin as typedAdmin, createAuthedTestUser, deleteTestUsers } from "../support/auth";
import { deleteOrgsCascade } from "../support/delete-orgs";

const admin = typedAdmin as unknown as SupabaseClient;
type Authed = Awaited<ReturnType<typeof createAuthedTestUser>>;
const as = (a: Authed) => a.client as unknown as SupabaseClient;
const tag = randomUUID().slice(0, 6);
const CODE = (n: string) => `${n}${"A".repeat(43 - n.length)}`;

const userIds: string[] = [];
const orgIds: string[] = [];
let member: Authed; // owner of org A (verified)
let other: Authed; // owner of org B
let stranger: Authed; // belongs to no organisation
let orgA = "";
let orgB = "";
let feedA = "";

async function newOrg(owner: Authed, name: string): Promise<string> {
  const { data, error } = await admin.from("organizations").insert({ name: `${name} ${tag}`, created_by: owner.id, verified: true }).select("id").single();
  expect(error, error?.message).toBeNull();
  orgIds.push(data!.id);
  const { error: mErr } = await admin.from("organization_members").insert({ organization_id: data!.id, user_id: owner.id, role: "owner" });
  expect(mErr, mErr?.message).toBeNull();
  return data!.id as string;
}
const feedRow = (org: string, host: string, extra: Record<string, unknown> = {}) => ({
  organization_id: org, url: `https://${host}/careers`, host, site_proof_code: CODE("a"), consent_text_version: 1, consented_by: member.id, consented_at: new Date().toISOString(), consent_host: host, ...extra,
});
const posting = (org: string, title: string, extra: Record<string, unknown> = {}) => ({
  source_type: "internal", organization_id: org, company_name: "Feed Co", title: `${title} ${tag}`, description: "Fixture posting for the feeds suite.", structured_jd: {}, status: "open",
  posted_at: new Date().toISOString(), dedup_fingerprint: randomUUID(), ...extra,
});

beforeAll(async () => {
  member = await createAuthedTestUser("feeds-member");
  other = await createAuthedTestUser("feeds-other");
  stranger = await createAuthedTestUser("feeds-stranger");
  userIds.push(member.id, other.id, stranger.id);
  orgA = await newOrg(member, "Feeds A");
  orgB = await newOrg(other, "Feeds B");
  const { data, error } = await admin.from("employer_job_feeds").insert(feedRow(orgA, `careers-${tag}.example.test`)).select("id").single();
  expect(error, error?.message).toBeNull();
  feedA = data!.id as string;
}, 120_000);

afterAll(async () => {
  await admin.from("job_postings").delete().in("organization_id", orgIds);
  await admin.from("employer_job_feeds").delete().in("organization_id", orgIds);
  await deleteOrgsCascade(admin as never, orgIds);
  await deleteTestUsers(userIds);
}, 120_000);

describe("employer_job_feeds: who reads what", () => {
  it("a member reads their organisation's feed, the site-control code included", async () => {
    const { data, error } = await as(member).from("employer_job_feeds").select("id, host, site_proof_code, state").eq("id", feedA);
    expect(error, error?.message).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].site_proof_code).toBe(CODE("a"));
    expect(data![0].state).toBe("active");
  });
  it("another organisation's member, a signed-in stranger and anon read nothing", async () => {
    for (const who of [other, stranger]) {
      const { data, error } = await as(who).from("employer_job_feeds").select("id").eq("id", feedA);
      expect(error, error?.message).toBeNull();
      expect(data ?? []).toEqual([]);
    }
    const anon = (await import("@supabase/supabase-js")).createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
    const { data, error } = await anon.from("employer_job_feeds").select("id").eq("id", feedA);
    expect(error?.code === "42501" || (data ?? []).length === 0, "anon is refused or sees nothing").toBe(true);
  });
  it("the attempts table is unreachable by every API role", async () => {
    await admin.from("employer_job_feed_attempts").insert({ organization_id: orgA, user_id: member.id, host: `careers-${tag}.example.test`, action: "preview", result: "ok" });
    for (const who of [member, other, stranger]) {
      const { data, error } = await as(who).from("employer_job_feed_attempts").select("id").limit(1);
      expect(error?.code === "42501" || (data ?? []).length === 0, "refused or empty").toBe(true);
      const ins = await as(who).from("employer_job_feed_attempts").insert({ organization_id: orgA, host: "x.example.test", action: "preview", result: "ok" });
      expect(ins.error, "no insert").not.toBeNull();
    }
  });
});

describe("employer_job_feeds: nobody writes it from a client", () => {
  it("a member cannot insert, update or delete a feed", async () => {
    const ins = await as(member).from("employer_job_feeds").insert(feedRow(orgA, `other-${tag}.example.test`));
    expect(ins.error?.code, "insert").toBe("42501");
    const upd = await as(member).from("employer_job_feeds").update({ state: "removed" }).eq("id", feedA).select("id");
    expect(upd.error?.code ?? "denied", "update").toBe("42501");
    const del = await as(member).from("employer_job_feeds").delete().eq("id", feedA).select("id");
    expect(del.error?.code ?? "denied", "delete").toBe("42501");
    const { data } = await admin.from("employer_job_feeds").select("state").eq("id", feedA).single();
    expect(data!.state).toBe("active");
  });
});

describe("employer_job_feeds: the constraints", () => {
  it.each([
    ["a non-https address", { url: "http://insecure.example.test/careers" }],
    ["a host with a path", { host: "careers.example.test/jobs", consent_host: "careers.example.test/jobs" }],
    ["an upper-case host", { host: "Careers.Example.Test", consent_host: "Careers.Example.Test" }],
    ["a host with a port", { host: "careers.example.test:8443", consent_host: "careers.example.test:8443" }],
    ["a site-control code shorter than 43 characters", { site_proof_code: "short" }],
    ["a code with characters outside base64url", { site_proof_code: `${"a".repeat(42)}!` }],
    ["a host that differs from the host in the address", { host: "elsewhere.example.test", consent_host: "elsewhere.example.test", url: "https://real.example.test/careers" }],
    ["an address with userinfo", { url: "https://user@host.example.test/careers" }],
    ["an address with a port", { url: "https://host.example.test:8443/careers" }],
    ["a consent host that differs from the feed host", { consent_host: "different.example.test" }],
    ["an unknown state", { state: "sleeping" }],
    ["a paused-for-proof feed with no streak", { state: "paused_proof" }],
    ["a grace end with no streak start", { grace_ends_at: new Date().toISOString() }],
  ])("refuses %s", async (_label, extra) => {
    const host = (extra as { host?: string }).host ?? `c-${randomUUID().slice(0, 6)}.example.test`;
    const { error } = await admin.from("employer_job_feeds").insert(feedRow(orgB, host, { url: `https://${host.replace(/[/:].*$/, "")}/x`, ...extra }));
    expect(error, "should be refused").not.toBeNull();
  });
  it("accepts a paused-for-proof feed that has a streak, with its grace end", async () => {
    const host = `p-${randomUUID().slice(0, 6)}.example.test`;
    const since = new Date().toISOString();
    const { error } = await admin.from("employer_job_feeds").insert(feedRow(orgB, host, { state: "paused_proof", problem_since: since, grace_ends_at: new Date(Date.now() + 14 * 86_400_000).toISOString(), consecutive_proof_misses: 2 }));
    expect(error, error?.message).toBeNull();
  });
  it("one live feed per (organisation, host) and per address; a removed feed frees both", async () => {
    const host = `dup-${tag}.example.test`;
    const first = await admin.from("employer_job_feeds").insert(feedRow(orgB, host)).select("id").single();
    expect(first.error, first.error?.message).toBeNull();
    const second = await admin.from("employer_job_feeds").insert(feedRow(orgB, host, { url: `https://${host}/other` }));
    expect(second.error?.code, "same organisation and host").toBe("23505");
    const sameUrl = await admin.from("employer_job_feeds").insert(feedRow(orgA, host));
    expect(sameUrl.error?.code, "same address in another organisation").toBe("23505");
    const removed = await admin.from("employer_job_feeds").update({ state: "removed" }).eq("id", first.data!.id);
    expect(removed.error, removed.error?.message).toBeNull();
    const again = await admin.from("employer_job_feeds").insert(feedRow(orgB, host));
    expect(again.error, "after removal the same page can be connected again").toBeNull();
  });
  it("updated_at moves on every update", async () => {
    const before = (await admin.from("employer_job_feeds").select("updated_at").eq("id", feedA).single()).data!.updated_at as string;
    await new Promise((r) => setTimeout(r, 20));
    await admin.from("employer_job_feeds").update({ last_status: "ok" }).eq("id", feedA);
    const after = (await admin.from("employer_job_feeds").select("updated_at").eq("id", feedA).single()).data!.updated_at as string;
    expect(new Date(after).getTime()).toBeGreaterThan(new Date(before).getTime());
  });
});

describe("job_postings: the import markers", () => {
  it("a member can still post a job of their own (the policy change did not break posting)", async () => {
    const { error } = await as(member).from("job_postings").insert(posting(orgA, "Own post"));
    expect(error, error?.message).toBeNull();
  });
  it.each([
    ["import_feed_id", () => ({ import_feed_id: feedA, import_key: "k1" })],
    ["import_key", () => ({ import_key: "k2" })],
    ["employer_closed_at", () => ({ employer_closed_at: new Date().toISOString() })],
  ])("a member's insert with %s set is refused by the policy", async (_name, extra) => {
    const { error } = await as(member).from("job_postings").insert(posting(orgA, "Forged import", extra()));
    expect(error?.code).toBe("42501");
  });
  it("a client cannot UPDATE any of the three markers on their own posting", async () => {
    const { data } = await admin.from("job_postings").select("id").eq("organization_id", orgA).like("title", `Own post ${tag}`).single();
    for (const col of [{ import_feed_id: feedA }, { import_key: "x" }, { employer_closed_at: new Date().toISOString() }]) {
      const { error } = await as(member).from("job_postings").update(col).eq("id", data!.id);
      expect(error?.code, JSON.stringify(col)).toBe("42501");
    }
  });
  it("both-or-neither, internal-only and unique-per-feed hold for the service role too", async () => {
    const pair = await admin.from("job_postings").insert(posting(orgA, "Half import", { import_feed_id: feedA }));
    expect(pair.error?.code, "a feed without a key").toBe("23514");
    const external = await admin.from("job_postings").insert({ ...posting(orgA, "External import", { import_feed_id: feedA, import_key: "e1" }), source_type: "external", organization_id: null, external_url: "https://x.example.test/j", external_source: "greenhouse" });
    expect(external.error, "an imported posting must be internal").not.toBeNull();
    const one = await admin.from("job_postings").insert(posting(orgA, "Imported one", { import_feed_id: feedA, import_key: "dup-key" })).select("id").single();
    expect(one.error, one.error?.message).toBeNull();
    const two = await admin.from("job_postings").insert(posting(orgA, "Imported two", { import_feed_id: feedA, import_key: "dup-key" }));
    expect(two.error?.code, "the same key twice in one feed").toBe("23505");
  });
  it("a member cannot UPDATE an imported posting (status, title, external_url): the update matches no row", async () => {
    const { data: imported } = await admin.from("job_postings").select("id, status, title").eq("organization_id", orgA).like("title", `Imported one ${tag}`).single();
    expect(imported, "the imported fixture exists").not.toBeNull();
    for (const change of [{ status: "open" }, { status: "closed" }, { title: "Hijacked" }, { external_url: "https://evil.example.test/apply" }]) {
      const res = await as(member).from("job_postings").update(change).eq("id", imported!.id).select("id");
      expect(res.error?.code ?? "no error", JSON.stringify(change)).toSatisfy((c: string) => c === "42501" || c === "no error");
      expect((res.data ?? []).length, `${JSON.stringify(change)} updated nothing`).toBe(0);
    }
    const after = await admin.from("job_postings").select("status, title, external_url").eq("id", imported!.id).single();
    expect(after.data!.title).toBe(imported!.title);
    expect(after.data!.status).toBe(imported!.status);
    expect(after.data!.title).not.toBe("Hijacked");
  });
  it("a member can still UPDATE their own non-imported posting (the policy change did not break editing)", async () => {
    const { data: own } = await admin.from("job_postings").select("id").eq("organization_id", orgA).like("title", `Own post ${tag}`).single();
    const res = await as(member).from("job_postings").update({ description: "Edited by the owner" }).eq("id", own!.id).select("id");
    expect(res.error, res.error?.message).toBeNull();
    expect(res.data).toHaveLength(1);
  });
  it("a feed cannot be deleted while a posting points at it", async () => {
    const { error } = await admin.from("employer_job_feeds").delete().eq("id", feedA);
    expect(error?.code).toBe("23503");
  });
  it("import_feed_id is readable by anon and authenticated; import_key and employer_closed_at are not", async () => {
    const anon = (await import("@supabase/supabase-js")).createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
    for (const client of [anon as unknown as SupabaseClient, as(stranger)]) {
      const ok = await client.from("job_postings").select("import_feed_id").limit(1);
      expect(ok.error, ok.error?.message).toBeNull();
      for (const col of ["import_key", "employer_closed_at"]) {
        const denied = await client.from("job_postings").select(col).limit(1);
        expect(denied.error?.code, col).toBe("42501");
      }
    }
  });
});

describe("prune_employer_job_feed_attempts", () => {
  it("deletes attempts older than the interval, keeps newer ones, refuses less than 7 days, and no API role can call it", async () => {
    const host = `prune-${tag}.example.test`;
    const old = new Date(Date.now() - 40 * 86_400_000).toISOString();
    const recent = new Date(Date.now() - 2 * 86_400_000).toISOString();
    await admin.from("employer_job_feed_attempts").insert([
      { organization_id: orgA, host, action: "preview", result: "ok", created_at: old },
      { organization_id: orgA, host, action: "preview", result: "ok", created_at: recent },
    ]);
    const tooShort = await admin.rpc("prune_employer_job_feed_attempts", { p_older_than: "3 days" });
    expect(tooShort.error?.code, "refuses a window under 7 days").toBe("22023");
    const done = await admin.rpc("prune_employer_job_feed_attempts", { p_older_than: "30 days" });
    expect(done.error, done.error?.message).toBeNull();
    expect(Number(done.data)).toBeGreaterThanOrEqual(1);
    const left = await admin.from("employer_job_feed_attempts").select("created_at").eq("host", host);
    expect(left.data).toHaveLength(1);
    expect(new Date(left.data![0].created_at).getTime()).toBeGreaterThan(Date.now() - 3 * 86_400_000);
    const asMember = await as(member).rpc("prune_employer_job_feed_attempts", { p_older_than: "30 days" });
    expect(asMember.error, "a signed-in user cannot call it").not.toBeNull();
  });
});

describe("org_job_widget: an imported posting is never listed", () => {
  it("lists the organisation's own posting and not its imported one", async () => {
    const { error } = await admin.from("employer_widgets").insert({ organization_id: orgA, enabled: true, max_items: 10 });
    expect(error, error?.message).toBeNull();
    const { data, error: rpcError } = await admin.rpc("org_job_widget", { p_org_id: orgA });
    expect(rpcError, rpcError?.message).toBeNull();
    const titles = ((data as { jobs: Array<{ title: string }> }).jobs).map((j) => j.title);
    expect(titles).toContain(`Own post ${tag}`);
    expect(titles.some((t) => t.startsWith("Imported one"))).toBe(false);
  });
});
