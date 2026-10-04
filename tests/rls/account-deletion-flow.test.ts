/**
 * ACCT-1 PR 1 (migration 0212) — the request / confirm / restore flow, against the real database.
 *
 * Not a mock of the rules: the rules ARE the SQL functions, so this drives them as the roles that will call them.
 *
 *   WHO MAY CALL WHAT   blockers / create_request / confirm: service role only. status / restore: the signed-in person, acting on auth.uid().
 *                       The flag column cannot be written by a client at all.
 *   THE LINK            stored as a hash; expires; works once; works only for the user it was issued to; a newer request replaces an older one;
 *                       no more than three an hour.
 *   WHAT CONFIRMING DOES   one transaction: flag set, hard-delete date 30 days out, Auto-Apply off and its queue dismissed, Pass auto-renew
 *                       cancelled (card authorisation dropped), and for the sole member of an organisation its open postings closed and
 *                       running campaigns paused. The credit balance is untouched (a restore gives it all back).
 *   WHO CANNOT DELETE   a mentor or mentee with paid sessions still ahead, a mentor with an unpaid payout, an owner of an organisation that
 *                       other people belong to. Each is refused at REQUEST time (no email) and again at CONFIRM time.
 *   RESTORE             puts back visibility only. Auto-Apply stays off, renewal stays cancelled, closed postings stay closed. Not after the window.
 *
 * First run of this file is CI (no database on the authoring machine); the same flow was run in a rolled-back transaction on talentrah-preview,
 * output in the PR body.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { admin, createAuthedTestUser, createTestUser, deleteTestUsers, type TestUser } from "../support/auth";
import { deleteOrgsCascade } from "../support/delete-orgs";
import { generateDeletionToken } from "@/lib/account-deletion/token";

type Authed = Awaited<ReturnType<typeof createAuthedTestUser>>;
type Json = Record<string, unknown> & { ok?: boolean; reason?: string };

const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
const NOT_CALLABLE = ["42501", "PGRST202"];

const rpc = async (name: string, args?: Record<string, unknown>): Promise<{ data: Json | null; error: { code?: string; message: string } | null }> =>
  (await admin.rpc(name as never, args as never)) as never;

async function request(userId: string): Promise<{ token: string; hash: string; res: Json }> {
  const { token, hash } = generateDeletionToken();
  const { data, error } = await rpc("account_deletion_create_request", { p_user_id: userId, p_token_hash: hash });
  if (error) throw new Error(`create_request: ${error.message}`);
  return { token, hash, res: data! };
}
async function confirm(userId: string, hash: string): Promise<Json> {
  const { data, error } = await rpc("account_deletion_confirm", { p_user_id: userId, p_token_hash: hash });
  if (error) throw new Error(`confirm: ${error.message}`);
  return data!;
}
async function profileOf(id: string) {
  const { data } = await admin.from("profiles").select("deletion_requested_at, credits_balance").eq("id", id).single();
  return data!;
}
async function wipe(userId: string) {
  await admin.from("account_deletions").delete().eq("profile_id", userId);
  await admin.from("profiles").update({ deletion_requested_at: null }).eq("id", userId);
}

let flow: Authed; // the person who goes through the whole flow
let stranger: Authed; // someone else (cannot use the flow user's link)
let mentor: Authed;
let mentee: Authed;
let soleOwner: Authed;
let sharedOwner: Authed;
let sharedAdmin: Authed;
const orgIds: string[] = [];
const cleanupSessionIds: string[] = [];
const cleanupSlotIds: string[] = [];
let passId = "";

async function makeOrg(owner: TestUser, label: string) {
  const { data, error } = await admin.from("organizations").insert({ name: `ACCT1-TEST Org ${label} ${randomUUID().slice(0, 8)}`, created_by: owner.id, verified: true }).select("id, name").single();
  if (error || !data) throw new Error(`fixture org: ${error?.message}`);
  orgIds.push(data.id);
  const m = await admin.from("organization_members").insert({ organization_id: data.id, user_id: owner.id, role: "owner" });
  if (m.error) throw new Error(`fixture member: ${m.error.message}`);
  return data;
}
async function makePosting(orgId: string, orgName: string, title: string, status: "open" | "draft" = "open") {
  const { data, error } = await admin
    .from("job_postings")
    .insert({ source_type: "internal", organization_id: orgId, company_name: orgName, title, description: "Fixture.", structured_jd: {}, status, posted_at: new Date().toISOString(), dedup_fingerprint: randomUUID() })
    .select("id")
    .single();
  if (error || !data) throw new Error(`fixture posting: ${error?.message}`);
  return data.id;
}
async function makeSession(mentorId: string, menteeId: string | null, opts: { status: string; price: number; startInDays: number }) {
  const start = new Date(Date.now() + opts.startInDays * 86_400_000);
  const { data: slot, error: se } = await admin.from("mentor_availability_slots").insert({ mentor_id: mentorId, start_at: start.toISOString(), end_at: new Date(start.getTime() + 3_600_000).toISOString(), is_booked: true }).select("id").single();
  if (se || !slot) throw new Error(`fixture slot: ${se?.message}`);
  cleanupSlotIds.push(slot.id);
  const commission = Math.round(opts.price * 0.15);
  const { data: s, error } = await admin
    .from("mentorship_sessions")
    .insert({ mentor_id: mentorId, mentee_id: menteeId, availability_slot_id: slot.id, session_type: "mock_interview", scheduled_start: start.toISOString(), scheduled_end: new Date(start.getTime() + 3_600_000).toISOString(), price_ngn: opts.price, platform_commission_ngn: commission, mentor_payout_ngn: opts.price - commission, status: opts.status })
    .select("id")
    .single();
  if (error || !s) throw new Error(`fixture session: ${error?.message}`);
  cleanupSessionIds.push(s.id);
  return s.id;
}

beforeAll(async () => {
  [flow, stranger, mentor, mentee, soleOwner, sharedOwner, sharedAdmin] = await Promise.all([
    createAuthedTestUser("acct1-flow"),
    createAuthedTestUser("acct1-stranger"),
    createAuthedTestUser("acct1-mentor"),
    createAuthedTestUser("acct1-mentee"),
    createAuthedTestUser("acct1-soleowner"),
    createAuthedTestUser("acct1-sharedowner"),
    createAuthedTestUser("acct1-sharedadmin"),
  ]);
  const { data: pass } = await admin.from("passes").select("id").limit(1).single();
  if (!pass) throw new Error("No passes seeded — run `npm run seed`.");
  passId = pass.id;
  const up = await admin.from("mentor_profiles").upsert({ user_id: mentor.id, status: "approved" });
  if (up.error) throw new Error(`fixture mentor: ${up.error.message}`);
}, 180_000);

afterAll(async () => {
  const check = async (p: PromiseLike<{ error: { message: string } | null }>) => {
    const { error } = await p;
    if (error) throw new Error(`cleanup failed: ${error.message}`);
  };
  if (cleanupSessionIds.length) {
    await check(admin.from("mentor_payouts").delete().in("session_id", cleanupSessionIds));
    await check(admin.from("mentorship_sessions").delete().in("id", cleanupSessionIds));
  }
  await check(admin.from("mentor_payouts").delete().eq("mentor_id", mentor.id));
  if (cleanupSlotIds.length) await check(admin.from("mentor_availability_slots").delete().in("id", cleanupSlotIds));
  await check(admin.from("mentor_profiles").delete().eq("user_id", mentor.id));
  if (orgIds.length) await deleteOrgsCascade(admin, orgIds);
  const ids = [flow, stranger, mentor, mentee, soleOwner, sharedOwner, sharedAdmin].filter(Boolean).map((u) => u.id);
  for (const id of ids) await admin.from("account_deletions").delete().eq("profile_id", id);
  await deleteTestUsers(ids);
}, 180_000);

describe("who may call what", () => {
  it.each(["account_deletion_blockers", "account_deletion_create_request", "account_deletion_confirm"])("%s is refused to anon and to a signed-in person", async (fn) => {
    const args = fn === "account_deletion_blockers" ? { p_user_id: flow.id } : { p_user_id: flow.id, p_token_hash: "a".repeat(64) };
    for (const client of [anon, flow.client]) {
      const { error } = await (client as unknown as typeof admin).rpc(fn as never, args as never);
      expect(error, `${fn} must be refused`).not.toBeNull();
      expect(NOT_CALLABLE).toContain(error!.code);
    }
  });

  it("restore and status are refused to anon, and are callable by a signed-in person", async () => {
    for (const fn of ["account_deletion_restore", "account_deletion_status"]) {
      const { error } = await (anon as unknown as typeof admin).rpc(fn as never);
      expect(error).not.toBeNull();
      expect(NOT_CALLABLE).toContain(error!.code);
      const ok = await (flow.client as unknown as typeof admin).rpc(fn as never);
      expect(ok.error, fn).toBeNull();
    }
  });

  it("account_is_active is not callable by anon (it would otherwise answer 'is this person leaving?' for any id)", async () => {
    const { error } = await (anon as unknown as typeof admin).rpc("account_is_active" as never, { p_user_id: flow.id } as never);
    expect(error).not.toBeNull();
    expect(NOT_CALLABLE).toContain(error!.code);
  });

  it("a signed-in person cannot read or write the request table", async () => {
    await request(flow.id);
    const read = await (flow.client as unknown as typeof admin).from("account_deletions" as never).select("*");
    expect(read.error !== null || (read.data ?? []).length === 0, "a client must see no request rows").toBe(true);
    const write = await (flow.client as unknown as typeof admin).from("account_deletions" as never).insert({ profile_id: flow.id, token_hash: "b".repeat(64), token_expires_at: new Date().toISOString() } as never);
    expect(write.error).not.toBeNull();
    await wipe(flow.id);
  });

  it("a signed-in person cannot set or clear their own deletion flag with a direct write", async () => {
    const set = await flow.client.from("profiles").update({ deletion_requested_at: new Date().toISOString() } as never).eq("id", flow.id).select("id");
    expect(set.error).not.toBeNull();
    expect((await profileOf(flow.id)).deletion_requested_at).toBeNull();
  });
});

describe("the emailed link: store, expire, single use, one owner", () => {
  it("a request stores a one-hour expiry, and the table holds the hash, never the token", async () => {
    const { token, hash, res } = await request(flow.id);
    expect(res.ok).toBe(true);
    const { data: rows } = await admin.from("account_deletions" as never).select("token_hash, token_expires_at, status, profile_id").eq("profile_id", flow.id);
    const row = (rows as unknown as Array<{ token_hash: string; token_expires_at: string; status: string }>)[0];
    expect(row.token_hash).toBe(hash);
    expect(row.token_hash).not.toBe(token);
    expect(row.status).toBe("pending_confirmation");
    const minutes = (new Date(row.token_expires_at).getTime() - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(58);
    expect(minutes).toBeLessThanOrEqual(60.5);
    await wipe(flow.id);
  });

  it("a newer request replaces the older: the older link then reads as 'superseded' (its own message), and only the newest works", async () => {
    const first = await request(flow.id);
    const second = await request(flow.id);
    expect((await confirm(flow.id, first.hash)).reason).toBe("superseded");
    expect((await confirm(flow.id, second.hash)).ok).toBe(true);
    await wipe(flow.id);
  });

  it("a fourth request inside an hour is refused", async () => {
    await request(flow.id);
    await request(flow.id);
    await request(flow.id);
    const fourth = await request(flow.id);
    expect(fourth.res.ok).toBe(false);
    expect(fourth.res.reason).toBe("rate_limited");
    await wipe(flow.id);
  });

  it("a malformed hash and an unknown person are refused", async () => {
    expect((await rpc("account_deletion_create_request", { p_user_id: flow.id, p_token_hash: "short" })).data?.reason).toBe("bad_token");
    expect((await rpc("account_deletion_create_request", { p_user_id: randomUUID(), p_token_hash: "c".repeat(64) })).data?.reason).toBe("no_profile");
  });

  it("another person's session cannot confirm the link: the function matches the hash AND the owner, and changes nothing", async () => {
    const { hash } = await request(flow.id);
    expect((await confirm(stranger.id, hash)).reason).toBe("invalid");
    expect((await profileOf(flow.id)).deletion_requested_at).toBeNull();
    expect((await profileOf(stranger.id)).deletion_requested_at).toBeNull();
    // and the owner can still use it afterwards
    expect((await confirm(flow.id, hash)).ok).toBe(true);
    await wipe(flow.id);
  });

  it("an expired link is refused and changes nothing", async () => {
    const { hash } = await request(flow.id);
    await admin.from("account_deletions" as never).update({ token_expires_at: new Date(Date.now() - 1000).toISOString() } as never).eq("token_hash", hash);
    expect((await confirm(flow.id, hash)).reason).toBe("expired");
    expect((await profileOf(flow.id)).deletion_requested_at).toBeNull();
    await wipe(flow.id);
  });

  it("a link works once: a second use is refused and the first result stands", async () => {
    const { hash } = await request(flow.id);
    const first = await confirm(flow.id, hash);
    expect(first.ok).toBe(true);
    const flagged = (await profileOf(flow.id)).deletion_requested_at;
    expect((await confirm(flow.id, hash)).reason).toBe("used");
    expect((await profileOf(flow.id)).deletion_requested_at).toBe(flagged);
    await wipe(flow.id);
  });

  it("two clicks at the same instant: exactly one wins", async () => {
    const { hash } = await request(flow.id);
    const results = await Promise.all([confirm(flow.id, hash), confirm(flow.id, hash), confirm(flow.id, hash)]);
    expect(results.filter((r) => r.ok).length).toBe(1);
    expect(results.filter((r) => !r.ok).every((r) => r.reason === "used" || r.reason === "already_scheduled")).toBe(true);
    await wipe(flow.id);
  });

  it("an unknown hash is simply invalid", async () => {
    expect((await confirm(flow.id, "d".repeat(64))).reason).toBe("invalid");
  });
});

describe("the precheck (run before the card is touched) agrees with the confirm on every refusal", () => {
  const pre = async (userId: string, hash: string): Promise<Json> => {
    const { data, error } = await rpc("account_deletion_confirm_precheck", { p_user_id: userId, p_token_hash: hash });
    if (error) throw new Error(`precheck: ${error.message}`);
    return data!;
  };

  it("is service-role only", async () => {
    for (const client of [anon, flow.client]) {
      const { error } = await (client as unknown as typeof admin).rpc("account_deletion_confirm_precheck" as never, { p_user_id: flow.id, p_token_hash: "a".repeat(64) } as never);
      expect(error).not.toBeNull();
      expect(NOT_CALLABLE).toContain(error!.code);
    }
  });

  it("makes NO change, and answers ok for a good link", async () => {
    const { hash } = await request(flow.id);
    const res = await pre(flow.id, hash);
    expect(res.ok).toBe(true);
    expect((await profileOf(flow.id)).deletion_requested_at).toBeNull();
    const { data: row } = await admin.from("account_deletions" as never).select("status").eq("token_hash", hash).single();
    expect((row as unknown as { status: string }).status).toBe("pending_confirmation");
    await wipe(flow.id);
  });

  it("gives the SAME reason as the confirm for: unknown, another person's link, superseded, expired, used, already scheduled", async () => {
    const same = async (userId: string, hash: string) => {
      const a = (await pre(userId, hash)).reason;
      const b = (await confirm(userId, hash)).reason;
      expect(a, "precheck and confirm must agree").toBe(b);
      return a;
    };
    expect(await same(flow.id, "d".repeat(64))).toBe("invalid");
    const first = await request(flow.id);
    const second = await request(flow.id);
    expect(await same(flow.id, first.hash)).toBe("superseded");
    expect(await same(stranger.id, second.hash)).toBe("invalid");
    await admin.from("account_deletions" as never).update({ token_expires_at: new Date(Date.now() - 1000).toISOString() } as never).eq("token_hash", second.hash);
    expect(await same(flow.id, second.hash)).toBe("expired");
    const third = await request(flow.id);
    expect((await confirm(flow.id, third.hash)).ok).toBe(true);
    expect(await same(flow.id, third.hash)).toBe("used");
    await wipe(flow.id);
  });
});

describe("the stored cards that must be cancelled at the provider (account_deletion_confirm_precheck lists them) and what confirming does to the renewals", () => {
  it("lists each active Pass and Talent Directory authorisation, once, and nothing for an inactive one", async () => {
    const { data: plan } = await admin.from("talent_directory_plans").select("id").limit(1).single();
    const org = await makeOrg(flow, "td");
    const expires = new Date(Date.now() + 10 * 86_400_000).toISOString();
    const pass = await admin.from("user_passes").insert({ user_id: flow.id, pass_id: passId, expires_at: expires, payment_method: "card", status: "active", auto_renew: true, auto_renew_status: "active", next_renewal_date: expires.slice(0, 10), authorization_code: "AUTH_pass_fixture" }).select("id").single();
    const dead = await admin.from("user_passes").insert({ user_id: flow.id, pass_id: passId, expires_at: expires, payment_method: "card", status: "active", auto_renew: false, auto_renew_status: "canceled", authorization_code: "AUTH_dead_fixture" }).select("id").single();
    const td = await admin.from("talent_directory_subscriptions").insert({ organization_id: org.id, plan_id: plan!.id, expires_at: expires, status: "active", auto_renew_status: "active", next_renewal_date: expires.slice(0, 10), authorization_code: "AUTH_td_fixture" }).select("id").single();
    expect(pass.error ?? dead.error ?? td.error).toBeNull();

    const { hash } = await request(flow.id);
    const res = (await rpc("account_deletion_confirm_precheck", { p_user_id: flow.id, p_token_hash: hash })).data as Json & { authorizations: Array<{ source: string; id: string; authorization_code: string }> };
    expect(res.ok).toBe(true);
    const codes = res.authorizations.map((a) => `${a.source}:${a.authorization_code}`).sort();
    expect(codes).toEqual(["pass:AUTH_pass_fixture", "talent_directory:AUTH_td_fixture"]);

    expect((await confirm(flow.id, hash)).ok).toBe(true);
    const { data: p } = await admin.from("user_passes").select("auto_renew, auto_renew_status, authorization_code").eq("id", pass.data!.id).single();
    expect(p).toMatchObject({ auto_renew: false, auto_renew_status: "canceled", authorization_code: null });
    const { data: t } = await admin.from("talent_directory_subscriptions").select("auto_renew_status, authorization_code, next_renewal_date, status").eq("id", td.data!.id).single();
    expect(t).toMatchObject({ auto_renew_status: "canceled", authorization_code: null, next_renewal_date: null, status: "active" });

    await admin.from("talent_directory_subscriptions").delete().eq("id", td.data!.id);
    await admin.from("user_passes").delete().in("id", [pass.data!.id, dead.data!.id]);
    await wipe(flow.id);
  });

  it("a subscription belonging to an organisation the person did not create is not touched or listed", async () => {
    const { data: plan } = await admin.from("talent_directory_plans").select("id").limit(1).single();
    const org = await makeOrg(stranger, "td-other");
    const expires = new Date(Date.now() + 10 * 86_400_000).toISOString();
    const td = await admin.from("talent_directory_subscriptions").insert({ organization_id: org.id, plan_id: plan!.id, expires_at: expires, status: "active", auto_renew_status: "active", next_renewal_date: expires.slice(0, 10), authorization_code: "AUTH_other_fixture" }).select("id").single();
    const { hash } = await request(flow.id);
    const res = (await rpc("account_deletion_confirm_precheck", { p_user_id: flow.id, p_token_hash: hash })).data as Json & { authorizations: unknown[] };
    expect(res.authorizations).toEqual([]);
    expect((await confirm(flow.id, hash)).ok).toBe(true);
    const { data: t } = await admin.from("talent_directory_subscriptions").select("auto_renew_status, authorization_code").eq("id", td.data!.id).single();
    expect(t).toMatchObject({ auto_renew_status: "active", authorization_code: "AUTH_other_fixture" });
    await admin.from("talent_directory_subscriptions").delete().eq("id", td.data!.id);
    await wipe(flow.id);
  });
});

describe("the ad wallet of a sole-member organisation is reported, never forfeited", () => {
  it("blockers and the confirm result carry its balance; the wallet itself is untouched", async () => {
    const org = await makeOrg(soleOwner, "wallet");
    const w = await admin.from("ad_wallets").upsert({ organization_id: org.id, balance_ngn: 4500, currency: "NGN" });
    expect(w.error).toBeNull();
    const { hash, res } = await request(soleOwner.id);
    expect((res.blockers as { ad_wallet_balance_ngn: number }).ad_wallet_balance_ngn).toBeGreaterThanOrEqual(4500);
    const done = await confirm(soleOwner.id, hash);
    expect(done.ok).toBe(true);
    expect(Number(done.ad_wallet_balance_ngn)).toBeGreaterThanOrEqual(4500);
    const { data: wallet } = await admin.from("ad_wallets").select("balance_ngn").eq("organization_id", org.id).single();
    expect(wallet?.balance_ngn).toBe(4500);
    await wipe(soleOwner.id);
  });

  it("an organisation other people belong to is not this person's to report", async () => {
    const { res } = await request(sharedAdmin.id);
    expect(Number((res.blockers as { ad_wallet_balance_ngn: number }).ad_wallet_balance_ngn)).toBe(0);
    await wipe(sharedAdmin.id);
  });
});

describe("what confirming does", () => {
  it("flags the account, schedules the delete 30 days out, records the credits, and leaves the balance alone", async () => {
    await admin.from("profiles").update({ credits_balance: 25 }).eq("id", flow.id);
    const { hash } = await request(flow.id);
    const res = await confirm(flow.id, hash);
    expect(res.ok).toBe(true);
    expect(res.credits_forfeited).toBe(25);
    const days = (new Date(res.hard_delete_after as string).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThanOrEqual(30.01);
    const p = await profileOf(flow.id);
    expect(p.deletion_requested_at).not.toBeNull();
    expect(p.credits_balance).toBe(25);
    const { data: row } = await admin.from("account_deletions" as never).select("status, confirmed_at, credits_forfeited").eq("profile_id", flow.id).single();
    expect(row).toMatchObject({ status: "scheduled", credits_forfeited: 25 });
    await admin.from("profiles").update({ credits_balance: 0 }).eq("id", flow.id);
    await wipe(flow.id);
  });

  it("stops Auto-Apply: the switch goes off and anything waiting for review is dismissed", async () => {
    // Owned by someone other than the sole-owner fixture below, so that person's list of postings to close is exactly their own.
    const org = await makeOrg(stranger, "aa");
    const jobId = await makePosting(org.id, org.name, "ACCT1 queue target");
    await admin.from("auto_apply_settings").upsert({ user_id: flow.id, enabled: true, enabled_at: new Date().toISOString() });
    const q = await admin.from("auto_apply_queue").insert({ user_id: flow.id, job_posting_id: jobId, match_score: 90, tier: "excellent", source_type: "internal", status: "pending" }).select("id").single();
    expect(q.error).toBeNull();
    const { hash } = await request(flow.id);
    expect((await confirm(flow.id, hash)).ok).toBe(true);
    const { data: settings } = await admin.from("auto_apply_settings").select("enabled").eq("user_id", flow.id).single();
    expect(settings?.enabled).toBe(false);
    const { data: queued } = await admin.from("auto_apply_queue").select("status, decided_at").eq("id", q.data!.id).single();
    expect(queued?.status).toBe("dismissed");
    expect(queued?.decided_at).not.toBeNull();
    await admin.from("auto_apply_queue").delete().eq("user_id", flow.id);
    await wipe(flow.id);
  });

  it("stops Pass renewal the way the Billing page's own cancel does, and drops the stored card authorisation, without ending the paid period", async () => {
    const expires = new Date(Date.now() + 10 * 86_400_000).toISOString();
    const ins = await admin
      .from("user_passes")
      .insert({ user_id: flow.id, pass_id: passId, expires_at: expires, payment_method: "card", status: "active", auto_renew: true, auto_renew_status: "active", next_renewal_date: expires.slice(0, 10), authorization_code: "AUTH_test_not_real" })
      .select("id")
      .single();
    expect(ins.error).toBeNull();
    const { hash } = await request(flow.id);
    expect((await confirm(flow.id, hash)).ok).toBe(true);
    const { data: pass } = await admin.from("user_passes").select("auto_renew, auto_renew_status, next_renewal_date, authorization_code, status, expires_at").eq("id", ins.data!.id).single();
    expect(pass).toMatchObject({ auto_renew: false, auto_renew_status: "canceled", next_renewal_date: null, authorization_code: null, status: "active" });
    expect(new Date(pass!.expires_at).getTime()).toBe(new Date(expires).getTime());
    await admin.from("user_passes").delete().eq("id", ins.data!.id);
    await wipe(flow.id);
  });
});

describe("who cannot delete yet, and why", () => {
  it("a mentor with a paid confirmed session still ahead is refused at request AND at confirm, and no row is left behind", async () => {
    const sid = await makeSession(mentor.id, mentee.id, { status: "confirmed", price: 25_000, startInDays: 5 });
    const { res } = await request(mentor.id);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("blocked");
    const blockers = res.blockers as { mentorship_sessions: Array<{ id: string; role: string }> };
    expect(blockers.mentorship_sessions).toEqual([expect.objectContaining({ id: sid, role: "mentor" })]);
    const { data: rows } = await admin.from("account_deletions" as never).select("id").eq("profile_id", mentor.id);
    expect(rows).toEqual([]);
    // a link issued BEFORE the session existed is still refused at confirm: re-checked under the lock, not trusted from the page
    await admin.from("mentorship_sessions").delete().eq("id", sid);
    const { hash } = await request(mentor.id);
    const late = await makeSession(mentor.id, mentee.id, { status: "awaiting_confirmation", price: 25_000, startInDays: 6 });
    const confirmed = await confirm(mentor.id, hash);
    expect(confirmed.ok).toBe(false);
    expect(confirmed.reason).toBe("blocked");
    expect((await profileOf(mentor.id)).deletion_requested_at).toBeNull();
    await admin.from("mentorship_sessions").delete().eq("id", late);
    await wipe(mentor.id);
  });

  it("the mentee side is blocked too", async () => {
    const sid = await makeSession(mentor.id, mentee.id, { status: "confirmed", price: 25_000, startInDays: 4 });
    const { res } = await request(mentee.id);
    expect(res.reason).toBe("blocked");
    await admin.from("mentorship_sessions").delete().eq("id", sid);
    await wipe(mentee.id);
  });

  it("sessions that are free, unpaid, past or finished do not block", async () => {
    const free = await makeSession(mentor.id, mentee.id, { status: "confirmed", price: 0, startInDays: 3 });
    const unpaid = await makeSession(mentor.id, mentee.id, { status: "pending_payment", price: 25_000, startInDays: 3 });
    const done = await makeSession(mentor.id, mentee.id, { status: "completed", price: 25_000, startInDays: -3 });
    const { res } = await request(mentee.id);
    expect(res.ok).toBe(true);
    await admin.from("mentorship_sessions").delete().in("id", [free, unpaid, done]);
    await wipe(mentee.id);
  });

  it("a mentor with a payout that has not been paid is refused", async () => {
    const sid = await makeSession(mentor.id, mentee.id, { status: "completed", price: 25_000, startInDays: -2 });
    const payout = await admin.from("mentor_payouts").insert({ session_id: sid, mentor_id: mentor.id, amount_ngn: 21_250, status: "pending", eligible_at: new Date().toISOString() }).select("id").single();
    expect(payout.error).toBeNull();
    const { res } = await request(mentor.id);
    expect(res.reason).toBe("blocked");
    await admin.from("mentor_payouts").update({ status: "paid", paid_at: new Date().toISOString() }).eq("id", payout.data!.id);
    expect((await request(mentor.id)).res.ok).toBe(true);
    await admin.from("mentor_payouts").delete().eq("id", payout.data!.id);
    await admin.from("mentorship_sessions").delete().eq("id", sid);
    await wipe(mentor.id);
  });

  it("the owner of an organisation that other people belong to is refused; the other member (not the creator) is not", async () => {
    const org = await makeOrg(sharedOwner, "shared");
    const add = await admin.from("organization_members").insert({ organization_id: org.id, user_id: sharedAdmin.id, role: "admin" });
    expect(add.error).toBeNull();
    const ownerAttempt = await request(sharedOwner.id);
    expect(ownerAttempt.res.reason).toBe("blocked");
    expect((ownerAttempt.res.blockers as { organisations_with_other_members: Array<{ name: string }> }).organisations_with_other_members[0].name).toBe(org.name);
    expect((await request(sharedAdmin.id)).res.ok).toBe(true);
    await wipe(sharedOwner.id);
    await wipe(sharedAdmin.id);
  });
});

describe("the only member of an organisation", () => {
  it("is not blocked: confirming closes the open postings (drafts stay drafts), pauses running campaigns, and keeps the organisation and its postings", async () => {
    const org = await makeOrg(soleOwner, "sole");
    const openA = await makePosting(org.id, org.name, "ACCT1 Staff Engineer");
    const openB = await makePosting(org.id, org.name, "ACCT1 Designer");
    const draft = await makePosting(org.id, org.name, "ACCT1 Draft Role", "draft");
    const camp = await admin.from("ad_campaigns").insert({ organization_id: org.id, job_posting_id: openA, name: "ACCT1 campaign", status: "active", daily_rate_ngn: 1000, total_budget_ngn: 10000, starts_on: new Date().toISOString().slice(0, 10), created_by: soleOwner.id }).select("id").single();
    expect(camp.error).toBeNull();

    const { token, hash, res } = await request(soleOwner.id);
    expect(token).toBeTruthy();
    expect(res.ok).toBe(true);
    const listed = (res.blockers as { postings_to_close: Array<{ title: string }> }).postings_to_close.map((p) => p.title).sort();
    expect(listed).toEqual(["ACCT1 Designer", "ACCT1 Staff Engineer"]);

    const done = await confirm(soleOwner.id, hash);
    expect(done.ok).toBe(true);
    expect((done.closed_postings as Array<{ title: string }>).map((p) => p.title).sort()).toEqual(listed);

    const { data: postings } = await admin.from("job_postings").select("id, status, closed_at").in("id", [openA, openB, draft]);
    const by = Object.fromEntries((postings ?? []).map((p) => [p.id, p]));
    expect(by[openA].status).toBe("closed");
    expect(by[openA].closed_at).not.toBeNull();
    expect(by[openB].status).toBe("closed");
    expect(by[draft].status).toBe("draft");
    const { data: c } = await admin.from("ad_campaigns").select("status").eq("id", camp.data!.id).single();
    expect(c?.status).toBe("paused_by_employer");
    const { data: kept } = await admin.from("organizations").select("id").eq("id", org.id).single();
    expect(kept?.id).toBe(org.id);
    await admin.from("ad_campaigns").delete().eq("id", camp.data!.id);
    await wipe(soleOwner.id);
  });
});

describe("restore", () => {
  it("is offered to the person themselves, puts back visibility only, and works once", async () => {
    await admin.from("auto_apply_settings").upsert({ user_id: flow.id, enabled: true, enabled_at: new Date().toISOString() });
    const { hash } = await request(flow.id);
    expect((await confirm(flow.id, hash)).ok).toBe(true);

    const status = await (flow.client as unknown as typeof admin).rpc("account_deletion_status" as never);
    expect((status.data as unknown as Json).scheduled).toBe(true);
    const other = await (stranger.client as unknown as typeof admin).rpc("account_deletion_status" as never);
    expect((other.data as unknown as Json).scheduled).toBe(false);

    const restored = await (flow.client as unknown as typeof admin).rpc("account_deletion_restore" as never);
    expect((restored.data as unknown as Json).ok).toBe(true);
    expect((await profileOf(flow.id)).deletion_requested_at).toBeNull();
    const { data: settings } = await admin.from("auto_apply_settings").select("enabled").eq("user_id", flow.id).single();
    expect(settings?.enabled, "Auto-Apply is not switched back on for someone who only came back to look").toBe(false);
    const { data: row } = await admin.from("account_deletions" as never).select("status, restored_at").eq("profile_id", flow.id).single();
    expect(row).toMatchObject({ status: "restored" });

    const again = await (flow.client as unknown as typeof admin).rpc("account_deletion_restore" as never);
    expect((again.data as unknown as Json).reason).toBe("nothing_to_restore");
    await wipe(flow.id);
  });

  it("is refused once the 30 days are up, and the account stays flagged", async () => {
    const { hash } = await request(flow.id);
    expect((await confirm(flow.id, hash)).ok).toBe(true);
    await admin.from("account_deletions" as never).update({ hard_delete_after: new Date(Date.now() - 1000).toISOString() } as never).eq("profile_id", flow.id);
    const res = await (flow.client as unknown as typeof admin).rpc("account_deletion_restore" as never);
    expect((res.data as unknown as Json).reason).toBe("window_closed");
    expect((await profileOf(flow.id)).deletion_requested_at).not.toBeNull();
    await wipe(flow.id);
  });

  it("someone who never asked to delete has nothing to restore", async () => {
    const res = await (stranger.client as unknown as typeof admin).rpc("account_deletion_restore" as never);
    expect((res.data as unknown as Json).reason).toBe("nothing_to_restore");
  });
});

describe("a reused test identity starts clean", () => {
  it("createTestUser hands out an account with no deletion flag and no request history", async () => {
    const u = await createTestUser("acct1-pool-check");
    try {
      const { hash } = await request(u.id);
      expect((await confirm(u.id, hash)).ok).toBe(true);
    } finally {
      await deleteTestUsers([u.id]);
    }
    const again = await createTestUser("acct1-pool-check");
    try {
      expect((await profileOf(again.id)).deletion_requested_at).toBeNull();
      const { data } = await admin.from("account_deletions" as never).select("id").eq("profile_id", again.id);
      expect(data).toEqual([]);
    } finally {
      await deleteTestUsers([again.id]);
    }
  });
});
