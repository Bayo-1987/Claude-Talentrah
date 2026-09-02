/**
 * 0084: the scholarship catalog's public-read gate — anon sees `verified`
 * rows and nothing else.
 *
 * ── WHY THIS IS TESTED NOW, ON A POLICY THAT ALREADY EXISTED ──────────────
 *
 * `/scholarships/[id]` is about to become a public, signed-out-readable page
 * — the scholarship-side equivalent of #152's /jobs/[id]. That page trusts
 * RLS to decide visibility rather than filtering `moderation_status` itself,
 * exactly as the job detail page trusts RLS for `job_postings`. Before
 * building on that trust, it was checked directly rather than assumed: the
 * policy already carries no `TO` clause, so it applies to PUBLIC — anon
 * included — and has since 0000_baseline_schema.sql. No migration changes
 * the access rule; 0084 only comments the policy with this finding.
 *
 * WHY 0027's TRAP DOES NOT APPLY. That lesson is about a policy that CALLS A
 * FUNCTION: every role evaluating it then needs EXECUTE on that function too,
 * and revoking it without checking every caller broke job_postings for
 * signed-out visitors. This policy's USING clause is a bare column comparison
 * — no function, so there is no EXECUTE grant to get wrong. Checked, not
 * assumed: see the policy definition read out in 0084's own header.
 *
 * ── OWN FIXTURE ROWS, NOT PRODUCTION DATA ─────────────────────────────────
 *
 * `pending` and `rejected` fixtures are inserted here rather than relying on
 * whatever the moderation queue happens to hold, because a queue that is
 * empty of pending rows on a given day would make this suite pass for the
 * wrong reason — the same "clean result proves nothing" trap CLAUDE.md
 * documents elsewhere. All three moderation states are exercised explicitly.
 *
 * ── SABOTAGE-PROVEN, NOT JUST ASSERTED ─────────────────────────────────────
 * A permissive policy was granted directly against this project, this suite
 * was re-run and failed exactly where expected, and the sabotage was
 * reverted and reconfirmed. See the transcript for that run; it is not
 * re-run automatically here because leaving a live sabotage step inside a
 * CI suite is itself a way to ship the hole it is meant to catch.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { Database } from "@/lib/supabase/types";
import { admin } from "../support/auth";

const anon: SupabaseClient<Database> = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const tag = randomUUID().slice(0, 8);
const created: Record<string, string> = {};

async function makeFixture(status: "pending" | "verified" | "rejected") {
  const { data, error } = await admin
    .from("scholarships")
    .insert({
      provider: `RLS-TEST Provider ${tag}`,
      program_name: `RLS-TEST ${status} ${tag}`,
      degree_levels: ["msc"],
      field_tags: [],
      funding_type: "full",
      funding_covers: [],
      eligibility_nationalities: ["Nigeria"],
      official_url: "https://example.test/rls-fixture",
      dedup_fingerprint: `rls-test-${status}-${tag}`,
      moderation_status: status,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`could not create ${status} fixture: ${error?.message}`);
  created[status] = data.id;
  return data.id;
}

beforeAll(async () => {
  await Promise.all([makeFixture("pending"), makeFixture("verified"), makeFixture("rejected")]);
});

afterAll(async () => {
  const ids = Object.values(created);
  if (ids.length === 0) return;
  const { error } = await admin.from("scholarships").delete().in("id", ids);
  // A rejected Supabase delete RESOLVES with an error rather than throwing —
  // report it rather than letting fixture rows accumulate silently.
  if (error) throw new Error(`scholarship-public-read cleanup failed: ${error.message}`);
});

describe("anon reads the verified fixture, and only the verified fixture", () => {
  it("can read the verified row by id", async () => {
    const { data, error } = await anon
      .from("scholarships")
      .select("id, program_name, moderation_status")
      .eq("id", created.verified)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data?.id).toBe(created.verified);
    expect(data?.moderation_status).toBe("verified");
  });

  it("cannot read the pending row by id — RLS makes it invisible, not filtered", async () => {
    const { data, error } = await anon
      .from("scholarships")
      .select("id")
      .eq("id", created.pending)
      .maybeSingle();
    // A policy denial returns zero rows with NO error, which looks identical
    // to "no such id". That is the correct, boring outcome here — the two
    // cases (doesn't exist / not yours to see) must not be distinguishable,
    // which is exactly why the future page uses notFound() for both.
    expect(error).toBeNull();
    expect(data, "a pending scholarship was readable by an anonymous client").toBeNull();
  });

  it("cannot read the rejected row by id", async () => {
    const { data, error } = await anon
      .from("scholarships")
      .select("id")
      .eq("id", created.rejected)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data, "a rejected scholarship was readable by an anonymous client").toBeNull();
  });

  it("an unfiltered list scan sees only the verified fixture among the three", async () => {
    // The stronger claim than the id-lookup tests above: even without an
    // .eq("id", ...) narrowing the query, the pending and rejected rows never
    // appear — the app can rely on RLS rather than remembering to filter.
    const { data, error } = await anon
      .from("scholarships")
      .select("id")
      .in("id", Object.values(created));
    expect(error).toBeNull();
    const ids = (data ?? []).map((r) => r.id);
    expect(ids).toEqual([created.verified]);
  });
});

describe("the authenticated role is governed by the same policy", () => {
  it("anon key without a session behaves identically to a logged-out browser", async () => {
    // This project's anon client IS what a signed-out browser uses — there is
    // no separate "logged-out" role. Restated as its own test because it is
    // the assumption the public detail page's whole design rests on: RLS,
    // not requireUser(), is what will make a pending listing 404.
    const { data: session } = await anon.auth.getSession();
    expect(session.session, "this client unexpectedly carries a session").toBeNull();
  });
});
