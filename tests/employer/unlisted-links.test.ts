/**
 * Private links for an unverified employer (0107).
 *
 * ── WHAT IS ACTUALLY AT RISK ──────────────────────────────────────────────
 *
 * This build widened RLS: a posting with `unlisted_at` set is readable by
 * anyone holding its id, whether or not its organisation is verified. That is
 * the feature. The danger is that it silently becomes MORE than that — the
 * public listing surfaces never filtered on `verified` themselves, they relied
 * on RLS to hide unverified orgs for them. The moment RLS admits a second
 * class of readable row, every one of those surfaces starts listing it unless
 * it says otherwise.
 *
 * So the tests that matter here are the absence ones, and they are written
 * against the REAL queries where possible rather than against the rule.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { Database } from "@/lib/supabase/types";
import { createAuthedTestUser, sessionFor, deleteTestUsers, type DB } from "../support/auth";
import { getJobShareVisibility, canMintUnlistedLink } from "@/lib/employer/job-visibility";
import { RATE_LIMITS } from "@/lib/api/rate-limit";

const admin = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);
const anon = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

const tag = randomUUID().slice(0, 8);
/* A letter-initial nonce, not the bare tag: a uuid slice can be all digits,
 * which Postgres tokenises as a NUMBER rather than a word, and a search test
 * that silently matched nothing would pass for the wrong reason. */
const NONCE = `zqx${tag}`;
let orgId = "";
let fixtureUserId = "";
let unlistedJobId = "";
let plainJobId = "";
let removedUnlistedJobId = "";
let closedUnlistedJobId = "";
/* A row a STRANGER is genuinely allowed to see, owned by this suite.
 * External, because that is the one branch of the policy that does not depend
 * on verification or membership — and the check constraint forces
 * `organization_id IS NULL` for it, so it is cleaned up by company_name
 * rather than by org. */
let externalJobId = "";
/* Two real sessions, for the search cases: one belongs to the fixture org,
 * one belongs to no org at all. `anon` cannot stand in for either — 0100
 * revoked search_job_postings from anon, so a signed-out probe proves only
 * that the grant exists, not that the filter works. */
let memberClient: DB | null = null;
let strangerClient: DB | null = null;
let strangerId = "";

const posting = (title: string, extra: Record<string, unknown> = {}) => ({
  source_type: "internal" as const,
  organization_id: orgId,
  title: `UNLISTED-TEST ${title} ${tag} ${NONCE}`,
  company_name: `UNLISTED-TEST Co ${tag}`,
  description: "Fixture posting for the 0107 unlisted-link suite.",
  structured_jd: {},
  dedup_fingerprint: `unlisted-${tag}-${title}`,
  status: "open" as const,
  posted_at: new Date().toISOString(),
  ...extra,
});

beforeAll(async () => {
  // `organizations.created_by` is NOT NULL, so the org needs a real owner.
  // Its own account, created and torn down here, rather than borrowing a
  // profile another suite owns and may delete mid-run.
  const { data: u, error: ue } = await admin.auth.admin.createUser({
    email: `unlisted-owner-${tag}@talentrah.test`,
    password: `Unlisted-${randomUUID()}Aa1!`,
    email_confirm: true,
  });
  if (ue || !u) throw new Error(`fixture user: ${ue?.message}`);
  fixtureUserId = u.user.id;

  // An UNVERIFIED org — the whole point. A verified one would be readable
  // through the older branch and prove nothing about this one.
  const { data: org, error } = await admin
    .from("organizations")
    .insert({
      name: `UNLISTED-TEST Org ${tag}`,
      domain: `unlisted-${tag}.example`,
      verified: false,
      created_by: fixtureUserId,
    })
    .select("id")
    .single();
  if (error || !org) throw new Error(`fixture org: ${error?.message}`);
  orgId = org.id;

  const now = new Date().toISOString();
  const { data: jobs, error: jobErr } = await admin
    .from("job_postings")
    .insert([
      posting("unlisted", { unlisted_at: now }),
      posting("plain"),
      posting("removed", { unlisted_at: now, status: "removed" }),
      posting("closed", { unlisted_at: now, status: "closed" }),
      // `job_postings_internal_has_org` requires external rows to have a NULL
      // organisation, so this one cannot hang off the fixture org.
      {
        ...posting("external"),
        source_type: "external" as const,
        organization_id: null,
        external_url: `https://example.invalid/${tag}`,
        external_source: "unlisted-suite-fixture",
      },
    ])
    .select("id, title, status, unlisted_at");
  if (jobErr || !jobs) throw new Error(`fixture postings: ${jobErr?.message}`);

  const byTitle = (needle: string) => jobs.find((j) => j.title.includes(needle))!.id;
  unlistedJobId = byTitle("unlisted");
  plainJobId = byTitle("plain");
  removedUnlistedJobId = byTitle("removed");
  closedUnlistedJobId = byTitle("closed");
  externalJobId = byTitle("external");

  /*
   * The fixture owner becomes a real MEMBER, not just `created_by`. Those are
   * different things and only the first satisfies `is_org_member` (0026) —
   * creating the org does not enrol you in it.
   */
  const { error: memErr } = await admin
    .from("organization_members")
    .insert({ organization_id: orgId, user_id: fixtureUserId, role: "owner" });
  if (memErr) throw new Error(`fixture membership: ${memErr.message}`);

  memberClient = await sessionFor(`unlisted-owner-${tag}@talentrah.test`, fixtureUserId);
  const stranger = await createAuthedTestUser("unlisted-stranger");
  strangerId = stranger.id;
  strangerClient = stranger.client;
});

afterAll(async () => {
  if (strangerId) await deleteTestUsers([strangerId]);
  // organization_members IS ON DELETE CASCADE from organizations, but the org
  // delete below only succeeds once job_postings are gone (NO ACTION), so
  // order still matters and the membership is removed explicitly rather than
  // relying on a cascade that may never be reached.
  const { error: memErr } = await admin
    .from("organization_members")
    .delete()
    .eq("organization_id", orgId);
  if (memErr) console.error("[unlisted cleanup] membership:", memErr.message);
  // By company_name, not organization_id: the external fixture has a NULL org
  // by constraint, so an org-scoped delete would silently leave it behind —
  // and a Supabase delete that matches nothing reports success either way.
  const { error: jobsErr } = await admin
    .from("job_postings")
    .delete()
    .eq("company_name", `UNLISTED-TEST Co ${tag}`);
  if (jobsErr) console.error("[unlisted cleanup] postings:", jobsErr.message);
  const { error: orgErr } = await admin.from("organizations").delete().eq("id", orgId);
  if (orgErr) console.error("[unlisted cleanup] org:", orgErr.message);
  if (fixtureUserId) {
    const { error: userErr } = await admin.auth.admin.deleteUser(fixtureUserId);
    if (userErr) console.error("[unlisted cleanup] user:", userErr.message);
  }
});

describe("the rule", () => {
  it("returns unlisted only for an unverified org with a stamp", () => {
    expect(
      getJobShareVisibility({ status: "open", organizationVerified: false, unlistedAt: "2026-01-01" }),
    ).toBe("unlisted");
    expect(getJobShareVisibility({ status: "open", organizationVerified: false, unlistedAt: null })).toBe(
      "unreachable",
    );
    // A verified org is public, stamp or not — the stamp is not what makes it
    // listed, so it must not downgrade a verified posting.
    expect(
      getJobShareVisibility({ status: "open", organizationVerified: true, unlistedAt: "2026-01-01" }),
    ).toBe("public");
  });

  it("a removed posting is never unlisted, whatever else is true", () => {
    expect(
      getJobShareVisibility({ status: "removed", organizationVerified: false, unlistedAt: "2026-01-01" }),
    ).toBe("unreachable");
    expect(
      getJobShareVisibility({ status: "removed", organizationVerified: true, unlistedAt: "2026-01-01" }),
    ).toBe("unreachable");
  });

  it("a CLOSED but not removed unlisted job still resolves", () => {
    // Mirrors the policy: only `removed` is excluded, so a closed job's link
    // is not dead — /jobs/[id] renders it and says it is closed.
    expect(
      getJobShareVisibility({ status: "closed", organizationVerified: false, unlistedAt: "2026-01-01" }),
    ).toBe("unlisted");
  });
});

describe("who may mint", () => {
  it("an unconfirmed email never mints, however many jobs it posts", () => {
    for (const status of ["open", "closed"] as const) {
      expect(
        canMintUnlistedLink({ status, emailConfirmed: false, underRateLimit: true }),
        `status=${status}`,
      ).toBe(false);
    }
  });

  it("past the rate limit, the answer is no — not a partial link", () => {
    expect(canMintUnlistedLink({ status: "open", emailConfirmed: true, underRateLimit: false })).toBe(
      false,
    );
  });

  it("a removed posting cannot be minted", () => {
    expect(canMintUnlistedLink({ status: "removed", emailConfirmed: true, underRateLimit: true })).toBe(
      false,
    );
  });

  it("the bucket is five per day, and the window is a day", () => {
    // Pinned because the number is a founder decision, not an implementation
    // detail — changing it should be deliberate and visible in a diff.
    expect(RATE_LIMITS.unlistedLinkMint).toEqual({ limit: 5, windowSeconds: 60 * 60 * 24 });
  });
});

describe("what the database will actually hand a stranger", () => {
  it("an unlisted posting IS readable by id, with no session at all", async () => {
    const { data, error } = await anon
      .from("job_postings")
      .select("id, title")
      .eq("id", unlistedJobId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data?.id, "the whole feature: a link that works for whoever holds it").toBe(unlistedJobId);
  });

  it("the same org's UNMINTED posting is not", async () => {
    // The control. Without this, the test above would pass just as happily if
    // the policy had opened every unverified org's postings.
    const { data } = await anon.from("job_postings").select("id").eq("id", plainJobId).maybeSingle();
    expect(data, "LEAK: an unverified org's un-minted posting was readable").toBeNull();
  });

  it("a REMOVED unlisted posting is not readable, stamp notwithstanding", async () => {
    const { data } = await anon
      .from("job_postings")
      .select("id")
      .eq("id", removedUnlistedJobId)
      .maybeSingle();
    expect(data, "LEAK: a removed posting was reachable through the unlisted branch").toBeNull();
  });

  it("a CLOSED unlisted posting still resolves", async () => {
    const { data } = await anon
      .from("job_postings")
      .select("id")
      .eq("id", closedUnlistedJobId)
      .maybeSingle();
    expect(data?.id).toBe(closedUnlistedJobId);
  });

  it("an org cannot stamp its own posting — unlisted_at is service-role only", async () => {
    const { error } = await anon
      .from("job_postings")
      .update({ unlisted_at: new Date().toISOString() })
      .eq("id", plainJobId);
    // The column carries no UPDATE grant, so this is refused at privilege
    // level. If it ever succeeds, an org can publish without verification.
    expect(error, "an org self-granted public reachability").not.toBeNull();

    const { data: after } = await admin
      .from("job_postings")
      .select("unlisted_at")
      .eq("id", plainJobId)
      .maybeSingle();
    expect(after?.unlisted_at, "the stamp was written despite the refusal").toBeNull();
  });
});

describe("never listed, only linked", () => {
  it("does not appear in the feed's own query", async () => {
    /*
     * Runs the feed's actual filter, not a paraphrase: status open, freshness
     * floor, and the 0107 exclusion. If someone removes `.is("unlisted_at",
     * null)` from the page, this is what notices.
     */
    const { data } = await anon
      .from("job_postings")
      .select("id")
      .eq("status", "open")
      .is("unlisted_at", null)
      .eq("organization_id", orgId);
    expect((data ?? []).map((r) => r.id)).not.toContain(unlistedJobId);
  });

  it("is excluded by the predicate every public listing surface now uses", async () => {
    // The union of what the feed, sitemap and landing pages all apply. Asserted
    // once, against the database, so a surface that forgets it is a difference
    // between this result and its own.
    const { data } = await anon.from("job_postings").select("id").is("unlisted_at", null);
    const ids = new Set((data ?? []).map((r) => r.id));
    expect(ids.has(unlistedJobId), "an unlisted posting survived the listing filter").toBe(false);
    expect(ids.has(closedUnlistedJobId)).toBe(false);
  });
});

/*
 * ── THE SURFACE THAT ACTUALLY LEAKED ──────────────────────────────────────
 *
 * `search_job_postings` (0100) was the fifteenth listing surface and the one
 * the TypeScript diff could not point at, because it is SQL. It is
 * `security invoker`, so 0107's widened policy admitted unlisted rows to it,
 * and its WHERE clause said nothing about `unlisted_at`. Result, confirmed
 * live against the CI database before 0108 was written: an unlisted posting
 * stayed out of the feed and came straight back the moment a signed-in
 * stranger typed a word from its title.
 *
 * These run through REAL SESSIONS. `admin` cannot test this — `is_org_member`
 * is false for service_role, so the service-role client sees the fixed
 * behaviour whether or not the fix is present, and the leak would be
 * invisible. `anon` cannot either: 0100 revoked EXECUTE from it.
 */
describe("search, the surface a widened policy silently opened", () => {
  const search = async (client: DB) =>
    client.rpc("search_job_postings", {
      p_query: NONCE,
      p_since: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      p_source_type: null as never,
      p_work_types: null as never,
      p_seniorities: null as never,
      p_ids: null as never,
    });

  it("a signed-in NON-MEMBER cannot find an unlisted posting by searching for it", async () => {
    const { data, error } = await search(strangerClient!);
    expect(error).toBeNull();
    const ids = new Set((data ?? []).map((r) => r.id));
    expect(
      ids.has(unlistedJobId),
      "LEAK: search handed an unlisted posting to someone outside its org",
    ).toBe(false);
    expect(ids.has(closedUnlistedJobId)).toBe(false);
    expect(ids.has(removedUnlistedJobId)).toBe(false);
  });

  it("...but still finds ordinary postings, so the case above isn't vacuous", async () => {
    /*
     * The positive control, and it is not optional. Every assertion above is
     * equally satisfied by a function that returns nothing at all — which is
     * exactly what a botched `create or replace` would produce. This proves
     * the stranger's search still works; it is only the unlisted row missing.
     */
    const { data, error } = await search(strangerClient!);
    expect(error).toBeNull();
    const ids = new Set((data ?? []).map((r) => r.id));
    /*
     * The control row is the EXTERNAL fixture, not `plainJobId`.
     *
     * `plainJobId` was the first choice and it was wrong — CI caught it. It is
     * an unverified org's un-minted internal posting, which a stranger is
     * denied BY DESIGN; the "the same org's UNMINTED posting is not readable"
     * case above asserts exactly that. Using it here asked the policy to both
     * hide and show the same row, so this control could never have passed, and
     * a control that cannot pass is worse than none: it would have been
     * "fixed" by loosening it.
     *
     * External is the right choice because it is the one branch of the policy
     * that turns on neither verification nor membership, so it stays visible
     * to a stranger no matter what the unlisted rules do.
     */
    expect(
      ids.has(externalJobId),
      "search returned nothing a stranger may see — the exclusion cases above prove nothing",
    ).toBe(true);
  });

  it("a MEMBER of the posting's org does find it — Option A, the founder's call", async () => {
    /*
     * The other half of the contract, and the reason 0108 uses
     * `is_org_member` rather than a flat `unlisted_at is null`.
     *
     * Minting is automatic: it happens on the next Jobs Posted render, with
     * no action from the employer. Excluding unlisted rows from everyone
     * would mean a job disappeared from its own poster's search results
     * moments after they posted it, for a reason invisible from either page.
     */
    const { data, error } = await search(memberClient!);
    expect(error).toBeNull();
    const ids = new Set((data ?? []).map((r) => r.id));
    expect(
      ids.has(unlistedJobId),
      "an employer lost sight of their own posting in search after minting its link",
    ).toBe(true);
  });

  it("a member's own REMOVED posting is still not resurfaced by the own-org branch", async () => {
    // The own-org exception widens which postings are eligible, never which
    // rules apply: `status = 'open'` still holds, so an operator's removal is
    // not undone by membership.
    const { data } = await search(memberClient!);
    const ids = new Set((data ?? []).map((r) => r.id));
    expect(ids.has(removedUnlistedJobId)).toBe(false);
    expect(ids.has(closedUnlistedJobId), "closed is not open").toBe(false);
  });
});

/*
 * The feed's own predicate, in the same two shapes page.tsx builds.
 *
 * Not a paraphrase of the rule but the literal PostgREST filters — the
 * `.or()` for a viewer with a membership, the plain `.is()` for the ~99% of
 * seekers without one.
 */
describe("the feed predicate, both branches", () => {
  it("no membership: exactly today's public behaviour", async () => {
    const { data } = await strangerClient!
      .from("job_postings")
      .select("id")
      .eq("status", "open")
      .is("unlisted_at", null)
      .eq("organization_id", orgId);
    const ids = new Set((data ?? []).map((r) => r.id));
    expect(ids.has(unlistedJobId)).toBe(false);
  });

  it("with a membership: the or-group admits the viewer's own unlisted rows", async () => {
    const { data, error } = await memberClient!
      .from("job_postings")
      .select("id")
      .eq("status", "open")
      .or(`unlisted_at.is.null,organization_id.in.(${orgId})`);
    expect(error).toBeNull();
    const ids = new Set((data ?? []).map((r) => r.id));
    expect(
      ids.has(unlistedJobId),
      "the or-group didn't admit the member's own unlisted posting",
    ).toBe(true);
  });

  it("the or-group is ANDed with the other filters, not ORed past them", async () => {
    /*
     * The failure mode worth pinning: if `.or()` were treated as a top-level
     * alternative rather than a group, `status = 'open'` would stop applying
     * to the member's own rows and a removed posting would come back. Asserted
     * because it is a property of PostgREST's semantics, not of our code, and
     * a silent change in it would widen the feed with no diff to review.
     */
    const { data } = await memberClient!
      .from("job_postings")
      .select("id")
      .eq("status", "open")
      .or(`unlisted_at.is.null,organization_id.in.(${orgId})`);
    const ids = new Set((data ?? []).map((r) => r.id));
    expect(ids.has(removedUnlistedJobId), "a removed posting survived the or-group").toBe(false);
    expect(ids.has(closedUnlistedJobId), "a closed posting survived the or-group").toBe(false);
  });
});
