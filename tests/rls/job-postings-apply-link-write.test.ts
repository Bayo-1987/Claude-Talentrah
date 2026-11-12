/**
 * 0277 (PR-E4, gate 1): the career-site link's database half, read off real sessions. DATABASE-BACKED: written here, run by S3-21 on a local stack and then on preview (this machine has no database).
 *
 * What it proves: every error code of set_job_apply_link; the has-applications lock; the shared cap of 5 per 24 hours (an email-only job still behaves as before, a replacement counts once); a direct
 * INSERT that carries a link, a kind or a host is refused; one method per job (the CHECK, and each function clearing the other method); a direct call of the function by a signed-in user or by anon
 * is refused by privilege; no API role can read apply_link while the kind and the host are readable by both; get_job_apply_link answers a member and nobody else; the click counter has no user id.
 *
 * PACKAGE CHECKS (S3-21, outside this file): the policy md5 b5d4e35d0346ce4e3ec126aa37cda56c (490 characters) on BOTH projects before the apply, abort on a mismatch, 4a86f3501566ff9d0284d8c5a448a4a1 (575) after;
 * md5(pg_get_functiondef('public.set_job_apply_email(uuid, text)'::regprocedure)) recorded before 0277 and equal after the rollback; the existing e2b-db-proof (14 of 14) and positive controls (7 of 7) re-run
 * green after 0277; every existing query shape on job_postings (feed, card, detail, widget) still answers for anon and for authenticated.
 */
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { Database } from "../../src/lib/supabase/types";
import { admin, createAuthedTestUser, deleteTestUsers } from "../support/auth";
import { deleteOrgsCascade, deletePostingsCascade } from "../support/delete-orgs";

type Authed = Awaited<ReturnType<typeof createAuthedTestUser>>;
let member: Authed;
let outsider: Authed;
let seeker: Authed;
let orgId = "";
let orgName = "";
let unverifiedOrgId = "";
let unverifiedMember: Authed;
const jobIds: string[] = [];
const DOMAIN = "acme-e4.example";
const COMPANY = `https://careers.${DOMAIN}/jobs`;
const ATS = "https://boards.greenhouse.io/acme-e4";
const ADDR = "careers@example.test";

const anon = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
const setLink = (actor: string | null, jobId: string, url: string | null, kind: string | null, tick = false) =>
  admin.rpc("set_job_apply_link", { p_job_id: jobId, p_actor: actor as never, p_url: url as never, p_kind: kind as never, p_ats_confirmed: tick });
const setEmail = (client: Authed["client"], jobId: string, address: string | null) => client.rpc("set_job_apply_email", { p_job_id: jobId, p_address: address as never });

async function makeJob(over: Record<string, unknown> = {}, org = orgId, name = orgName): Promise<string> {
  const { data, error } = await admin
    .from("job_postings")
    .insert({ source_type: "internal", organization_id: org, company_name: name, title: `B0277-TEST ${randomUUID().slice(0, 6)}`, description: "Fixture.", status: "open", dedup_fingerprint: `b0277-${randomUUID()}`, ...over } as never)
    .select("id")
    .single();
  if (error || !data) throw new Error(`fixture job: ${error?.message}`);
  jobIds.push(data.id);
  return data.id;
}
const row = async (id: string) => (await admin.from("job_postings").select("apply_email, apply_link, apply_link_kind, apply_link_host").eq("id", id).single()).data!;
const linkEvents = async (id: string) => (await admin.from("job_posting_apply_link_events").select("*").eq("job_posting_id", id).order("created_at")).data ?? [];
const emailEvents = async (id: string) => (await admin.from("job_posting_apply_email_events").select("*").eq("job_posting_id", id).order("created_at")).data ?? [];

beforeAll(async () => {
  member = await createAuthedTestUser("b0277-member");
  outsider = await createAuthedTestUser("b0277-outsider");
  seeker = await createAuthedTestUser("b0277-seeker");
  unverifiedMember = await createAuthedTestUser("b0277-unverified");
  const org = await admin.from("organizations").insert({ name: `B0277-TEST Org ${randomUUID().slice(0, 8)}`, created_by: member.id, verified: true, domain: DOMAIN }).select("id, name").single();
  if (org.error || !org.data) throw new Error(`fixture org: ${org.error?.message}`);
  orgId = org.data.id;
  orgName = org.data.name;
  const un = await admin.from("organizations").insert({ name: `B0277-TEST Unverified ${randomUUID().slice(0, 8)}`, created_by: unverifiedMember.id, verified: false, domain: "unverified-e4.example" }).select("id").single();
  if (un.error || !un.data) throw new Error(`fixture org: ${un.error?.message}`);
  unverifiedOrgId = un.data.id;
  // role "admin" on purpose: any member may set it.
  for (const [o, u] of [[orgId, member.id], [unverifiedOrgId, unverifiedMember.id]] as const) {
    const mem = await admin.from("organization_members").insert({ organization_id: o, user_id: u, role: "admin" });
    if (mem.error) throw new Error(`fixture member: ${mem.error.message}`);
  }
}, 240_000);

afterAll(async () => {
  await deletePostingsCascade(admin, jobIds);
  for (const o of [orgId, unverifiedOrgId].filter(Boolean)) {
    await admin.from("organization_members").delete().eq("organization_id", o);
    await deleteOrgsCascade(admin, [o]);
  }
  await deleteTestUsers([member, outsider, seeker, unverifiedMember].filter(Boolean).map((u) => u.id));
}, 120_000);

describe("POSITIVE CONTROLS: a member's job takes a company link and an ATS link", () => {
  it("a company link on the verified domain (and a subdomain) is set, with its host and one audit row", async () => {
    const id = await makeJob();
    const { error } = await setLink(member.id, id, COMPANY, "company");
    expect(error, "must be accepted").toBeNull();
    expect(await row(id)).toMatchObject({ apply_link: COMPANY, apply_link_kind: "company", apply_link_host: `careers.${DOMAIN}`, apply_email: null });
    const events = await linkEvents(id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ actor_user_id: member.id, new_url: COMPANY, new_kind: "company", ats_confirmed: false, old_url: null, replaced_by_email: false });
    expect((await setLink(member.id, id, `https://${DOMAIN}/careers`, "company")).error).toBeNull();
  });
  it("a real tenant label on a tenant host is accepted with the tick", async () => {
    const id = await makeJob();
    expect((await setLink(member.id, id, "https://acme-e4.bamboohr.com/careers", "ats", true)).error).toBeNull();
    expect((await row(id)).apply_link_host).toBe("acme-e4.bamboohr.com");
  });
  it("an ATS link needs the tick, which is recorded in the audit row", async () => {
    const id = await makeJob();
    expect((await setLink(member.id, id, ATS, "ats", true)).error).toBeNull();
    expect(await row(id)).toMatchObject({ apply_link: ATS, apply_link_kind: "ats", apply_link_host: "boards.greenhouse.io" });
    expect((await linkEvents(id))[0]).toMatchObject({ new_kind: "ats", ats_confirmed: true });
  });
  it("clearing and an unchanged value: the clear writes a row, the repeat writes none", async () => {
    const id = await makeJob();
    await setLink(member.id, id, COMPANY, "company");
    expect((await setLink(member.id, id, COMPANY, "company")).error).toBeNull();
    expect(await linkEvents(id)).toHaveLength(1);
    expect((await setLink(member.id, id, null, null)).error).toBeNull();
    expect(await row(id)).toMatchObject({ apply_link: null, apply_link_kind: null, apply_link_host: null });
    expect(await linkEvents(id)).toHaveLength(2);
  });
});

describe("every error code", () => {
  const code = async (p: PromiseLike<{ error: { code?: string; message: string } | null }>) => (await p).error;
  it("28000: no actor", async () => {
    const id = await makeJob();
    expect((await code(setLink(null, id, COMPANY, "company")))?.code).toBe("28000");
  });
  it("42501: not a member, or no such job", async () => {
    const id = await makeJob();
    expect((await code(setLink(outsider.id, id, COMPANY, "company")))?.code).toBe("42501");
    expect((await code(setLink(member.id, randomUUID(), COMPANY, "company")))?.code).toBe("42501");
    expect((await row(id)).apply_link).toBeNull();
  });
  it("AE004: an external, imported or removed job cannot change", async () => {
    const ext = await makeJob({ source_type: "external", organization_id: null, external_url: "https://example.test/j", external_source: "test" });
    expect((await code(setLink(member.id, ext, COMPANY, "company")))?.code).toMatch(/AE004|42501/);
    const removed = await makeJob({ status: "removed", removed_at: new Date().toISOString(), removal_reason: "test" });
    expect((await code(setLink(member.id, removed, COMPANY, "company")))?.code).toBe("AE004");
  });
  it.each([
    ["http://careers.acme-e4.example/x", "company"],
    [`https://careers.${DOMAIN}:8443/x`, "company"],
    [`https://user@careers.${DOMAIN}/x`, "company"],
    [`https://${DOMAIN}.evil.example/x`, "company"],
    [`https://evil${DOMAIN}/x`, "company"],
    [`https://careers.${DOMAIN}./x`, "company"],
    [`https://CAREERS.${DOMAIN}/x`, "company"],
    ["https://jobs.lever.co.evil.example/acme", "ats"],
    ["https://boards.greenhouse.io", "ats"],
    ["https://bamboohr.com/careers", "ats"],
    ["https://a.b.bamboohr.com/x", "ats"],
    ["https://unlisted-ats.example/acme", "ats"],
    [COMPANY, "other"],
    [`https://xn--bcher-kva.${DOMAIN}/x`, "company"], // G1b-2: an xn-- label
    ["https://xn--abc.bamboohr.com/x", "ats"],
    ["https://www.bamboohr.com/careers", "ats"], // G1b-1: a vendor's own label on a tenant host
    ["https://login.recruitee.com/", "ats"],
    ["https://docs.teamtailor.com/x", "ats"],
    [`https://careers.${DOMAIN}/a\u0001b`, "company"], // G1b-3: a control character in the path
  ])("AE005: %s as %s is refused and nothing is written", async (url, kind) => {
    const id = await makeJob();
    expect((await code(setLink(member.id, id, url, kind)))?.code).toBe("AE005");
    expect((await row(id)).apply_link).toBeNull();
    expect(await linkEvents(id)).toHaveLength(0);
  });
  it("AE006: a link on the company's own domain needs a verified company", async () => {
    const id = await makeJob({}, unverifiedOrgId, "Unverified");
    expect((await code(setLink(unverifiedMember.id, id, "https://unverified-e4.example/careers", "company")))?.code).toBe("AE006");
    expect((await setLink(unverifiedMember.id, id, ATS, "ats", true)).error, "an unverified company can still use an ATS page").toBeNull();
  });
  it("AE007: an ATS link without the tick", async () => {
    const id = await makeJob();
    expect((await code(setLink(member.id, id, ATS, "ats", false)))?.code).toBe("AE007");
    expect((await row(id)).apply_link).toBeNull();
  });
  for (const source of ["internal_apply", "auto_apply"] as const) {
    it(`AE001: a job with an ${source} application cannot be switched to a link; a manual one does not block it; clearing is allowed`, async () => {
      const id = await makeJob();
      const apply = async (s: string) => {
        const { error } = await admin.from("applications").insert({ user_id: seeker.id, job_posting_id: id, stage: "applied", source: s, applied_at: new Date().toISOString() } as never);
        if (error) throw new Error(error.message);
      };
      await apply(source);
      expect((await code(setLink(member.id, id, COMPANY, "company")))?.code).toBe("AE001");
      expect(await linkEvents(id)).toHaveLength(0);
    });
  }
  it("AE001 does not fire for a manual (tracker) application, and clearing a link is never refused", async () => {
    const id = await makeJob();
    await admin.from("applications").insert({ user_id: seeker.id, job_posting_id: id, stage: "applied", source: "manual", applied_at: new Date().toISOString() } as never);
    expect((await setLink(member.id, id, COMPANY, "company")).error).toBeNull();
    expect((await setLink(member.id, id, null, null)).error).toBeNull();
  });
});

describe("the shared cap: 5 changes per job per 24 hours, counted once", () => {
  it("the sixth change is refused with AE002, whichever method it is", async () => {
    const id = await makeJob();
    for (const u of ["a", "b", "c"]) expect((await setLink(member.id, id, `https://${DOMAIN}/${u}`, "company")).error).toBeNull();
    expect((await setLink(member.id, id, null, null)).error).toBeNull();
    expect((await setLink(member.id, id, `https://${DOMAIN}/d`, "company")).error).toBeNull();
    expect((await setLink(member.id, id, `https://${DOMAIN}/e`, "company")).error?.code).toBe("AE002");
    expect((await setEmail(member.client, id, ADDR)).error?.code, "an email change counts against the same cap").toBe("AE002");
  });
  it("a switch between the methods is ONE change, not two", async () => {
    const id = await makeJob();
    expect((await setEmail(member.client, id, ADDR)).error).toBeNull();
    expect((await setLink(member.id, id, COMPANY, "company")).error).toBeNull();
    expect((await row(id)).apply_email).toBeNull();
    expect((await setEmail(member.client, id, "second@example.test")).error).toBeNull();
    expect((await row(id)).apply_link).toBeNull();
    expect((await setLink(member.id, id, `https://${DOMAIN}/x`, "company")).error).toBeNull();
    expect((await setEmail(member.client, id, ADDR)).error, "five changes so far (email, link, email, link, email): the fifth is allowed").toBeNull();
    expect((await setEmail(member.client, id, null)).error?.code, "the sixth change is refused").toBe("AE002");
  });
  it("an email-only job behaves exactly as before: set, change, clear, the cap of 5, the audit rows", async () => {
    const id = await makeJob();
    for (const a of ["a1@example.test", "a2@example.test", "a3@example.test", "a4@example.test", "a5@example.test"]) expect((await setEmail(member.client, id, a)).error).toBeNull();
    expect((await setEmail(member.client, id, "a6@example.test")).error?.code).toBe("AE002");
    expect(await emailEvents(id)).toHaveLength(5);
    expect(await linkEvents(id)).toHaveLength(0);
  });
});

describe("one method per job", () => {
  it("setting a link clears an address (the replaced address is in the audit row); setting an address clears a link (a replaced_by_email row)", async () => {
    const id = await makeJob();
    await setEmail(member.client, id, ADDR);
    await setLink(member.id, id, COMPANY, "company");
    expect(await row(id)).toMatchObject({ apply_email: null, apply_link: COMPANY });
    expect((await linkEvents(id))[0]).toMatchObject({ replaced_email: ADDR, replaced_by_email: false });
    await setEmail(member.client, id, ADDR);
    expect(await row(id)).toMatchObject({ apply_email: ADDR, apply_link: null, apply_link_kind: null, apply_link_host: null });
    expect((await linkEvents(id)).at(-1)).toMatchObject({ old_url: COMPANY, new_url: null, replaced_by_email: true });
  });
  it("the CHECK refuses a row that has both (23514), the all-or-none CHECK refuses a half-set link", async () => {
    const id = await makeJob();
    const both = await admin.from("job_postings").update({ apply_email: ADDR, apply_link: COMPANY, apply_link_kind: "company", apply_link_host: "x.example" } as never).eq("id", id);
    expect(both.error?.code).toBe("23514");
    const half = await admin.from("job_postings").update({ apply_link: COMPANY } as never).eq("id", id);
    expect(half.error?.code).toBe("23514");
  });
});

describe("nothing reaches the columns except the function", () => {
  it("a member's direct INSERT that carries a link, a kind or a host is refused by row-level security", async () => {
    for (const extra of [{ apply_link: COMPANY }, { apply_link_kind: "company" }, { apply_link_host: `careers.${DOMAIN}` }]) {
      const { error } = await member.client.from("job_postings").insert({ source_type: "internal", organization_id: orgId, company_name: orgName, title: `B0277-TEST ${randomUUID().slice(0, 6)}`, description: "Fixture.", status: "open", dedup_fingerprint: `b0277-${randomUUID()}`, ...extra } as never);
      expect(error?.code, JSON.stringify(extra)).toBe("42501");
    }
  });
  it("a direct UPDATE of any of the three is refused", async () => {
    const id = await makeJob();
    for (const col of ["apply_link", "apply_link_kind", "apply_link_host"]) {
      const { error } = await member.client.from("job_postings").update({ [col]: "x" } as never).eq("id", id);
      expect(error, col).not.toBeNull();
    }
    expect((await row(id)).apply_link).toBeNull();
  });
  it("a signed-in user and anon cannot call set_job_apply_link directly: no EXECUTE (the bypass is closed by privilege)", async () => {
    const id = await makeJob();
    const args = { p_job_id: id, p_actor: member.id, p_url: COMPANY, p_kind: "company", p_ats_confirmed: false };
    const asMember = await member.client.rpc("set_job_apply_link", args);
    const asAnon = await anon.rpc("set_job_apply_link", args);
    expect(asMember.error, "authenticated").not.toBeNull();
    expect(asAnon.error, "anon").not.toBeNull();
    expect((await row(id)).apply_link).toBeNull();
  });
  it("a user cannot pretend to be another actor either: the function is unreachable to them, so the parameter is not an attack surface", async () => {
    const id = await makeJob();
    const { error } = await seeker.client.rpc("set_job_apply_link", { p_job_id: id, p_actor: member.id, p_url: COMPANY, p_kind: "company", p_ats_confirmed: false });
    expect(error).not.toBeNull();
    expect((await row(id)).apply_link).toBeNull();
  });
});

describe("reads", () => {
  it("anon and authenticated can read the kind and the host but NOT the address (42501), alone or with others", async () => {
    const id = await makeJob();
    await setLink(member.id, id, COMPANY, "company");
    for (const [name, client] of [["anon", anon], ["authenticated", member.client]] as const) {
      const ok = await client.from("job_postings").select("apply_link_kind, apply_link_host").eq("id", id).maybeSingle();
      expect(ok.error, `${name} reads kind and host`).toBeNull();
      expect(ok.data).toMatchObject({ apply_link_kind: "company", apply_link_host: `careers.${DOMAIN}` });
      const secret = await (client.from("job_postings") as unknown as { select: (c: string) => { eq: (k: string, v: string) => Promise<{ error: { code?: string } | null }> } }).select("apply_link").eq("id", id);
      expect(secret.error?.code, `${name} reading apply_link`).toBe("42501");
    }
  });
  it("get_job_apply_link answers a member with the address, an outsider and a seeker with null, and anon not at all", async () => {
    const id = await makeJob();
    await setLink(member.id, id, COMPANY, "company");
    expect((await member.client.rpc("get_job_apply_link", { p_job_id: id })).data).toBe(COMPANY);
    expect((await outsider.client.rpc("get_job_apply_link", { p_job_id: id })).data).toBeNull();
    expect((await seeker.client.rpc("get_job_apply_link", { p_job_id: id })).data).toBeNull();
    expect((await anon.rpc("get_job_apply_link", { p_job_id: id })).error).not.toBeNull();
  });
  it("the audit and click tables are unreadable and unwritable by every API role", async () => {
    const id = await makeJob();
    await setLink(member.id, id, COMPANY, "company");
    for (const [name, client] of [["authenticated", member.client], ["anon", anon]] as const) {
      for (const table of ["job_posting_apply_link_events", "apply_link_clicks"]) {
        expect((await client.from(table as never).select("*")).error, `${name} reads ${table}`).not.toBeNull();
        expect((await client.from(table as never).insert({ job_posting_id: id } as never)).error, `${name} writes ${table}`).not.toBeNull();
      }
    }
  });
});

describe("the click counter", () => {
  it("counts per job per day with no user id, only the service role can call it, and a second click adds one", async () => {
    const id = await makeJob();
    expect((await admin.rpc("record_apply_link_click", { p_job_id: id })).error).toBeNull();
    expect((await admin.rpc("record_apply_link_click", { p_job_id: id })).error).toBeNull();
    const rows = (await admin.from("apply_link_clicks").select("*").eq("job_posting_id", id)).data ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0].clicks).toBe(2);
    expect(Object.keys(rows[0]).sort()).toEqual(["clicks", "day", "job_posting_id"]);
    expect((await member.client.rpc("record_apply_link_click", { p_job_id: id })).error).not.toBeNull();
    expect((await anon.rpc("record_apply_link_click", { p_job_id: id })).error).not.toBeNull();
  });
});

describe("the lock: two changes at once on one job are serialised", () => {
  it("both calls finish, the last one wins, and the audit has one row per real change", async () => {
    const id = await makeJob();
    const start = (await row(id)).apply_link;
    const submitted = [`https://${DOMAIN}/one`, `https://${DOMAIN}/two`];
    const [a, b] = await Promise.all(submitted.map((url) => setLink(member.id, id, url, "company")));
    expect(a.error).toBeNull();
    expect(b.error).toBeNull();
    const events = await linkEvents(id);
    expect(events).toHaveLength(2);
    // Order-independent on purpose: created_at is the transaction's start (now()), not the order the lock was taken, so which event is "second" by created_at can differ from the lock order.
    // The lock order is the CHAIN: one event starts from the job's starting link, the other starts from where the first ended.
    const first = events.find((e) => e.old_url === start);
    expect(first, "one event starts from the job's starting link").toBeDefined();
    const second = events.find((e) => e !== first);
    expect(second?.old_url, "the other starts from where the first ended").toBe(first?.new_url);
    expect([first?.new_url, second?.new_url].sort()).toEqual([...submitted].sort());
    // The stored link is where the LAST event in the chain ended.
    expect((await row(id)).apply_link).toBe(second?.new_url);
  });
});
