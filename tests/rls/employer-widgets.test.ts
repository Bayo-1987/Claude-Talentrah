/**
 * Migration 0237 (the employer job-list widget, database part): the per-organisation switch (employer_widgets) and the one public read (org_job_widget).
 *
 * DATABASE-BACKED, CI ONLY. Written before the migration and red without it (the table and the function do not exist). Every call goes through the real client path (PostgREST), with every argument named and
 * sent: a PostgREST call that leaves an argument out is looked up as a different function (the QA-rule test found that out the hard way), so nothing here relies on a local function call.
 *
 * What it proves, each its own control so a pass is not an empty fixture:
 *   - org_job_widget returns the open, listed, internal, unexpired postings of a verified, enabled, non-QA organisation, newest first, capped at max_items, with EXACTLY the agreed keys;
 *   - every excluded kind is absent (draft, closed, removed, unlisted, superseded, expired), and every failed organisation gate answers NULL (unverified, disabled, no row, unknown, null, QA-created);
 *   - the posting set equals what the public feed shows for that organisation after the widget-only rules (anon through row level security);
 *   - neither anon nor a signed-in user can call it; the service role can;
 *   - employer_widgets: a member reads, creates and changes their own row (enabled defaults to false, max_items to 10), cannot touch the key or the timestamps, cannot delete; a stranger sees and changes nothing; anon is refused;
 *   - deleting the organisation removes its row;
 *   - two real organisations with different owners cannot see or change each other's row; a signed-in non-member sees no rows and cannot call the function; an organisation whose creator profile has no name, display
 *     name or handle still gets its widget (the left join); every excluded posting kind (draft, closed, removed, unlisted, superseded, expired, an external posting claimed by the organisation) has its own named case.
 *
 * NOT TESTABLE, AND WHY: a "creator row that does not exist" cannot occur. organizations.created_by is NOT NULL with a foreign key, and profiles.email is NOT NULL, so the only creator shapes that exist are a creator whose
 * first name, last name and display name are null (tested below) and, for the rule itself, all four arguments null (tested below at the function).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { admin, createAuthedTestUser, deleteTestUsers } from "../support/auth";
import { deleteOrgsCascade } from "../support/delete-orgs";

type Authed = Awaited<ReturnType<typeof createAuthedTestUser>>;
const untyped = (c: Authed["client"]) => c as unknown as typeof admin;
const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } }) as unknown as typeof admin;
const tag = randomUUID().slice(0, 6);

let owner: Authed;
let qaOwner: Authed;
let stranger: Authed;
let otherOwner: Authed; // owns a second real organisation: the cross-organisation tests
let nullNamesOwner: Authed; // a creator whose first name, last name and display name are all null
const orgIds: string[] = [];
const o = { main: "", unverified: "", qa: "", qaName: "", disabled: "", capped: "", noRow: "", fresh: "", other: "", otherNoRow: "", nullNames: "" };
let fp = 0;

async function makeOrg(label: string, creator: Authed, verified: boolean): Promise<string> {
  const { data, error } = await admin.from("organizations").insert({ name: `WIDGET-TEST ${label} ${tag}`, created_by: creator.id, verified, logo_url: "https://example.com/logo.png" }).select("id").single();
  if (error || !data) throw new Error(`fixture org ${label}: ${error?.message}`);
  const mem = await admin.from("organization_members").insert({ organization_id: data.id, user_id: creator.id, role: "owner" });
  if (mem.error) throw new Error(`fixture member ${label}: ${mem.error.message}`);
  orgIds.push(data.id);
  return data.id;
}

async function makeJob(orgId: string, title: string, extra: Record<string, unknown> = {}, postedHoursAgo = 1) {
  fp += 1;
  const { error } = await admin.from("job_postings").insert({
    source_type: "internal",
    organization_id: orgId,
    title: `${title} ${tag}`,
    company_name: "Widget Co",
    description: "Fixture.",
    structured_jd: {},
    status: "open",
    location: "Lagos",
    work_type: "remote",
    employment_type: "full_time",
    posted_at: new Date(Date.now() - (postedHoursAgo + fp) * 3_600_000).toISOString(),
    dedup_fingerprint: `widget-${tag}-${fp}`,
    ...extra,
  } as never);
  if (error) throw new Error(`fixture job ${title}: ${error.message}`);
}

async function widget(orgId: string | null) {
  const { data, error } = await admin.rpc("org_job_widget" as never, { p_org_id: orgId } as never);
  expect(error).toBeNull();
  return data as unknown as null | { org: { name: string; logo_url: string | null }; jobs: Array<Record<string, unknown>> };
}
const titles = (w: NonNullable<Awaited<ReturnType<typeof widget>>>) => w.jobs.map((j) => String(j.title).replace(` ${tag}`, ""));

beforeAll(async () => {
  [owner, qaOwner, stranger, otherOwner, nullNamesOwner] = await Promise.all([
    createAuthedTestUser("widget-owner"),
    createAuthedTestUser("widget-qa"),
    createAuthedTestUser("widget-stranger"),
    createAuthedTestUser("widget-other"),
    createAuthedTestUser("widget-nullnames"),
  ]);
  const clearNames = await admin.from("profiles").update({ first_name: null, last_name: null, referral_leaderboard_display_name: null } as never).eq("id", nullNamesOwner.id);
  if (clearNames.error) throw new Error(`fixture null-name creator: ${clearNames.error.message}`);
  const qaTag = await admin.from("profiles").update({ email: `widget+qa-${tag}@example.test` } as never).eq("id", qaOwner.id);
  if (qaTag.error) throw new Error(`fixture QA creator: ${qaTag.error.message}`);

  o.main = await makeOrg("main", owner, true);
  o.unverified = await makeOrg("unverified", owner, false);
  o.qa = await makeOrg("qa", qaOwner, true);
  o.disabled = await makeOrg("disabled", owner, true);
  o.capped = await makeOrg("capped", owner, true);
  o.noRow = await makeOrg("norow", owner, true);
  o.other = await makeOrg("other", otherOwner, true);
  o.otherNoRow = await makeOrg("other-norow", otherOwner, true);
  o.nullNames = await makeOrg("nullnames", nullNamesOwner, true);

  for (const [org, enabled, max] of [[o.main, true, 10], [o.unverified, true, 10], [o.qa, true, 10], [o.disabled, false, 10], [o.capped, true, 2], [o.other, true, 10], [o.nullNames, true, 10]] as const) {
    const { error } = await admin.from("employer_widgets" as never).insert({ organization_id: org, enabled, max_items: max } as never);
    if (error) throw new Error(`fixture widget row: ${error.message}`);
  }

  await makeJob(o.main, "OPEN-A", {}, 1);
  await makeJob(o.main, "OPEN-B", {}, 5);
  await makeJob(o.main, "OPEN-FUTURE", { expires_at: new Date(Date.now() + 86_400_000).toISOString() }, 9);
  await makeJob(o.main, "DRAFT", { status: "draft" });
  await makeJob(o.main, "CLOSED", { status: "closed" });
  await makeJob(o.main, "REMOVED", { status: "removed", removed_at: new Date().toISOString() });
  await makeJob(o.main, "UNLISTED", { unlisted_at: new Date().toISOString() });
  await makeJob(o.main, "SUPERSEDED", { superseded_at: new Date().toISOString() });
  await makeJob(o.main, "EXPIRED", { expires_at: new Date(Date.now() - 3_600_000).toISOString() });
  // an EXTERNAL posting that this organisation has claimed (organization_id stays null for an external row; claimed_by_organization_id carries the claim)
  await makeJob(o.main, "EXTERNAL-CLAIMED", { source_type: "external", organization_id: null, claimed_by_organization_id: o.main, claimed_at: new Date().toISOString(), external_url: "https://example.com/external-job", external_source: "test" });
  await makeJob(o.other, "OTHER-OPEN");
  await makeJob(o.nullNames, "NULLNAMES-OPEN");
  await makeJob(o.unverified, "UNVERIFIED-OPEN");
  await makeJob(o.qa, "QA-OPEN");
  await makeJob(o.disabled, "DISABLED-OPEN");
  await makeJob(o.noRow, "NOROW-OPEN");
  for (let i = 1; i <= 4; i++) await makeJob(o.capped, `CAP-${i}`, {}, i * 24);
}, 360_000);

afterAll(async () => {
  const check = async (p: PromiseLike<{ error: { message: string } | null }>) => {
    const { error } = await p;
    if (error) throw new Error(`cleanup failed: ${error.message}`);
  };
  if (orgIds.length) {
    await check(admin.from("job_postings").delete().in("organization_id", orgIds));
    await check(admin.from("job_postings").delete().in("claimed_by_organization_id", orgIds));
    await deleteOrgsCascade(admin, orgIds);
  }
  await deleteTestUsers([owner, qaOwner, stranger, otherOwner, nullNamesOwner].filter(Boolean).map((u) => u.id));
}, 360_000);

describe("org_job_widget: what it returns", () => {
  it("returns only the open, listed, internal, unexpired postings of the organisation", async () => {
    const w = await widget(o.main);
    expect(w).not.toBeNull();
    expect(titles(w!).sort()).toEqual(["OPEN-A", "OPEN-B", "OPEN-FUTURE"]);
  });

  // One named case per excluded kind. Each first proves the excluded posting EXISTS (service role), so an absence below is a real absence and not an empty fixture.
  it.each([
    ["a draft posting", "DRAFT"],
    ["a closed posting", "CLOSED"],
    ["a removed posting", "REMOVED"],
    ["an unlisted (link-only) posting", "UNLISTED"],
    ["a superseded posting", "SUPERSEDED"],
    ["an expired posting (closing date in the past)", "EXPIRED"],
    ["an EXTERNAL posting that the organisation has claimed", "EXTERNAL-CLAIMED"],
  ])("never shows %s", async (_name, title) => {
    const { data, error } = await admin.from("job_postings").select("id").eq("title", `${title} ${tag}`);
    expect(error).toBeNull();
    expect(data, `the fixture for ${title} exists`).toHaveLength(1);
    const w = (await widget(o.main))!;
    expect(titles(w)).not.toContain(title);
    expect(titles(w).length, "the widget itself is not empty (the open postings are there)").toBeGreaterThan(0);
  });

  it("has EXACTLY the agreed keys and no others", async () => {
    const w = (await widget(o.main))!;
    expect(Object.keys(w).sort()).toEqual(["jobs", "org"]);
    expect(Object.keys(w.org).sort()).toEqual(["logo_url", "name"]);
    expect(w.jobs.length).toBeGreaterThan(0);
    for (const j of w.jobs) expect(Object.keys(j).sort()).toEqual(["employment_type", "id", "location", "posted_at", "title", "work_type"]);
    expect(w.org.name).toBe(`WIDGET-TEST main ${tag}`);
    expect(w.jobs[0].work_type).toBe("remote");
    expect(w.jobs[0].employment_type).toBe("full_time");
  });

  it("lists newest first", async () => {
    const w = (await widget(o.main))!;
    const times = w.jobs.map((j) => Date.parse(String(j.posted_at)));
    for (let i = 1; i < times.length; i++) expect(times[i - 1]).toBeGreaterThanOrEqual(times[i]);
  });

  it("holds the cap and keeps the newest", async () => {
    const w = (await widget(o.capped))!;
    expect(titles(w)).toEqual(["CAP-1", "CAP-2"]);
  });

  it("an enabled organisation with no open postings returns its name and an empty list", async () => {
    const { error } = await admin.from("job_postings").update({ status: "closed" } as never).eq("organization_id", o.capped);
    expect(error).toBeNull();
    try {
      const w = await widget(o.capped);
      expect(w).not.toBeNull();
      expect(w!.jobs).toEqual([]);
      expect(w!.org.name).toBe(`WIDGET-TEST capped ${tag}`);
    } finally {
      await admin.from("job_postings").update({ status: "open" } as never).eq("organization_id", o.capped);
    }
  });

  it("matches the public feed for the organisation after the widget-only rules (anon through row level security)", async () => {
    const { data, error } = await anon.from("job_postings").select("title, status, unlisted_at, expires_at, source_type").eq("organization_id", o.main);
    expect(error).toBeNull();
    const rows = (data ?? []) as unknown as Array<{ title: string; status: string; unlisted_at: string | null; expires_at: string | null; source_type: string }>;
    const feedTitles = rows
      .filter((r) => r.source_type === "internal" && r.status === "open" && !r.unlisted_at && (!r.expires_at || Date.parse(r.expires_at) > Date.now()))
      .map((r) => r.title.replace(` ${tag}`, ""))
      .sort();
    expect(rows.length, "the feed returns rows for this organisation (not an empty comparison)").toBeGreaterThan(3);
    expect(feedTitles).toEqual(titles((await widget(o.main))!).sort());
    const feedAll = rows.map((r) => r.title.replace(` ${tag}`, ""));
    for (const never of ["DRAFT", "REMOVED", "SUPERSEDED"]) expect(feedAll, `the public feed never shows ${never}`).not.toContain(never);
  });
});

describe("org_job_widget: every failed gate answers NULL", () => {
  it.each([
    ["an unverified organisation", () => o.unverified],
    ["a QA-created organisation (the creator's email carries +qa-)", () => o.qa],
    ["a disabled widget", () => o.disabled],
    ["an organisation with no widget row", () => o.noRow],
    ["an unknown organisation", () => randomUUID()],
    ["a null organisation id", () => null],
  ])("%s", async (_name, pick) => {
    expect(await widget(pick())).toBeNull();
  });
});

describe("org_job_widget: the creator-profile gate", () => {
  it("is_qa_account(null, null, null, null) is false (every argument is null-guarded; the function never returns null)", async () => {
    const { data, error } = await admin.rpc("is_qa_account" as never, { p_email: null, p_first: null, p_last: null, p_display: null } as never);
    expect(error).toBeNull();
    expect(data).toBe(false);
  });

  it("an organisation whose creator has no first name, last name or display name still gets its widget (the creator join does not drop it)", async () => {
    const { data } = await admin.from("profiles").select("first_name, last_name, referral_leaderboard_display_name").eq("id", nullNamesOwner.id).single();
    expect(data).toEqual({ first_name: null, last_name: null, referral_leaderboard_display_name: null });
    const w = await widget(o.nullNames);
    expect(w, "not NULL: a null name is not a QA name").not.toBeNull();
    expect(titles(w!)).toEqual(["NULLNAMES-OPEN"]);
  });
  // A creator row that does not exist cannot occur: organizations.created_by is NOT NULL with a foreign key, and profiles.email is NOT NULL (see the header).
});

describe("org_job_widget: who may call it", () => {
  it("is service_role only, SECURITY DEFINER with a pinned search_path (function_acl_audit)", async () => {
    const { data, error } = await admin.rpc("function_acl_audit" as never);
    expect(error).toBeNull();
    const rows = (data as unknown as Array<{ function_name: string; identity_args: string; security_definer: boolean; search_path_config: string | null; anon_exec: boolean; authenticated_exec: boolean; service_role_exec: boolean; public_exec: boolean }>).filter(
      (r) => r.function_name === "org_job_widget",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].identity_args).toBe("p_org_id uuid");
    expect(rows[0].security_definer).toBe(true);
    expect(rows[0].search_path_config).toBe("search_path=public, pg_temp");
    expect({ anon: rows[0].anon_exec, authenticated: rows[0].authenticated_exec, service_role: rows[0].service_role_exec, public: rows[0].public_exec }).toEqual({ anon: false, authenticated: false, service_role: true, public: false });
  });

  it("anon, a member and a signed-in NON-member are all refused when they call it", async () => {
    expect((await anon.rpc("org_job_widget" as never, { p_org_id: o.main } as never)).error?.code).toBe("42501");
    expect((await untyped(owner.client).rpc("org_job_widget" as never, { p_org_id: o.main } as never)).error?.code).toBe("42501");
    expect((await untyped(stranger.client).rpc("org_job_widget" as never, { p_org_id: o.main } as never)).error?.code).toBe("42501");
  });
});

describe("employer_widgets: who may read and change a row", () => {
  it("a member reads their organisation's row; a stranger reads nothing; anon is refused", async () => {
    const mine = await untyped(owner.client).from("employer_widgets" as never).select("organization_id, enabled, max_items, created_at, updated_at").eq("organization_id", o.main);
    expect(mine.error).toBeNull();
    expect(mine.data).toHaveLength(1);
    const theirs = await untyped(stranger.client).from("employer_widgets" as never).select("organization_id").eq("organization_id", o.main);
    expect(theirs.error).toBeNull();
    expect(theirs.data).toEqual([]);
    expect((await anon.from("employer_widgets" as never).select("organization_id")).error?.code).toBe("42501");
  });

  it("a member changes enabled and max_items; the values must stay in range", async () => {
    const ok = await untyped(owner.client).from("employer_widgets" as never).update({ enabled: false, max_items: 5 } as never).eq("organization_id", o.main).select("enabled, max_items");
    expect(ok.error).toBeNull();
    expect(ok.data).toEqual([{ enabled: false, max_items: 5 }]);
    expect((await untyped(owner.client).from("employer_widgets" as never).update({ max_items: 21 } as never).eq("organization_id", o.main)).error?.code).toBe("23514");
    expect((await untyped(owner.client).from("employer_widgets" as never).update({ max_items: 0 } as never).eq("organization_id", o.main)).error?.code).toBe("23514");
    await admin.from("employer_widgets" as never).update({ enabled: true, max_items: 10 } as never).eq("organization_id", o.main);
  });

  it("max_items 20 is accepted and 21 is refused", async () => {
    const ok = await untyped(owner.client).from("employer_widgets" as never).update({ max_items: 20 } as never).eq("organization_id", o.main).select("max_items");
    expect(ok.error).toBeNull();
    expect(ok.data).toEqual([{ max_items: 20 }]);
    expect((await untyped(owner.client).from("employer_widgets" as never).update({ max_items: 21 } as never).eq("organization_id", o.main)).error?.code).toBe("23514");
    await admin.from("employer_widgets" as never).update({ max_items: 10 } as never).eq("organization_id", o.main);
  });

  it("the key and the timestamps are not client-writable (column grants)", async () => {
    for (const patch of [{ organization_id: o.noRow }, { created_at: new Date().toISOString() }, { updated_at: new Date().toISOString() }]) {
      const { error } = await untyped(owner.client).from("employer_widgets" as never).update(patch as never).eq("organization_id", o.main);
      expect(error?.code, JSON.stringify(Object.keys(patch))).toBe("42501");
    }
  });

  it("updated_at is stamped by the trigger when a member changes the row", async () => {
    const before = await admin.from("employer_widgets" as never).select("updated_at").eq("organization_id", o.main).single();
    await new Promise((r) => setTimeout(r, 1100));
    const up = await untyped(owner.client).from("employer_widgets" as never).update({ max_items: 9 } as never).eq("organization_id", o.main);
    expect(up.error).toBeNull();
    const after = await admin.from("employer_widgets" as never).select("updated_at").eq("organization_id", o.main).single();
    expect(Date.parse((after.data as unknown as { updated_at: string }).updated_at)).toBeGreaterThan(Date.parse((before.data as unknown as { updated_at: string }).updated_at));
    await admin.from("employer_widgets" as never).update({ max_items: 10 } as never).eq("organization_id", o.main);
  });

  it("a stranger changes nothing, and nobody deletes through the API", async () => {
    const stray = await untyped(stranger.client).from("employer_widgets" as never).update({ enabled: false } as never).eq("organization_id", o.main).select("organization_id");
    expect(stray.error).toBeNull();
    expect(stray.data).toEqual([]);
    const still = await admin.from("employer_widgets" as never).select("enabled").eq("organization_id", o.main).single();
    expect((still.data as unknown as { enabled: boolean }).enabled).toBe(true);
    expect((await untyped(owner.client).from("employer_widgets" as never).delete().eq("organization_id", o.main)).error?.code).toBe("42501");
  });

  it("a member creates their row (enabled defaults to false, max_items to 10); a stranger cannot create one for someone else's organisation; created_at cannot be set", async () => {
    o.fresh = await makeOrg("fresh", owner, false);
    const created = await untyped(owner.client).from("employer_widgets" as never).insert({ organization_id: o.fresh } as never).select("enabled, max_items");
    expect(created.error).toBeNull();
    expect(created.data).toEqual([{ enabled: false, max_items: 10 }]);
    const refused = await untyped(stranger.client).from("employer_widgets" as never).insert({ organization_id: o.noRow } as never);
    expect(refused.error?.code).toBe("42501");
    expect(refused.error?.message).toMatch(/row-level security/);
    const stamped = await untyped(owner.client).from("employer_widgets" as never).insert({ organization_id: o.noRow, created_at: new Date().toISOString() } as never);
    expect(stamped.error?.code).toBe("42501");
  });

  it("CROSS-ORGANISATION: a member of organisation A cannot read, update or create a row for organisation B, and the reverse (two real organisations, two real owners)", async () => {
    // the fixtures: A = o.main (owner), B = o.other (otherOwner), both with a widget row; o.otherNoRow belongs to B's owner and has NO row
    const readB = await untyped(owner.client).from("employer_widgets" as never).select("organization_id").eq("organization_id", o.other);
    expect(readB.error).toBeNull();
    expect(readB.data, "A's member sees none of B's rows").toEqual([]);
    const readOwn = await untyped(owner.client).from("employer_widgets" as never).select("organization_id");
    expect(readOwn.error).toBeNull();
    expect((readOwn.data as unknown as Array<{ organization_id: string }>).map((r) => r.organization_id)).not.toContain(o.other);

    const updB = await untyped(owner.client).from("employer_widgets" as never).update({ enabled: false, max_items: 1 } as never).eq("organization_id", o.other).select("organization_id");
    expect(updB.error).toBeNull();
    expect(updB.data, "A's member updates zero rows of B").toEqual([]);
    const stillB = await admin.from("employer_widgets" as never).select("enabled, max_items").eq("organization_id", o.other).single();
    expect(stillB.data).toEqual({ enabled: true, max_items: 10 });

    const insB = await untyped(owner.client).from("employer_widgets" as never).insert({ organization_id: o.otherNoRow, enabled: true } as never);
    expect(insB.error?.code, "A's member cannot create a row for B's organisation").toBe("42501");
    expect(insB.error?.message).toMatch(/row-level security/);

    // and the reverse direction
    const readA = await untyped(otherOwner.client).from("employer_widgets" as never).select("organization_id").eq("organization_id", o.main);
    expect(readA.data).toEqual([]);
    const updA = await untyped(otherOwner.client).from("employer_widgets" as never).update({ enabled: false } as never).eq("organization_id", o.main).select("organization_id");
    expect(updA.error).toBeNull();
    expect(updA.data).toEqual([]);
    const stillA = await admin.from("employer_widgets" as never).select("enabled").eq("organization_id", o.main).single();
    expect((stillA.data as unknown as { enabled: boolean }).enabled).toBe(true);
    // each member still reads and changes their OWN row
    expect((await untyped(otherOwner.client).from("employer_widgets" as never).select("organization_id").eq("organization_id", o.other)).data).toHaveLength(1);
  });

  it("a signed-in NON-member sees no widget rows at all, and anon is refused", async () => {
    const mine = await untyped(stranger.client).from("employer_widgets" as never).select("organization_id");
    expect(mine.error).toBeNull();
    expect(mine.data, "a user who belongs to no organisation sees no rows").toEqual([]);
    expect((await anon.from("employer_widgets" as never).select("organization_id")).error?.code).toBe("42501");
  });

  it("deleting the organisation removes its row", async () => {
    const del = await deleteOrgsCascade(admin, [o.fresh]);
    void del;
    const left = await admin.from("employer_widgets" as never).select("organization_id").eq("organization_id", o.fresh);
    expect(left.error).toBeNull();
    expect(left.data).toEqual([]);
    orgIds.splice(orgIds.indexOf(o.fresh), 1);
  });
});
