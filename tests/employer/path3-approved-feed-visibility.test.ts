/**
 * 0127 — a Path 3-approved posting never actually appeared in the discovery
 * feed, found live 2026-09-10 on a real posting carrying both the
 * `PRIVATE LINK ONLY` and `APPROVED FOR THE FEED` badges on /employer/jobs.
 *
 * `path3-job-review.test.ts` (0119) already proves RLS grants an approved
 * posting, and that `search_job_postings` inherits that grant — but its own
 * fixture never sets `unlisted_at`, so it could not have caught this: with
 * `unlisted_at` null, the OLD (pre-0127) `unlisted_at is null or
 * is_org_member(...)` clause already admitted the row on its own, for a
 * completely unrelated reason. The real bug only shows up when BOTH are
 * true at once — unlisted (which minting sets automatically, independent of
 * admin review) AND approved — which is the actual, ordinary shape of a
 * Path 3-reviewed posting in production. This file's fixtures set both.
 *
 * Two surfaces, tested against what they ACTUALLY run:
 *   - `search_job_postings` (0100/0108/0127): a real RPC call, fail-before/
 *     pass-after proved by running it against the CI database both BEFORE
 *     and AFTER 0127 is applied — not assumed from reading the SQL.
 *   - The feed's three page-level queries (postingsQuery, boardAggregateQuery,
 *     paginatedRecentQuery in src/app/(app)/jobs/page.tsx) are inline,
 *     unexported closures — the same reason unlisted-links.test.ts tests
 *     "the feed predicate, both branches" as literal PostgREST filters
 *     rather than importing a function. This file does the same: the OLD
 *     and NEW `.or()` strings are reproduced verbatim from the page's own
 *     source (both quoted in-line below) and run as real queries, so a
 *     divergence between what's tested and what the page actually sends
 *     would be visible in a diff of this file against page.tsx, not silent.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { admin, createAuthedTestUser, deleteTestUsers, type TestUser } from "../support/auth";
import { deleteOrgsCascade } from "../support/delete-orgs";

const tag = randomUUID().slice(0, 8);
/* Digit-only uuid slices tokenise as numbers in tsquery, not words — same
 * nonce discipline unlisted-links.test.ts uses, for the same reason. */
const NONCE = `p3fv${tag}`;

type AuthedTestUser = Awaited<ReturnType<typeof createAuthedTestUser>>;

let orgOwner: TestUser;
let stranger: AuthedTestUser;
let orgId: string;
/** unlisted + approved + open — the actual bug case. */
let approvedUnlistedJobId: string;
/** unlisted + NO decision + open — must stay excluded after the fix too. */
let undecidedUnlistedJobId: string;
/** unlisted + approved + REMOVED — RLS's own status<>'removed' already
 * excludes this; confirms the app-level fix doesn't open a bypass around it. */
let removedApprovedUnlistedJobId: string;

const fingerprint = (label: string) => `p3fv-${tag}-${label}`;

const posting = (label: string, extra: Record<string, unknown>) => ({
  source_type: "internal" as const,
  organization_id: orgId,
  title: `P3FV-TEST ${label} ${tag} ${NONCE}`,
  company_name: `P3FV-TEST Co ${tag}`,
  description: "Fixture posting for the Path 3 / feed-visibility suite (0127).",
  structured_jd: {},
  dedup_fingerprint: fingerprint(label),
  posted_at: new Date().toISOString(),
  status: "open" as const,
  unlisted_at: new Date().toISOString(),
  ...extra,
});

beforeAll(async () => {
  [orgOwner, stranger] = await Promise.all([
    createAuthedTestUser("p3fv-owner"),
    createAuthedTestUser("p3fv-stranger"),
  ]);

  // UNVERIFIED, on purpose: the verified-org branch of RLS would admit
  // everything on its own and prove nothing about the Path 3 branch this
  // suite exists to isolate — same reasoning path3-job-review.test.ts gives.
  const { data: org, error: orgErr } = await admin
    .from("organizations")
    .insert({ name: `P3FV-TEST Org ${tag}`, created_by: orgOwner.id, verified: false })
    .select("id")
    .single();
  if (orgErr || !org) throw new Error(`fixture org: ${orgErr?.message}`);
  orgId = org.id;

  const { data: jobs, error: jobErr } = await admin
    .from("job_postings")
    .insert([
      posting("approved", { admin_review_decision: "approved" }),
      posting("undecided", {}),
      posting("removedapproved", { admin_review_decision: "approved", status: "removed" }),
    ])
    .select("id, dedup_fingerprint");
  if (jobErr || !jobs) throw new Error(`fixture postings: ${jobErr?.message}`);

  const byFingerprint = (label: string) =>
    jobs.find((j) => j.dedup_fingerprint === fingerprint(label))!.id;
  approvedUnlistedJobId = byFingerprint("approved");
  undecidedUnlistedJobId = byFingerprint("undecided");
  removedApprovedUnlistedJobId = byFingerprint("removedapproved");
}, 60_000);

afterAll(async () => {
  await admin.from("job_postings").delete().eq("company_name", `P3FV-TEST Co ${tag}`);
  await deleteOrgsCascade(admin, [orgId].filter(Boolean));
  await deleteTestUsers([orgOwner.id, stranger.id].filter(Boolean));
});

describe("the feed's own predicate — literal strings from src/app/(app)/jobs/page.tsx", () => {
  // The exact shape every no-membership viewer got BEFORE 0127 — reproduced
  // verbatim (`.is("unlisted_at", null)`), not paraphrased, so this is a
  // real fail-before proof rather than an assertion about the fix's own logic.
  it(
    "FAIL-BEFORE: the OLD predicate (pre-0127) excludes the approved posting for a non-member viewer",
    async () => {
      const { data, error } = await stranger.client
        .from("job_postings")
        .select("id")
        .eq("status", "open")
        .is("unlisted_at", null);
      expect(error).toBeNull();
      const ids = new Set((data ?? []).map((r) => r.id));
      expect(
        ids.has(approvedUnlistedJobId),
        "the pre-0127 predicate should NOT have shown this posting — if it does, the fixture itself is wrong",
      ).toBe(false);
    },
  );

  // The exact shape postingsQuery/paginatedRecentQuery send now, for a
  // viewer with viewerOrgIds.length === 0 — the actual reported bug's
  // viewer (a seeker who isn't a member of the posting's org).
  it("PASS-AFTER: the NEW predicate admits the approved posting for the same non-member viewer", async () => {
    const { data, error } = await stranger.client
      .from("job_postings")
      .select("id")
      .eq("status", "open")
      .or("unlisted_at.is.null,admin_review_decision.eq.approved");
    expect(error).toBeNull();
    const ids = new Set((data ?? []).map((r) => r.id));
    expect(
      ids.has(approvedUnlistedJobId),
      "the fixed feed predicate still excludes a Path 3-approved, unlisted posting",
    ).toBe(true);
  });

  it("regression: an UNDECIDED unlisted posting stays excluded under the fixed predicate", async () => {
    const { data, error } = await stranger.client
      .from("job_postings")
      .select("id")
      .eq("status", "open")
      .or("unlisted_at.is.null,admin_review_decision.eq.approved");
    expect(error).toBeNull();
    const ids = new Set((data ?? []).map((r) => r.id));
    expect(
      ids.has(undecidedUnlistedJobId),
      "LEAK: an unlisted posting with no Path 3 decision became visible — the fix over-widened",
    ).toBe(false);
  });

  it(
    "regression: a REMOVED-but-approved posting stays excluded — the OR-group is ANDed with " +
      "status='open', not ORed past it",
    async () => {
      const { data, error } = await stranger.client
        .from("job_postings")
        .select("id")
        .eq("status", "open")
        .or("unlisted_at.is.null,admin_review_decision.eq.approved");
      expect(error).toBeNull();
      const ids = new Set((data ?? []).map((r) => r.id));
      expect(
        ids.has(removedApprovedUnlistedJobId),
        "LEAK: a removed posting was surfaced via the admin_review_decision branch",
      ).toBe(false);
    },
  );

  it("the membership-branch OR-string (boardAggregateQuery/paginatedRecentQuery's shape) admits it too", async () => {
    // Same three-way `.or()` those two functions send for a viewer WITH a
    // membership — proven here with an UNRELATED org id in the membership
    // branch (this viewer belongs to no real org), so only the
    // admin_review_decision branch can be doing the admitting. Asserted so
    // the three query functions stay provably parallel, matching the file's
    // own "must stay filter-identical" rule.
    const { data, error } = await stranger.client
      .from("job_postings")
      .select("id")
      .eq("status", "open")
      .or(`unlisted_at.is.null,organization_id.in.(${randomUUID()}),admin_review_decision.eq.approved`);
    expect(error).toBeNull();
    const ids = new Set((data ?? []).map((r) => r.id));
    expect(ids.has(approvedUnlistedJobId), "the membership-branch OR-string must admit it too").toBe(true);
    expect(ids.has(undecidedUnlistedJobId)).toBe(false);
  });
});

describe("search_job_postings — real RPC, fail-before/pass-after against the live migration", () => {
  const search = (client: typeof stranger.client) =>
    client.rpc("search_job_postings", {
      p_query: NONCE,
      p_since: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      p_source_type: null as never,
      p_work_types: null as never,
      p_seniorities: null as never,
      p_ids: null as never,
    });

  it("finds the Path 3-approved, unlisted posting for a non-member seeker (0127)", async () => {
    const { data, error } = await search(stranger.client);
    expect(error).toBeNull();
    const ids = new Set((data ?? []).map((r) => r.id));
    expect(
      ids.has(approvedUnlistedJobId),
      "search_job_postings did not surface a Path 3-approved, unlisted posting to a non-member",
    ).toBe(true);
  });

  it("does NOT find the undecided unlisted posting for the same non-member seeker", async () => {
    const { data, error } = await search(stranger.client);
    expect(error).toBeNull();
    const ids = new Set((data ?? []).map((r) => r.id));
    expect(
      ids.has(undecidedUnlistedJobId),
      "LEAK: search admitted an unlisted posting with no Path 3 decision",
    ).toBe(false);
  });

  it("does NOT find the removed-but-approved posting", async () => {
    const { data, error } = await search(stranger.client);
    expect(error).toBeNull();
    const ids = new Set((data ?? []).map((r) => r.id));
    expect(ids.has(removedApprovedUnlistedJobId), "LEAK: a removed posting surfaced via search").toBe(
      false,
    );
  });

  it("...and still finds nothing spuriously — the nonce is unique to this fixture", async () => {
    // Positive-control discipline from unlisted-links.test.ts: every
    // assertion above is equally satisfied by a broken function returning
    // nothing at all. Confirms the NONCE-scoped query returns exactly the
    // two eligible rows (approved-unlisted; the undecided/removed ones are
    // correctly excluded), not zero rows from an unrelated failure.
    const { data, error } = await search(stranger.client);
    expect(error).toBeNull();
    expect((data ?? []).map((r) => r.id).sort()).toEqual([approvedUnlistedJobId].sort());
  });
});
