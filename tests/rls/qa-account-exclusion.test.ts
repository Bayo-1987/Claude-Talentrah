/**
 * QA-EXCL, the database part (migration 0240) — a QA account is not shown on the four surfaces that are read inside the database: the Talent Directory listing
 * (and everything that starts from it), the portfolio read, the contact-request gate, and the referral leaderboard.
 *
 * The rule (agreed with S1 and the CTO): the email contains "+qa-" (any case), or the first name, the full name or the leaderboard display name is exactly "QA" or
 * starts with "QA " (capital letters, then a space). "Qasim" and "Qa Hoang" are NOT QA accounts and must stay visible.
 *
 * Every candidate below is listed (verified and opted in), has a portfolio item, and is on the leaderboard (opted in, one activated referral). So each surface is its
 * own control: the ordinary candidate (and the look-alikes) must be present, which means a pass for the QA candidates is not an empty fixture.
 *
 * DATABASE-BACKED, CI ONLY (no database on the authoring machine); written before the migration and red without it (public.is_qa_account does not exist, and the four
 * functions list a QA account). The same rule and the patched definitions were also exercised, with a byte-identical rollback, in a local copy of the real schema.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { admin, createAuthedTestUser, deleteTestUsers } from "../support/auth";
import { deleteOrgsCascade } from "../support/delete-orgs";
import qaCasesJson from "../fixtures/qa-exclusion-cases.json";

type Authed = Awaited<ReturnType<typeof createAuthedTestUser>>;
const untyped = (c: Authed["client"]) => c as unknown as typeof admin;
const tag = randomUUID().slice(0, 6);

/** One row of the shared table (tests/fixtures/qa-exclusion-cases.json): the four arguments of public.is_qa_account and the value MEASURED on the real function. */
interface QaCase {
  name: string;
  email: string | null;
  first: string | null;
  last: string | null;
  display: string | null;
  qa: boolean;
}
const qaCases = qaCasesJson as unknown as QaCase[];

interface Spec {
  key: string;
  email: string | null; // written to profiles.email when given
  first: string;
  last: string;
  display: string;
  qa: boolean;
}
const SPECS: Spec[] = [
  { key: "ordinary", email: null, first: "Ordinary", last: "Lister", display: `Board ordinary ${tag}`, qa: false },
  { key: "plusqa", email: `hello+qa-${tag}@example.test`, first: "Plusqa", last: "Lister", display: `Board plusqa ${tag}`, qa: true },
  { key: "plusqa-upper", email: `HELLO+QA-${tag}@EXAMPLE.TEST`, first: "Plusupper", last: "Lister", display: `Board plusupper ${tag}`, qa: true },
  { key: "qa-first", email: null, first: "QA", last: "Named", display: `Board qafirst ${tag}`, qa: true },
  { key: "qa-first-words", email: null, first: "QA Tester", last: "Named", display: `Board qatester ${tag}`, qa: true },
  { key: "qa-last-only", email: null, first: "Ex", last: "QA", display: `Board qalast ${tag}`, qa: false }, // "Ex QA" is neither exactly QA nor starts with "QA "
  { key: "qa-display", email: null, first: "Display", last: "Only", display: "QA Board", qa: true },
  { key: "qasim", email: null, first: "Qasim", last: "Khan", display: `Board qasim ${tag}`, qa: false },
  { key: "qa-lower-display", email: null, first: "Hoang", last: "Lister", display: "Qa Hoang", qa: false },
  { key: "qanon", email: null, first: "QAnon", last: "Lister", display: `Board qanon ${tag}`, qa: false },
];

let employer: Authed;
let orgId = "";
const people = new Map<string, { id: string; spec: Spec; referredId: string }>();

beforeAll(async () => {
  employer = await createAuthedTestUser("qaexcl-employer");
  const org = await admin.from("organizations").insert({ name: `QAEXCL-TEST Org ${tag}`, created_by: employer.id, verified: true }).select("id").single();
  if (org.error || !org.data) throw new Error(`fixture org: ${org.error?.message}`);
  orgId = org.data.id;
  const mem = await admin.from("organization_members").insert({ organization_id: orgId, user_id: employer.id, role: "owner" });
  if (mem.error) throw new Error(`fixture member: ${mem.error.message}`);
  const plan = await admin.from("talent_directory_plans").select("id").limit(1).single();
  const sub = await admin.from("talent_directory_subscriptions").insert({ organization_id: orgId, plan_id: plan.data!.id, expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString(), status: "active" });
  if (sub.error) throw new Error(`fixture subscription: ${sub.error.message}`);

  for (const spec of SPECS) {
    const [cand, referred] = await Promise.all([createAuthedTestUser(`qaexcl-${spec.key}`), createAuthedTestUser(`qaexcl-ref-${spec.key}`)]);
    const patch: Record<string, unknown> = {
      first_name: spec.first,
      last_name: spec.last,
      talent_directory_opt_in: true,
      talent_verification_status: "verified",
      talent_verification_score: 80,
      talent_verified_at: new Date().toISOString(),
      referral_leaderboard_opt_in: true,
      referral_leaderboard_display_name: spec.display,
    };
    if (spec.email) patch.email = spec.email;
    const up = await admin.from("profiles").update(patch as never).eq("id", cand.id);
    if (up.error) throw new Error(`fixture profile ${spec.key}: ${up.error.message}`);
    const item = await admin.from("talent_portfolio_items").insert({ user_id: cand.id, title: `QAEXCL portfolio ${spec.key}`, description: "x", url: `https://example.com/qaexcl-${spec.key}` });
    if (item.error) throw new Error(`fixture portfolio ${spec.key}: ${item.error.message}`);
    const ref = await admin.from("referrals").insert({ referrer_id: cand.id, referred_user_id: referred.id, status: "activated", activated_at: new Date().toISOString(), reward_credits_referrer: 5 });
    if (ref.error) throw new Error(`fixture referral ${spec.key}: ${ref.error.message}`);
    people.set(spec.key, { id: cand.id, spec, referredId: referred.id });
  }
}, 360_000);

afterAll(async () => {
  const check = async (p: PromiseLike<{ error: { message: string } | null }>) => {
    const { error } = await p;
    if (error) throw new Error(`cleanup failed: ${error.message}`);
  };
  const all = [...people.values()];
  const candIds = all.map((p) => p.id);
  const refIds = all.map((p) => p.referredId);
  if (refIds.length) await check(admin.from("referrals").delete().in("referred_user_id", refIds));
  if (candIds.length) {
    await check(admin.from("talent_directory_contact_requests").delete().in("candidate_id", candIds));
    await check(admin.from("talent_portfolio_items").delete().in("user_id", candIds));
  }
  if (orgId) {
    await check(admin.from("talent_directory_subscriptions").delete().eq("organization_id", orgId));
    await deleteOrgsCascade(admin, [orgId]);
  }
  await deleteTestUsers([...candIds, ...refIds, ...(employer ? [employer.id] : [])]);
}, 360_000);

const shown = (key: string) => people.get(key)!;
const qaKeys = () => SPECS.filter((s) => s.qa).map((s) => s.key);
const visibleKeys = () => SPECS.filter((s) => !s.qa).map((s) => s.key);

describe("public.is_qa_account — the rule", () => {
  const call = async (email: string | null, first: string | null, last: string | null, display: string | null) => {
    const { data, error } = await admin.rpc("is_qa_account" as never, { p_email: email, p_first: first, p_last: last, p_display: display } as never);
    expect(error).toBeNull();
    return data as unknown as boolean;
  };

  // ONE shared table: tests/fixtures/qa-exclusion-cases.json is read by this test (the real SQL function) and by the TypeScript helper's test. Each row's "qa" was MEASURED on the real
  // function, not assumed. Whitespace is written as JSON escapes in the file so nothing can hide a tab or a no-break space.
  it.each(qaCases.map((c) => [c.name, c] as const))("%s", async (_name, c) => {
    expect(await call(c.email, c.first, c.last, c.display ?? null)).toBe(c.qa);
  });

  it("the shared table is alive: it holds both outcomes and every real-name row is false", () => {
    expect(qaCases.length).toBeGreaterThan(40);
    expect(qaCases.some((c) => c.qa)).toBe(true);
    expect(qaCases.some((c) => !c.qa)).toBe(true);
    for (const real of ["Qadir Bello", "Qaisar", "Qa'id", "Qasim", "Qa Hoang", "QAnon", "Aqa Lead", "Quality Assurance"]) {
      const row = qaCases.find((c) => c.name.includes(real));
      expect(row, `a row for the real name ${real}`).toBeDefined();
      expect(row!.qa, `${real} must stay visible`).toBe(false);
    }
  });
});

describe("public.is_qa_account — who may call it, and how it runs", () => {
  it("is service_role only, immutable, SECURITY INVOKER, with an empty search_path", async () => {
    const { data, error } = await admin.rpc("function_acl_audit" as never);
    expect(error).toBeNull();
    const rows = (data as unknown as Array<{ function_name: string; identity_args: string; security_definer: boolean; search_path_config: string | null; anon_exec: boolean; authenticated_exec: boolean; service_role_exec: boolean; public_exec: boolean }>).filter(
      (r) => r.function_name === "is_qa_account",
    );
    expect(rows, "exactly one is_qa_account").toHaveLength(1);
    const r = rows[0];
    expect(r.identity_args).toBe("p_email text, p_first text, p_last text, p_display text");
    expect(r.security_definer).toBe(false);
    expect(r.search_path_config).toBe('search_path=""');
    expect({ anon: r.anon_exec, authenticated: r.authenticated_exec, service_role: r.service_role_exec, public: r.public_exec }).toEqual({ anon: false, authenticated: false, service_role: true, public: false });
  });

  it("a signed-in user cannot call it", async () => {
    const { error } = await untyped(employer.client).rpc("is_qa_account" as never, { p_email: "a@b.c", p_first: "A", p_last: "B", p_display: null } as never);
    expect(error?.code).toBe("42501");
  });
});

describe("Talent Directory: listing, portfolio and contact gate", () => {
  it("the fixture is sound: the listing function returns the ordinary candidate (so an absence below is a real absence)", async () => {
    const { data, error } = await admin.rpc("talent_directory_listed_ids" as never);
    expect(error).toBeNull();
    expect(((data ?? []) as unknown as string[]).includes(shown("ordinary").id)).toBe(true);
  });

  it("lists every non-QA candidate and none of the QA ones", async () => {
    const { data, error } = await admin.rpc("talent_directory_listed_ids" as never);
    expect(error).toBeNull();
    const listed = new Set((data ?? []) as unknown as string[]);
    for (const k of visibleKeys()) expect(listed.has(shown(k).id), `${k} must be listed`).toBe(true);
    for (const k of qaKeys()) expect(listed.has(shown(k).id), `${k} is a QA account and must NOT be listed`).toBe(false);
  });

  it("the paid search returns a non-QA candidate and nothing for a QA one", async () => {
    for (const k of visibleKeys()) {
      const { data, error } = await untyped(employer.client).rpc("talent_directory_search" as never, { p_candidate_id: shown(k).id } as never);
      expect(error).toBeNull();
      expect(((data ?? []) as unknown as Array<{ user_id: string }>).map((r) => r.user_id), `${k} is searchable`).toEqual([shown(k).id]);
    }
    for (const k of qaKeys()) {
      const { data, error } = await untyped(employer.client).rpc("talent_directory_search" as never, { p_candidate_id: shown(k).id } as never);
      expect(error).toBeNull();
      expect(data ?? [], `${k} must not be searchable`).toEqual([]);
    }
  });

  it("the portfolio is readable for a non-QA candidate and empty for a QA one", async () => {
    for (const k of visibleKeys()) {
      const { data, error } = await untyped(employer.client).rpc("talent_directory_portfolio_items" as never, { p_candidate_id: shown(k).id } as never);
      expect(error).toBeNull();
      expect((data ?? []) as unknown[], `${k} portfolio`).toHaveLength(1);
    }
    for (const k of qaKeys()) {
      const { data, error } = await untyped(employer.client).rpc("talent_directory_portfolio_items" as never, { p_candidate_id: shown(k).id } as never);
      expect(error).toBeNull();
      expect(data ?? [], `${k} portfolio must be hidden`).toEqual([]);
    }
  });

  it("the contact-request gate refuses a QA candidate as 'not listed' and lets a non-QA one through", async () => {
    const contact = async (candidateId: string) => {
      const { data, error } = await admin.rpc("request_talent_directory_contact" as never, { p_organization_id: orgId, p_candidate_id: candidateId, p_message: "Hello", p_requested_by: employer.id } as never);
      expect(error).toBeNull();
      return (data as unknown as Array<{ ok: boolean; reason: string }>)[0];
    };
    for (const k of qaKeys()) expect((await contact(shown(k).id)).reason, `${k}`).toBe("candidate_not_listed");
    for (const k of visibleKeys()) expect((await contact(shown(k).id)).reason, `${k}`).not.toBe("candidate_not_listed");
  });
});

describe("the referral leaderboard", () => {
  const board = async (limit: number) => {
    const { data, error } = await untyped(employer.client).rpc("referral_leaderboard" as never, {
      p_period_start: new Date(Date.now() - 86_400_000).toISOString(),
      p_period_end: new Date(Date.now() + 86_400_000).toISOString(),
      p_limit: limit,
    } as never);
    expect(error).toBeNull();
    return (data ?? []) as unknown as Array<{ display_name: string }>;
  };

  it("shows every non-QA candidate by display name and no QA one (email, first name, full name and display name rules)", async () => {
    const names = new Set((await board(500)).map((r) => r.display_name));
    for (const k of visibleKeys()) expect(names.has(shown(k).spec.display), `${k} must be on the leaderboard`).toBe(true);
    for (const k of qaKeys()) expect(names.has(shown(k).spec.display), `${k} is a QA account and must NOT be on the leaderboard`).toBe(false);
  });

  it("still applies its LIMIT in the database (a small limit returns at most that many rows)", async () => {
    expect((await board(2)).length).toBeLessThanOrEqual(2);
  });
});
