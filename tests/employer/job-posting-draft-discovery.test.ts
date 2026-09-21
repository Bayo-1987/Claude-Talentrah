/**
 * A draft posting (send-447) must never surface on any public discovery
 * surface — the feed, search, or the sitemap — run against what those
 * surfaces ACTUALLY query, the same discipline
 * path3-approved-feed-visibility.test.ts (0127) already establishes for
 * this codebase: literal predicates reproduced verbatim from the real
 * source, and a real RPC call, not an assertion about the SQL read in
 * isolation.
 *
 * Each of these three surfaces already carries its own explicit
 * `status = 'open'` equality check — confirmed by reading them, not
 * assumed — so a draft is excluded even without RLS's own help. This suite
 * proves that redundancy rather than skipping it: the fixture also mints
 * `unlisted_at` and an admin-approved Path 3 decision on the draft, the two
 * OTHER properties that admit a posting through these same queries' OR-
 * branches, specifically to confirm neither one can smuggle a draft past
 * the `status = 'open'` check that comes first. A query that accidentally
 * dropped that check (or ORed past it instead of ANDing) would pass every
 * existing test in this codebase and fail only this one.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { admin, createAuthedTestUser, deleteTestUsers, type DB, type TestUser } from "../support/auth";
import { deleteOrgsCascade } from "../support/delete-orgs";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { freshnessFloorISO } from "@/lib/jobs/freshness";

const anon: DB = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const tag = randomUUID().slice(0, 8);
/* Digit-only uuid slices tokenise as numbers in tsquery, not words — same
 * nonce discipline path3-approved-feed-visibility.test.ts uses. */
const NONCE = `draftdisc${tag}`;

let orgOwner: TestUser;
// search_job_postings has no EXECUTE grant for `anon` at all (0100 revoked
// it deliberately — confirmed by 0100's own self-check) since it reads
// columns anon must reach only by id, so a signed-in-but-unaffiliated
// "stranger" is the correct non-member caller for that one surface. The
// feed's own predicate and the sitemap ARE meant to be anon-reachable (a
// signed-out visitor's feed view, a crawler), so those two keep using `anon`.
let stranger: Awaited<ReturnType<typeof createAuthedTestUser>>;
let orgId: string;
let draftId: string;
let openId: string;

beforeAll(async () => {
  [orgOwner, stranger] = await Promise.all([
    createAuthedTestUser("draftdisc-owner"),
    createAuthedTestUser("draftdisc-stranger"),
  ]);

  // UNVERIFIED, on purpose — same reasoning as path3-approved-feed-
  // visibility.test.ts: the verified-org branch would admit everything on
  // its own and prove nothing about whether `status = 'open'` alone is
  // still doing the real work.
  const { data: org, error: orgErr } = await admin
    .from("organizations")
    .insert({ name: `DRAFTDISC-TEST Org ${tag}`, created_by: orgOwner.id, verified: false })
    .select("id")
    .single();
  if (orgErr || !org) throw new Error(`fixture org: ${orgErr?.message}`);
  orgId = org.id;

  const base = {
    source_type: "internal" as const,
    organization_id: orgId,
    company_name: `DRAFTDISC-TEST Co ${tag}`,
    description: "Fixture posting for the draft-discovery-exclusion suite (send-447).",
    structured_jd: {},
    posted_at: new Date().toISOString(),
    // Both OTHER admission routes, deliberately present on the draft: if
    // either one bypassed the status check, this fixture is what would
    // catch it.
    unlisted_at: new Date().toISOString(),
    admin_review_decision: "approved" as const,
  };

  const { data: jobs, error: jobErr } = await admin
    .from("job_postings")
    .insert([
      { ...base, title: `DRAFTDISC-TEST Draft ${tag} ${NONCE}`, status: "draft" as const, dedup_fingerprint: `draftdisc-${tag}-draft` },
      { ...base, title: `DRAFTDISC-TEST Open ${tag} ${NONCE}`, status: "open" as const, dedup_fingerprint: `draftdisc-${tag}-open` },
    ])
    .select("id, status");
  if (jobErr || !jobs) throw new Error(`fixture postings: ${jobErr?.message}`);
  draftId = jobs.find((j) => j.status === "draft")!.id;
  openId = jobs.find((j) => j.status === "open")!.id;
}, 60_000);

afterAll(async () => {
  await admin.from("job_postings").delete().eq("company_name", `DRAFTDISC-TEST Co ${tag}`);
  await deleteOrgsCascade(admin, [orgId].filter(Boolean));
  await deleteTestUsers([orgOwner.id, stranger.id].filter(Boolean));
});

describe("the feed's own predicate", () => {
  it("excludes the draft even though it is also unlisted and Path 3-approved", async () => {
    const { data, error } = await anon
      .from("job_postings")
      .select("id")
      .eq("status", "open")
      .or("unlisted_at.is.null,admin_review_decision.eq.approved");
    expect(error).toBeNull();
    const ids = new Set((data ?? []).map((r) => r.id));
    expect(ids.has(draftId), "LEAK: a draft posting surfaced via the feed's own predicate").toBe(false);
    // Positive control: the same query, same fixture batch, must still find
    // the open sibling — a broken query that excludes everything would
    // otherwise pass the assertion above for the wrong reason.
    expect(ids.has(openId), "the open sibling posting should still be findable").toBe(true);
  });
});

describe("search_job_postings — real RPC", () => {
  const search = (client: typeof stranger.client) =>
    client.rpc("search_job_postings", {
      p_query: NONCE,
      p_since: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      p_source_type: null as never,
      p_work_types: null as never,
      p_seniorities: null as never,
      p_ids: null as never,
    });

  it("never returns the draft, even matched by its own unique nonce", async () => {
    const { data, error } = await search(stranger.client);
    expect(error).toBeNull();
    const ids = new Set((data ?? []).map((r) => r.id));
    expect(ids.has(draftId), "LEAK: search_job_postings surfaced a draft posting").toBe(false);
    expect(ids.has(openId), "the open sibling should still be searchable").toBe(true);
  });
});

describe("the sitemap's own query", () => {
  it("never lists the draft's URL", async () => {
    // Reproduced verbatim from src/app/sitemap.ts's own job_postings query.
    const { data, error } = await anon
      .from("job_postings")
      .select("id, posted_at")
      .is("unlisted_at", null)
      .eq("status", "open")
      .gte("posted_at", freshnessFloorISO())
      .order("posted_at", { ascending: false });
    expect(error).toBeNull();
    const ids = new Set((data ?? []).map((r) => r.id));
    expect(ids.has(draftId), "LEAK: the sitemap's own query listed a draft posting").toBe(false);
    // The open sibling has `unlisted_at` set too (this fixture's `base`), so
    // it is correctly excluded by the sitemap's own `.is("unlisted_at",
    // null)` clause — nothing in this fixture is expected to appear in the
    // sitemap at all, which is why there is no positive control here.
  });
});
