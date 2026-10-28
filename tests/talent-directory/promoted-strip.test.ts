/**
 * V5 / migration 0268: the Promoted strip in the employer's Talent Directory search. DATABASE-BACKED. Written before the migration: every case here fails until 0268 is applied.
 *
 * WHAT IS TESTED. Two functions. talent_directory_promoted_ids is the strip: boosted AND listed candidates only, at most 3 whatever is asked, ordered by a rotation that is fixed inside one bucket (the UTC hour)
 * and moves between buckets. talent_directory_search returns the strip as the first rows of the first page (section 'promoted') and everyone else as the organic list (section 'organic'), never repeating a strip
 * candidate, ordered by the NEWEST LIVE EARNED MARK DATE (the V1 table, verification_marks) with no boost term anywhere in that order.
 *
 * HOW IT STAYS DETERMINISTIC ON A SHARED DATABASE. Other files plant boosted candidates too, so the strip of the real search may hold someone else. The helper is therefore tested with p_only_ids (only this file's
 * candidates) and an explicit bucket; the search is tested for what must hold whoever else is boosted: shape, the cap, the first-page rule, no repeats, the order of THIS file's organic rows, and that the strip equals
 * the helper's answer for the same bucket. Every candidate is remote-ready and every query filters on that, which keeps most foreign rows out.
 * The users are NOT pooled (verification_marks cannot be deleted by service_role, so marks on a reused identity would stay; deleting an unpooled user cascades them), like tests/rls/verification-marks.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { admin as typedAdmin, deleteTestUsers, sessionFor } from "../support/auth";
import { deleteOrgsCascade } from "../support/delete-orgs";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"] as const) {
  if (!process.env[key]) throw new Error(`The promoted-strip test cannot run: ${key} is not set.`);
}
const admin = typedAdmin as unknown as SupabaseClient;
const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
const tag = randomUUID().slice(0, 6);
const DAY = 86_400_000;
const daysAgo = (d: number) => new Date(Date.now() - d * DAY).toISOString();
const monthsAgo = (m: number) => {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - m);
  return d.toISOString();
};

type Authed = { id: string; email: string; client: SupabaseClient };
async function unpooled(prefix: string): Promise<Authed> {
  const email = `${prefix}-${randomUUID()}@talentrah.test`;
  for (let attempt = 1; ; attempt++) {
    const { data, error } = await typedAdmin.auth.admin.createUser({ email, email_confirm: true });
    if (!error && data.user) return { id: data.user.id, email, client: (await sessionFor(email, data.user.id)) as unknown as SupabaseClient };
    if (attempt < 4 && error && /rate limit/i.test(error.message)) {
      await new Promise((r) => setTimeout(r, 500 * attempt));
      continue;
    }
    throw new Error(`createUser ${email}: ${error?.message ?? "no user returned"}`);
  }
}

interface Row { user_id: string; first_name: string | null; last_name: string | null; country: string | null; available_for_hire: boolean; remote_ready: boolean; earliest_start_date: string | null; verified_at: string | null; review_type: string | null; section: string }
const SEARCH_KEYS = ["available_for_hire", "country", "earliest_start_date", "first_name", "last_name", "remote_ready", "review_type", "section", "user_id", "verified_at"];

const userIds: string[] = [];
const orgIds: string[] = [];
let employer: Authed;
let employerNoSub: Authed;
let loneUser: Authed;
const c: Record<string, Authed> = {};
/** What each candidate should sort on in the organic list: the newest live mark date, else the profile's review date. */
const key: Record<string, number> = {};

async function makeCandidate(name: string, profile: Record<string, unknown>, mark?: { earnedAt: string }) {
  const u = await unpooled(`strip-${name}-${tag}`);
  userIds.push(u.id);
  c[name] = u;
  const { error } = await admin.from("profiles").update({ talent_directory_opt_in: true, talent_verification_status: "verified", talent_remote_ready: true, talent_available_for_hire: true, ...profile }).eq("id", u.id);
  if (error) throw new Error(`profile ${name}: ${error.message}`);
  if (mark) {
    const r = await admin.rpc("award_verification_mark", { p_user_id: u.id, p_mark_type: "resume_reviewed", p_field: null, p_level: null, p_review_type: "ai", p_source_id: null, p_resume_hash: null, p_earned_at: mark.earnedAt });
    if (r.error) throw new Error(`mark ${name}: ${r.error.message}`);
  }
}

const future = () => new Date(Date.now() + 7 * DAY).toISOString();
const ORGANIC_NAMES = ["A", "B", "C", "D"];
const BOOSTED_NAMES = ["P1", "P2", "P3", "P4", "P5"];
const INELIGIBLE = ["X1", "X2", "X3", "X4", "X5"];

beforeAll(async () => {
  employer = await unpooled(`strip-emp-${tag}`);
  employerNoSub = await unpooled(`strip-nosub-${tag}`);
  loneUser = await unpooled(`strip-lone-${tag}`);
  userIds.push(employer.id, employerNoSub.id, loneUser.id);

  // Each date is computed once, so the expected order uses exactly the instants the database holds.
  const when = { A: daysAgo(1), B: daysAgo(10), C: daysAgo(3), D: daysAgo(5), X1: daysAgo(2) };
  // Unboosted: the organic order is decided by the marks, and the profile date points the OTHER way for A and B, so a search that still ordered by profiles.talent_verified_at fails here.
  await makeCandidate("A", { talent_verified_at: daysAgo(30) }, { earnedAt: when.A });
  await makeCandidate("B", { talent_verified_at: daysAgo(2) }, { earnedAt: when.B });
  await makeCandidate("C", { talent_verified_at: when.C }, { earnedAt: monthsAgo(13) }); // its only mark has expired: it falls back to the profile date
  await makeCandidate("D", { talent_verified_at: when.D }); // no mark row at all: the profile date
  key.A = Date.parse(when.A);
  key.B = Date.parse(when.B);
  key.C = Date.parse(when.C);
  key.D = Date.parse(when.D);
  // Boosted and listed: five of them, so at least two are not in a 3-seat strip. Their marks are OLD, so a boost term in the organic order would lift them above A to D.
  for (const [i, n] of BOOSTED_NAMES.entries()) {
    const earned = daysAgo(200 + i);
    await makeCandidate(n, { talent_verified_at: earned, talent_boosted_until: future() }, { earnedAt: earned });
    key[n] = Date.parse(earned);
  }
  // Not in the directory for a reason of their own (a boost is never a way in), except X1, whose boost has expired: listed, and an ordinary organic row.
  await makeCandidate("X1", { talent_boosted_until: new Date(Date.now() - DAY).toISOString(), talent_verified_at: when.X1 }, { earnedAt: when.X1 });
  await makeCandidate("X2", { talent_boosted_until: future(), talent_verification_status: "unverified", talent_verified_at: null });
  await makeCandidate("X3", { talent_boosted_until: future(), talent_directory_opt_in: false, talent_verified_at: daysAgo(1) }, { earnedAt: daysAgo(1) });
  await makeCandidate("X4", { talent_boosted_until: future(), first_name: "QA", last_name: "Tester", talent_verified_at: daysAgo(1) }, { earnedAt: daysAgo(1) });
  await makeCandidate("X5", { talent_boosted_until: future(), deletion_requested_at: new Date().toISOString(), talent_verified_at: daysAgo(1) }, { earnedAt: daysAgo(1) });
  key.X1 = Date.parse(when.X1);

  const { data: o1 } = await admin.from("organizations").insert({ name: `Strip Sub Org ${tag}`, created_by: employer.id, verified: true }).select("id").single();
  const { data: o2 } = await admin.from("organizations").insert({ name: `Strip NoSub Org ${tag}`, created_by: employerNoSub.id, verified: true }).select("id").single();
  orgIds.push(o1!.id, o2!.id);
  await admin.from("organization_members").insert([{ organization_id: o1!.id, user_id: employer.id, role: "owner" }, { organization_id: o2!.id, user_id: employerNoSub.id, role: "owner" }]);
  const { data: plan } = await admin.from("talent_directory_plans").select("id").limit(1).single();
  await admin.from("talent_directory_subscriptions").insert({ organization_id: o1!.id, plan_id: plan!.id, status: "active", expires_at: new Date(Date.now() + 30 * DAY).toISOString() });
  await admin.from("talent_directory_subscriptions").insert({ organization_id: o2!.id, plan_id: plan!.id, status: "lapsed", expires_at: new Date(Date.now() - DAY).toISOString() });
}, 240_000);

afterAll(async () => {
  await deleteOrgsCascade(typedAdmin, orgIds);
  await deleteTestUsers(userIds);
  const { data: left, error } = await admin.from("verification_marks").select("id").in("user_id", userIds);
  if (error) throw new Error(`could not check for leftover marks: ${error.message}`);
  if ((left ?? []).length > 0) throw new Error(`${left!.length} mark(s) survived deleting their users`);
}, 120_000);

const ids = (...names: string[]) => names.map((n) => c[n].id);
const nameOf = (id: string) => Object.entries(c).find(([, u]) => u.id === id)?.[0];
const strip = async (bucket: number, extra: Record<string, unknown> = {}) => admin.rpc("talent_directory_promoted_ids", { p_bucket: bucket, p_only_ids: ids(...BOOSTED_NAMES, ...ORGANIC_NAMES, ...INELIGIBLE, "X1"), ...extra });
const stripIds = (data: unknown) => ((data ?? []) as Array<{ id: string; pos: number }>).map((r) => r.id);

/** Every page of the search as one employer sees it (remote-ready only, to stay clear of foreign rows), plus the first page on its own. */
async function pages(client: SupabaseClient, limit = 50, extra: Record<string, unknown> = {}): Promise<{ first: Row[]; all: Row[] }> {
  const all: Row[] = [];
  let first: Row[] = [];
  for (let offset = 0; offset < 2000; offset += limit) {
    const { data, error } = await client.rpc("talent_directory_search", { p_remote_ready: true, p_limit: limit, p_offset: offset, ...extra });
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Row[];
    if (offset === 0) first = rows;
    all.push(...rows);
    if (rows.filter((r) => r.section === "organic").length < limit) break;
  }
  return { first, all };
}

describe("the strip helper: boosted and listed candidates only, at most three", () => {
  it("returns only boosted, listed candidates: not the unboosted, the expired boost, the unverified, the opted-out, the QA account, the deletion-requested one", async () => {
    const { data, error } = await strip(7);
    expect(error).toBeNull();
    const got = stripIds(data);
    expect(got.length).toBe(3);
    for (const id of got) expect(BOOSTED_NAMES).toContain(nameOf(id));
  });

  it("never returns more than three, whatever the cap asked for", async () => {
    for (const cap of [10, 1000]) expect(stripIds((await strip(7, { p_cap: cap })).data)).toHaveLength(3);
    expect(stripIds((await strip(7, { p_cap: 2 })).data)).toHaveLength(2);
    expect(stripIds((await strip(7, { p_cap: 0 })).data)).toHaveLength(0);
    expect(stripIds((await strip(7, { p_cap: -4 })).data)).toHaveLength(0);
  });

  it("with only two boosted candidates in play the strip holds exactly those two, positions 1 and 2", async () => {
    const { data } = await admin.rpc("talent_directory_promoted_ids", { p_bucket: 11, p_only_ids: ids("P1", "P2", ...ORGANIC_NAMES, ...INELIGIBLE) });
    const rows = data as Array<{ id: string; pos: number }>;
    expect(rows.map((r) => r.id).sort()).toEqual(ids("P1", "P2").sort());
    expect(rows.map((r) => r.pos)).toEqual([1, 2]);
  });

  it("an expired boost, an unverified candidate, an opted-out one, a QA account and a deletion-requested one never appear in any bucket", async () => {
    const seen = new Set<string>();
    for (let b = 0; b < 60; b++) for (const id of stripIds((await strip(b)).data)) seen.add(id);
    expect(seen.size, "the strip must have answered for the check below to mean anything").toBeGreaterThanOrEqual(3);
    for (const n of [...INELIGIBLE, "X1", ...ORGANIC_NAMES]) expect(seen.has(c[n].id), `${n} reached the strip`).toBe(false);
  });

  it("is fixed inside one bucket (a refresh does not reshuffle) and moves between buckets, so every boosted candidate gets its turn", async () => {
    const same = [stripIds((await strip(1234)).data), stripIds((await strip(1234)).data)];
    expect(same[0]).toEqual(same[1]);
    const orders = new Set<string>();
    const everyone = new Set<string>();
    for (let b = 0; b < 80; b++) {
      const got = stripIds((await strip(b)).data);
      orders.add(got.join(","));
      for (const id of got) everyone.add(id);
    }
    expect(orders.size).toBeGreaterThan(5);
    for (const n of BOOSTED_NAMES) expect(everyone.has(c[n].id), `${n} never got a seat`).toBe(true);
  });

  it("applies the remote-ready and available-for-hire filters", async () => {
    const [{ data: yes }, { data: no }] = await Promise.all([strip(7, { p_remote_ready: true }), strip(7, { p_remote_ready: false })]);
    expect(stripIds(yes)).toHaveLength(3);
    expect(stripIds(no)).toHaveLength(0);
    expect(stripIds((await strip(7, { p_available_for_hire: false })).data)).toHaveLength(0);
  });

  it("cannot be called by a signed-in user or an anonymous caller", async () => {
    const args = { p_bucket: 7, p_only_ids: ids("P1") };
    expect((await employer.client.rpc("talent_directory_promoted_ids", args)).error?.code).toBe("42501");
    expect((await anon.rpc("talent_directory_promoted_ids", args)).error?.code).toBe("42501");
  });
});

describe("the search: two labelled sections, in one result", () => {
  it("returns the ten documented columns and nothing about the boost", async () => {
    const { first } = await pages(employer.client);
    expect(first.length).toBeGreaterThan(0);
    for (const r of first) expect(Object.keys(r).sort()).toEqual(SEARCH_KEYS);
    for (const r of first) expect(["promoted", "organic"]).toContain(r.section);
  });

  it("holds at most three promoted rows, all before every organic row, on the first page only", async () => {
    const { first, all } = await pages(employer.client, 5);
    const promoted = first.filter((r) => r.section === "promoted");
    expect(promoted.length, "five of this file's candidates are boosted and listed, so all three seats are taken").toBe(3);
    expect(first.slice(0, promoted.length).every((r) => r.section === "promoted")).toBe(true);
    expect(first.slice(promoted.length).every((r) => r.section === "organic")).toBe(true);
    expect(all.filter((r) => r.section === "promoted")).toHaveLength(promoted.length);
    const second = await employer.client.rpc("talent_directory_search", { p_remote_ready: true, p_limit: 5, p_offset: 5 });
    expect(((second.data ?? []) as Row[]).filter((r) => r.section === "promoted")).toEqual([]);
  });

  it("the strip is the helper's answer for the current bucket, and its members are boosted listed candidates", async () => {
    const b0 = Math.floor(Date.now() / 3_600_000);
    const { first } = await pages(employer.client);
    const got = first.filter((r) => r.section === "promoted").map((r) => r.user_id);
    expect(got).toHaveLength(3);
    const candidates = await Promise.all([b0 - 1, b0, b0 + 1].map(async (b) => stripIds((await admin.rpc("talent_directory_promoted_ids", { p_bucket: b, p_remote_ready: true })).data)));
    expect(candidates.some((expected) => JSON.stringify(expected) === JSON.stringify(got)), `strip ${JSON.stringify(got)} matches no bucket near ${b0}`).toBe(true);
    for (const id of got) expect(nameOf(id) === undefined || BOOSTED_NAMES.includes(nameOf(id)!)).toBe(true);
  });

  it("nobody appears twice across pages: a strip candidate is never also in the organic list", async () => {
    const { all } = await pages(employer.client, 4);
    const seen = all.map((r) => r.user_id);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("a boosted candidate who is not in the directory is in neither section (a boost is never a way in), and an expired boost reads as an ordinary organic row", async () => {
    const { all } = await pages(employer.client, 50);
    const got = new Set(all.map((r) => r.user_id));
    for (const n of ["X2", "X3", "X4", "X5"]) expect(got.has(c[n].id), `${n} is in the directory results`).toBe(false);
    expect(all.find((r) => r.user_id === c.X1.id)?.section).toBe("organic");
  });

  it("the organic list is ordered by the newest live earned mark date: the profile date does not decide, an expired mark falls back to the profile date, and the boost decides nothing", async () => {
    const { all } = await pages(employer.client, 50);
    const organic = all.filter((r) => r.section === "organic").map((r) => nameOf(r.user_id)).filter((n): n is string => !!n && key[n] !== undefined);
    expect(organic).toEqual(expect.arrayContaining([...ORGANIC_NAMES, "X1"]));
    const keys = organic.map((n) => key[n]);
    expect(keys, `order was ${organic.join(" ")}`).toEqual([...keys].sort((x, y) => y - x));
    // at least two of the five boosted candidates are not in a three-seat strip, and they sit below every unboosted one (their marks are older)
    const boostedOrganic = organic.filter((n) => BOOSTED_NAMES.includes(n));
    expect(boostedOrganic.length).toBeGreaterThanOrEqual(2);
    const lastUnboosted = Math.max(...organic.map((n, i) => (BOOSTED_NAMES.includes(n) ? -1 : i)));
    const firstBoosted = Math.min(...organic.map((n, i) => (BOOSTED_NAMES.includes(n) ? i : Infinity)));
    expect(firstBoosted, `a boosted candidate sits above an unboosted one: ${organic.join(" ")}`).toBeGreaterThan(lastUnboosted);
  });

  it("still returns the profile's review date as verified_at, so what an employer page shows is unchanged", async () => {
    const { all } = await pages(employer.client, 50);
    for (const n of ["A", "B", "D"]) {
      const row = all.find((r) => r.user_id === c[n].id)!;
      const { data: p } = await admin.from("profiles").select("talent_verified_at").eq("id", c[n].id).single();
      expect(Date.parse(row.verified_at!)).toBe(Date.parse(p!.talent_verified_at as string));
      expect(row.review_type === null || ["ai", "human"].includes(row.review_type)).toBe(true);
    }
  });

  it("limit and offset apply to the organic list", async () => {
    const { data } = await employer.client.rpc("talent_directory_search", { p_remote_ready: true, p_limit: 2, p_offset: 0 });
    const rows = (data ?? []) as Row[];
    expect(rows.filter((r) => r.section === "organic").length).toBeLessThanOrEqual(2);
    expect(rows.length).toBeLessThanOrEqual(5);
  });

  it("a boost cannot change WHICH organic candidates land on a page: read page after page with more organic candidates than the limit, no boosted candidate with old marks takes a seat from a newer unboosted one", async () => {
    // The full list (limit 50) hides this case: there the page holds everybody and only the ORDER inside it shows. Here every page is cut, so the ORDER BY that picks the page decides who is on page 1, 2 and 3.
    // The fixture: A, B, C, D and X1 are unboosted (X1: its boost expired) with marks or review dates of 1 to 10 days; the boosted P1..P5 have marks 200 days old, and at least two of them are not in the 3-seat strip.
    const UNBOOSTED = [...ORGANIC_NAMES, "X1"];
    const NEWER_THAN = (b: string) => UNBOOSTED.filter((u) => key[u] > key[b]);
    const read = async (limit: number) => {
      const pagesSeen: string[][] = [];
      for (let offset = 0; offset < 2000; offset += limit) {
        const { data, error } = await employer.client.rpc("talent_directory_search", { p_remote_ready: true, p_limit: limit, p_offset: offset });
        if (error) throw new Error(error.message);
        const organic = ((data ?? []) as Row[]).filter((r) => r.section === "organic");
        pagesSeen.push(organic.map((r) => nameOf(r.user_id) ?? "?"));
        if (organic.length < limit) break;
      }
      return pagesSeen;
    };
    // The rule, per page: when a boosted fixture candidate is on a page, every unboosted fixture candidate with a newer mark has been seen already, on an earlier page or earlier on this one.
    const violations = (pagesSeen: string[][]) => {
      const out: string[] = [];
      const seen = new Set<string>();
      pagesSeen.forEach((page, p) => {
        for (const n of page) {
          if (BOOSTED_NAMES.includes(n)) for (const u of NEWER_THAN(n)) if (!seen.has(u)) out.push(`page ${p + 1}: ${n} (marks 200 days old) is here but ${u} (newer) is not on this or an earlier page: ${pagesSeen.map((x) => x.join(",")).join(" | ")}`);
          seen.add(n);
        }
      });
      return out;
    };
    for (const limit of [2, 3]) {
      let last: string[] = [];
      let pagesSeen: string[][] = [];
      // Other files plant candidates on the same database: a row that appears or goes between two page calls shifts the pages. Only a rule broken on every one of three reads fails the case (a broken ORDER BY breaks it on every read).
      for (let attempt = 1; attempt <= 3; attempt++) {
        pagesSeen = await read(limit);
        last = violations(pagesSeen);
        if (last.length === 0) break;
      }
      const flat = pagesSeen.flat();
      // not vacuous: the pages are cut (a third page exists, so pages 1 and 2 are full), every unboosted fixture candidate and at least two boosted ones are read, and the boosted ones come after the unboosted ones
      expect(pagesSeen.length, `limit ${limit}: the list must run to a third page, so that page 1 and page 2 are full and cut`).toBeGreaterThanOrEqual(3);
      expect(flat, `limit ${limit}`).toEqual(expect.arrayContaining(UNBOOSTED));
      expect(flat.filter((n) => BOOSTED_NAMES.includes(n)).length, `limit ${limit}: boosted candidates outside the strip`).toBeGreaterThanOrEqual(2);
      expect(last, `limit ${limit}`).toEqual([]);
    }
  });

  it("looks up one candidate with the section that candidate holds now; a boosted candidate outside the directory returns nothing", async () => {
    const { all } = await pages(employer.client, 50);
    for (const n of ["A", "P1", "P2", "P3", "P4", "P5"]) {
      // the strip is chosen among the candidates matching the call's filters, so the lookup carries the same filter as the list it is compared with
      const { data, error } = await employer.client.rpc("talent_directory_search", { p_remote_ready: true, p_candidate_id: c[n].id });
      expect(error).toBeNull();
      const rows = (data ?? []) as Row[];
      expect(rows).toHaveLength(1);
      expect(["promoted", "organic"], `${n} has no section`).toContain(rows[0].section);
      expect(rows[0].section, `${n}`).toBe(all.find((r) => r.user_id === c[n].id)?.section);
    }
    for (const n of ["X2", "X3", "X4", "X5"]) expect(((await employer.client.rpc("talent_directory_search", { p_candidate_id: c[n].id })).data ?? []) as Row[]).toEqual([]);
  });

  it("a single-candidate lookup finds a strip member whatever the offset (the first-page rule is for lists, not for looking someone up)", async () => {
    const { first } = await pages(employer.client, 50);
    const member = first.find((r) => r.section === "promoted")!;
    expect(member, "there is a strip member to look up").toBeDefined();
    const { data } = await employer.client.rpc("talent_directory_search", { p_remote_ready: true, p_candidate_id: member.user_id, p_offset: 7 });
    expect(((data ?? []) as Row[]).map((r) => [r.user_id, r.section])).toEqual([[member.user_id, "promoted"]]);
  });
});

describe("who may run the search", () => {
  it("an organisation without an active subscription gets nothing, and so does a user with no organisation", async () => {
    for (const who of [employerNoSub, loneUser]) {
      const { data, error } = await who.client.rpc("talent_directory_search", { p_remote_ready: true });
      expect(error).toBeNull();
      expect(data ?? []).toEqual([]);
    }
  });

  it("an anonymous caller is refused at the database", async () => {
    expect((await anon.rpc("talent_directory_search", {})).error?.code).toBe("42501");
  });
});
