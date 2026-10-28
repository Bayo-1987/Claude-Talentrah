/**
 * The Signups number in the admin nav, against the real database (ADMIN-NAV-SIGNUPS-COUNT-1).
 *
 * N = countSignups(): the Signups page's own total (the same scope, so QA and owner test accounts are left out).
 * E = countSignupEmployers(): the people inside that scope who belong to at least one organisation, each counted ONCE.
 * S = N - E. The nav shows N; its name and hover text carry S and E.
 *
 * NOTHING HERE COMPARES TWO READS OF A TABLE THAT OTHER TEST FILES ARE CHANGING. CI runs the whole suite in parallel against one database, and other files create and delete accounts (one of them makes 68 and turns some into QA accounts)
 * while this one runs, so "the total I read now equals the total I read a moment ago" can fail for reasons that have nothing to do with the count. Every assertion is therefore one of two kinds:
 *   - SCOPED TO THIS FILE'S OWN ACCOUNTS: the count functions take `onlyIds` (the same scope, narrowed to given profile ids), so N and E are counted among the six accounts below, which nothing else touches, and the list is asked for the same
 *     rows by the unique tag in their addresses. The numbers are exact (5, 3, 2), not "about right";
 *   - a fact that cannot be moved by anyone else: a sound lower bound (the five in-scope accounts exist, so the table-wide N is at least 5), or what THIS process did (which tables the nav touched).
 *
 * A small fixed fixture of UNPOOLED auth users (nothing leased from the shared pool), each with a known place in the answer:
 *
 *   u1  a person in organisation A                              -> in N, in E
 *   u2  a second person in organisation A                       -> in N, in E   (an organisation with several people counts each person once)
 *   u3  a person in organisation A AND organisation B           -> in N, in E, ONCE   (a person with two memberships is one employer, not two)
 *   u4  a QA account (first name "QA") in organisation C        -> in neither: the QA exclusion applies to the member's profile too
 *   u5  a plain account, no organisation                        -> in N, a job seeker
 *   u6  another plain account; it also created organisation D, which has no member at all   -> in N, a job seeker
 *
 * The fixture adds 4 organisations and 5 memberships but only 3 employers, so counting organisations or memberships instead of people gives a different E (the mutants).
 * A member with no profile row cannot exist (organization_members.user_id references profiles(id)); that is checked, and the count is taken from the profiles side so it could not count one anyway.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { admin } from "../support/auth";
import { isQaAccount } from "@/lib/profile/qa-account";
import { deleteOrgsCascade } from "../support/delete-orgs";
import * as people from "@/lib/admin/people/queries";

const touched = vi.hoisted(() => ({ tables: [] as string[] }));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
// The real service-role client, wrapped only to note which tables the code under test asks for. This process's own record: other test files run in other processes and cannot add to it.
vi.mock("@/lib/supabase/service-role", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/supabase/service-role")>();
  return {
    ...real,
    createServiceRoleClient: () => {
      const client = real.createServiceRoleClient();
      return new Proxy(client, {
        get(target, prop, receiver) {
          if (prop === "from") return (table: string) => (touched.tables.push(table), target.from(table as never));
          return Reflect.get(target, prop, receiver);
        },
      });
    },
  };
});
vi.mock("@/lib/admin/moderation/queues", () => ({
  queueCounts: async () => ({ scholarships: 0, reports: 0, campaigns: 0, feedback: 0, courses: 0, ops: 0, finance: 0, employerVerification: 0, jobReview: 0, mentorReview: 0 }),
}));
const { AdminNav } = await import("@/components/admin/admin-nav");

const T = randomUUID().slice(0, 8);
const AUTH_DOMAIN = "@talentrah.test";
const userIds: string[] = [];
const orgIds: string[] = [];
const emails: string[] = [];
const names: string[] = [];

const ids = { u1: "", u2: "", u3: "", u4: "", u5: "", u6: "" };
let orgA = "";

/** Where each of this file's accounts sits, worked out here: every profile read through the service role (paged), the TypeScript QA rule applied to each, and the user ids that hold a membership. Only this file's own ids are asserted on. */
async function placement() {
  const inScope = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from("profiles").select("id, email, first_name, last_name, referral_leaderboard_display_name").order("id").range(from, from + 999);
    if (error) throw new Error(`profiles: ${error.message}`);
    for (const p of data ?? []) {
      if (!isQaAccount({ email: p.email, firstName: p.first_name, lastName: p.last_name, leaderboardName: p.referral_leaderboard_display_name })) inScope.add(p.id);
    }
    if ((data ?? []).length < 1000) break;
  }
  const { data: members, error } = await admin.from("organization_members").select("user_id").in("user_id", Object.values(ids));
  if (error) throw new Error(`members: ${error.message}`);
  const employers = new Set((members ?? []).map((m) => m.user_id).filter((id) => inScope.has(id)));
  return { inScope, employers };
}

async function makeUser(tag: string, names_?: { first: string; last: string }): Promise<string> {
  const email = `ans-${T}-${tag}${AUTH_DOMAIN}`;
  emails.push(email);
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser ${tag}: ${error?.message ?? "no user"}`);
  userIds.push(data.user.id);
  const first = names_?.first ?? `Ans${T}${tag}`;
  const last = names_?.last ?? "Fixture";
  names.push(first);
  const { error: upError } = await admin.from("profiles").update({ first_name: first, last_name: last }).eq("id", data.user.id);
  if (upError) throw new Error(`profile ${tag}: ${upError.message}`);
  return data.user.id;
}

async function makeOrg(tag: string, createdBy: string): Promise<string> {
  const { data, error } = await admin.from("organizations").insert({ name: `ans-org-${tag}-${T}`, domain: `ans-${T}-${tag}.example.test`, created_by: createdBy }).select("id").single();
  if (error || !data) throw new Error(`org ${tag}: ${error?.message ?? "no org"}`);
  orgIds.push(data.id);
  return data.id;
}

async function join(orgId: string, userId: string, role: "owner" | "admin" = "admin") {
  const { error } = await admin.from("organization_members").insert({ organization_id: orgId, user_id: userId, role });
  if (error) throw new Error(`member: ${error.message}`);
}

beforeAll(async () => {
  ids.u1 = await makeUser("1");
  ids.u2 = await makeUser("2");
  ids.u3 = await makeUser("3");
  ids.u4 = await makeUser("4", { first: "QA", last: "Employer" });
  ids.u5 = await makeUser("5");
  ids.u6 = await makeUser("6");

  orgA = await makeOrg("a", ids.u1);
  const orgB = await makeOrg("b", ids.u3);
  const orgC = await makeOrg("c", ids.u4);
  await makeOrg("d", ids.u6); // an organisation nobody is a member of
  await join(orgA, ids.u1, "owner");
  await join(orgA, ids.u2);
  await join(orgA, ids.u3);
  await join(orgB, ids.u3, "owner");
  await join(orgC, ids.u4, "owner");
}, 120_000);

afterAll(async () => {
  // Organisations first (members cascade), then the auth users (profiles cascade). Checked, never fired and forgotten.
  await deleteOrgsCascade(admin, orgIds);
  for (const id of userIds) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) throw new Error(`teardown deleteUser: ${error.message}`);
  }
}, 120_000);

const own = () => Object.values(ids);

describe("the fixture sits where it should", () => {
  it("u1, u2 and u3 are employers (u3 once); u4 (QA) is in neither N nor E; u5 and u6 are in N only", async () => {
    const x = await placement();
    for (const id of [ids.u1, ids.u2, ids.u3]) {
      expect(x.inScope.has(id)).toBe(true);
      expect(x.employers.has(id)).toBe(true);
    }
    expect(x.inScope.has(ids.u4)).toBe(false);
    expect(x.employers.has(ids.u4)).toBe(false);
    for (const id of [ids.u5, ids.u6]) {
      expect(x.inScope.has(id)).toBe(true);
      expect(x.employers.has(id)).toBe(false);
    }
  });

  it("the fixture really holds more organisations and memberships than employers (so counting those would give another number)", async () => {
    const { data: members } = await admin.from("organization_members").select("organization_id, user_id").in("user_id", own());
    const { data: orgs } = await admin.from("organizations").select("id").in("id", orgIds);
    expect(members).toHaveLength(5);
    expect(orgs).toHaveLength(4);
    expect(new Set((members ?? []).filter((m) => m.user_id !== ids.u4).map((m) => m.user_id)).size).toBe(3);
  });
});

describe("N is the Signups page's own total", () => {
  it("among this file's accounts, countSignups() is 5 (the QA account is left out) and is exactly what the list reports for the same rows", async () => {
    const n = await people.countSignups({ onlyIds: own() });
    expect(n).toBe(5);
    // the list asked for the same rows by the tag in their addresses: the same scope, the same five people
    const list = await people.listSignups({ page: 1, email: `ans-${T}-` });
    expect(list.total).toBe(n);
    expect(new Set(list.rows.map((r) => r.id))).toEqual(new Set([ids.u1, ids.u2, ids.u3, ids.u5, ids.u6]));
  });

  it("the table-wide total is at least those five (a bound no other file can move), and is a whole number", async () => {
    const n = await people.countSignups();
    expect(Number.isInteger(n)).toBe(true);
    expect(n).toBeGreaterThanOrEqual(5);
  });
});

describe("E is people, once each, inside the same scope", () => {
  it("among this file's accounts it is exactly 3: a second person in the same organisation counts, a person in two organisations counts once, the QA member does not", async () => {
    expect(await people.countSignupEmployers({ onlyIds: own() })).toBe(3);
  });

  it("E <= N and S = N - E is exactly 2 among this file's accounts (the two with no organisation)", async () => {
    const n = await people.countSignups({ onlyIds: own() });
    const e = await people.countSignupEmployers({ onlyIds: own() });
    expect(e).toBeLessThanOrEqual(n);
    expect(n - e).toBe(2);
  });

  it("the table-wide E is at least those three (the one table-wide bound no other file can move)", async () => {
    const e = await people.countSignupEmployers();
    expect(Number.isInteger(e)).toBe(true);
    expect(e).toBeGreaterThanOrEqual(3);
  });

  it("a member with no profile row cannot exist (the foreign key refuses it), and nothing about the count changes", async () => {
    const { error } = await admin.from("organization_members").insert({ organization_id: orgIds[0], user_id: randomUUID(), role: "admin" });
    expect(error?.code).toBe("23503");
    expect(await people.countSignupEmployers({ onlyIds: own() })).toBe(3);
  });
});

describe("it is a count and nothing else", () => {
  it("the helpers return plain numbers", async () => {
    expect(typeof (await people.countSignups())).toBe("number");
    expect(typeof (await people.countSignupEmployers())).toBe("number");
  });

  it("rendering the nav asks for the profiles table and nothing else (it never touches the audit table), and the markup carries the total and none of the fixture's names or addresses", async () => {
    touched.tables.length = 0;
    const html = renderToStaticMarkup(await AdminNav({ permissions: ["people_list"] as never }));
    // this process's own record of what the nav asked for: the recorder works (it saw the count queries) and the audit table is not among them
    expect(touched.tables.length).toBeGreaterThan(0);
    expect(new Set(touched.tables)).toEqual(new Set(["profiles"]));
    expect(touched.tables).not.toContain("admin_audit_log");

    expect(html).toMatch(/Signups, [\d,]+ (?:person|people): [\d,]+ job seekers?, [\d,]+ employers?/);
    expect(html).toMatch(/<span class="[^"]*">[\d,]+<\/span>/);
    for (const x of [...emails, ...names, ...Object.values(ids)]) expect(html, "the nav carries row data").not.toContain(x);
    expect(html).not.toContain("@");
  });
});
