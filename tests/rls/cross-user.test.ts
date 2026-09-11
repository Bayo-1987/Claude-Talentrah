/**
 * RLS cross-user verification — the pre-launch safety gate.
 *
 * Phase 1's plan doc asks for this explicitly and it had never been run:
 * policies existed on every table, but "the policy is there" and "the policy
 * works" are different claims, and only the second one matters before real
 * people put resumes in this database.
 *
 * What this does, with two REAL authenticated users (not service-role, which
 * bypasses RLS by design and would prove nothing):
 *   - positive control: User A can read their own rows. If this fails, a
 *     later "B sees nothing" result would be meaningless — B seeing nothing
 *     because the row doesn't exist is not the same as RLS working.
 *   - negative control: User B, querying A's row IDs directly, gets zero
 *     rows on every user-owned table.
 *   - write control: B's UPDATE and DELETE against A's row IDs change
 *     nothing. Verified by re-reading the row with the service role
 *     afterwards — under RLS a non-matching UPDATE/DELETE returns success
 *     with zero rows affected, so "no error" alone would be a false pass.
 *   - public surfaces stay public, and M10's scholarship moderation gate
 *     holds for an authenticated B, not just anonymously.
 *
 * NOTE ON ENVIRONMENT: this runs against the real Supabase project — there
 * is no separate test project. It creates two namespaced throwaway users, plus
 * its own organisation and job posting, and deletes them all in afterAll. It
 * only ever touches rows it created — which was NOT true until 2026-08-26: it
 * borrowed an arbitrary `job_postings` row and wrote against it for the whole
 * file. A dedicated test project or Supabase branch would be safer and
 * is worth doing before this repo has more contributors.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { Database } from "@/lib/supabase/types";
import { deleteOrgsCascade } from "../support/delete-orgs";

/*
 * Fail loudly on a missing secret rather than letting the suite die inside
 * a Supabase client with an opaque error. This is a security gate — the one
 * outcome worse than it failing is it appearing to pass because it never
 * actually ran.
 */
for (const key of [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const) {
  if (!process.env[key]) {
    throw new Error(
      `RLS cross-user test cannot run: ${key} is not set. It must be present locally (.env.local) and as a CI secret — see .github/workflows/ci.yml.`,
    );
  }
}

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

type DB = SupabaseClient<Database>;

const admin: DB = createClient<Database>(URL, SERVICE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/** A real authenticated session, established the way a signed-in user has one. */
async function createAuthedUser(label: string): Promise<{ id: string; email: string; client: DB }> {
  const email = `rls-${label}-${randomUUID()}@talentrah.test`;
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (createErr) throw createErr;

  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkErr) throw linkErr;

  const client = createClient<Database>(URL, ANON, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: otpErr } = await client.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: "magiclink",
  });
  if (otpErr) throw otpErr;

  return { id: created.user.id, email, client };
}

let A: Awaited<ReturnType<typeof createAuthedUser>>;
let B: Awaited<ReturnType<typeof createAuthedUser>>;

/** A's row id in each user-owned table. The list IS the coverage claim. */
const ids: Record<string, string> = {};
let jobPostingId: string;
let fixtureOrgId: string | null = null;
let verifiedScholarshipId: string;
let pendingScholarshipId: string;
let templateId: string;
let passId: string;

beforeAll(async () => {
  A = await createAuthedUser("a");
  B = await createAuthedUser("b");

  /*
   * A posting this suite OWNS.
   *
   * This used to be `.select("id").limit(1).single()` — no ordering, no
   * ownership — with the id then held for the whole file and applications and
   * match_scores created against it. Up to 33 files run in parallel against one
   * production project, so a borrowed row can be deleted by its owning suite
   * between this hook and the test that uses it; the insert then fails 23503.
   *
   * It also made this file's own header claim ("It only ever touches rows it
   * created") untrue, which is the more corrosive part: the next reader trusts
   * it and stops checking.
   */
  const { data: fixtureOrg, error: fixtureOrgError } = await admin
    .from("organizations")
    .insert({
      // Matches FIXTURE_NAME_PATTERNS, so the global sweep backstops this if a
      // run dies before afterAll.
      name: `RLS-CROSSUSER Org ${randomUUID().slice(0, 8)}`,
      domain: `crossuser-${randomUUID().slice(0, 8)}.example`,
      created_by: A.id,
      // Verified: 0027 gates the authenticated SELECT on job_postings behind
      // organizations.verified, and B must be able to SEE the posting for the
      // public-surface assertions below to mean anything.
      verified: true,
    })
    .select("id")
    .single();
  if (fixtureOrgError || !fixtureOrg) {
    throw new Error(`Could not create fixture org: ${fixtureOrgError?.message}`);
  }
  fixtureOrgId = fixtureOrg.id;

  const { data: job, error: jobError } = await admin
    .from("job_postings")
    .insert({
      source_type: "internal",
      organization_id: fixtureOrgId,
      company_name: "RLS-CROSSUSER Co",
      title: "RLS-CROSSUSER Role",
      description: "Fixture posting owned by tests/rls/cross-user.",
      structured_jd: {},
      status: "open",
      posted_at: new Date().toISOString(),
      dedup_fingerprint: randomUUID(),
    })
    .select("id")
    .single();
  if (jobError || !job) throw new Error(`Could not create fixture posting: ${jobError?.message}`);
  jobPostingId = job.id;
  const { data: verified } = await admin
    .from("scholarships")
    .select("id")
    .eq("moderation_status", "verified")
    .limit(1)
    .single();
  verifiedScholarshipId = verified!.id;
  const { data: pending } = await admin
    .from("scholarships")
    .select("id")
    .eq("moderation_status", "pending")
    .limit(1)
    .single();
  pendingScholarshipId = pending!.id;
  const { data: tpl } = await admin.from("resume_templates").select("id").limit(1).single();
  templateId = tpl!.id;
  const { data: pass } = await admin.from("passes").select("id").limit(1).single();
  passId = pass!.id;

  // --- Seed A's data. Where a table has an INSERT path for the owner, seed
  // through A's OWN authenticated client, so the seed doubles as proof the
  // owner can actually write it. Tables with no owner INSERT policy
  // (ledger, payments, events) are seeded with the service role, which is
  // how the app writes them too.
  const ins = async (table: string, row: Record<string, unknown>, via: DB = A.client) => {
    const { data, error } = await via
      .from(table as "resumes")
      .insert(row as never)
      .select("id")
      .single();
    if (error) throw new Error(`seed ${table}: ${error.message}`);
    ids[table] = (data as { id: string }).id;
  };

  await ins("resumes", {
    user_id: A.id,
    title: "RLS test resume",
    is_base: true,
    structured_content: { secret: "A-private-resume" },
  });
  await ins("applications", {
    user_id: A.id,
    job_posting_id: jobPostingId,
    stage: "applied",
    source: "manual",
    notes: "A-private-note",
  });
  // Seeded with the service role: migration 0031 removed the authenticated
  // INSERT on match_scores, because a score is the server's conclusion about a
  // user rather than something they supply. The row is still A-owned, so every
  // ownership assertion below is unchanged.
  await ins("match_scores", {
    user_id: A.id,
    job_posting_id: jobPostingId,
    score: 77,
    tier: "good",
  }, admin);
  // Service role for the same reason as match_scores above (0031): this row is
  // the server's record of a tailoring run it performed and charged for, so
  // `authenticated` no longer holds INSERT on it.
  await ins(
    "job_tailoring_requests",
    { user_id: A.id, source_jd_text: "A-private-jd", gap_analysis: {} },
    admin,
  );
  await ins("farah_messages", { user_id: A.id, role: "user", content: "A-private-message" });
  await ins("referral_shares", { user_id: A.id, channel: "whatsapp" });
  await ins("scholarship_saves", {
    user_id: A.id,
    scholarship_id: verifiedScholarshipId,
    status: "saved",
  });

  // No owner INSERT policy on these — service role, as in production.
  await ins("credit_ledger", { user_id: A.id, delta: 5, reason: "signup_grant", balance_after: 5 }, admin);
  await ins(
    "payment_transactions",
    {
      user_id: A.id,
      amount: 2000,
      product_type: "pass",
      product_id: passId,
      status: "success",
      paystack_reference: `rls_test_${randomUUID()}`,
    },
    admin,
  );
  await ins(
    "user_passes",
    {
      user_id: A.id,
      pass_id: passId,
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      payment_method: "card",
      status: "active",
    },
    admin,
  );
  await ins("user_template_unlocks", { user_id: A.id, template_id: templateId }, admin);
  await ins(
    "credit_gate_events",
    {
      user_id: A.id,
      reason: "tailoring_run",
      credits_required: 5,
      credits_available: 0,
      outcome: "blocked_insufficient_credits",
    },
    admin,
  );
  await ins("referrals", { referrer_id: A.id, status: "invited" }, admin);

  // Populated by a trigger when the application above was inserted.
  const { data: evt } = await admin
    .from("application_stage_events")
    .select("id")
    .eq("user_id", A.id)
    .limit(1)
    .single();
  ids["application_stage_events"] = evt!.id;
}, 120_000);

afterAll(async () => {
  // Deleting the auth users cascades every row seeded above.
  for (const u of [A, B]) {
    if (u?.id) await admin.auth.admin.deleteUser(u.id);
  }
  /*
   * Then the fixture organisation and its posting. Users first is not required
   * — deleteOrgsCascade removes applications and match_scores itself — but it
   * keeps the cascade doing the work it already does, and leaves this call with
   * nothing to clean up in the ordinary case.
   */
  if (fixtureOrgId) await deleteOrgsCascade(admin, [fixtureOrgId]);
}, 60_000);

/**
 * Every table holding data private to one user. This list is the coverage
 * claim — if a table with user-owned data is added and not listed here, this
 * suite silently stops covering it, so add it at the same time.
 *
 * Two user-scoped tables deliberately live outside this list because the
 * read-your-own-row shape cannot express what they need checked:
 * `organization_members` (a grant, so the risk is creating one, not reading
 * one) and `referrals` (scoped by referrer_id/referred_user_id, no user_id
 * column). Both are covered by tests/rls/org-and-referral-scoping.test.ts —
 * which exists because the omission hid a real escalation for the whole of
 * Phase 1.
 *
 * Note that beforeAll seeds a `referrals` row that nothing here asserts on.
 * It is left in place (it is cleaned up with A), but it is not coverage —
 * a seeded row can read like one at a glance, which is part of how the gap
 * stayed invisible.
 */
const OWNED_TABLES = [
  "resumes",
  "applications",
  "application_stage_events",
  "match_scores",
  "job_tailoring_requests",
  "farah_messages",
  "referral_shares",
  "scholarship_saves",
  "credit_ledger",
  "payment_transactions",
  "user_passes",
  "user_template_unlocks",
  "credit_gate_events",
] as const;

describe("RLS: positive control — A can see A's own rows", () => {
  it.each(OWNED_TABLES)("A reads its own %s row", async (table) => {
    const { data } = await A.client
      .from(table as "resumes")
      .select("id")
      .eq("id", ids[table]);
    expect(data, `A should see its own ${table} row — otherwise the B checks prove nothing`).toHaveLength(1);
  });

  it("A can read its own profile", async () => {
    const { data } = await A.client.from("profiles").select("id").eq("id", A.id);
    expect(data).toHaveLength(1);
  });
});

describe("RLS: negative control — B cannot READ A's rows by id", () => {
  it.each(OWNED_TABLES)("B gets zero rows from %s", async (table) => {
    const { data, error } = await B.client
      .from(table as "resumes")
      .select("*")
      .eq("id", ids[table]);
    expect(error, `${table} query should not error, it should return nothing`).toBeNull();
    expect(data, `LEAK: B could read A's ${table} row`).toHaveLength(0);
  });

  it("B cannot read A's profile", async () => {
    const { data } = await B.client.from("profiles").select("*").eq("id", A.id);
    expect(data, "LEAK: B could read A's profile").toHaveLength(0);
  });

  it("B listing a table unfiltered never returns A's rows", async () => {
    for (const table of OWNED_TABLES) {
      const { data } = await B.client.from(table as "resumes").select("id");
      const leaked = (data ?? []).some((r) => (r as { id: string }).id === ids[table]);
      expect(leaked, `LEAK: A's ${table} row appeared in B's unfiltered list`).toBe(false);
    }
  });
});

describe("RLS: write control — B cannot MUTATE A's rows", () => {
  /** Under RLS a non-matching UPDATE/DELETE succeeds affecting zero rows, so the row must be re-read to prove it. */
  async function rowStillExists(table: string, id: string) {
    const { data } = await admin
      .from(table as "resumes")
      .select("id")
      .eq("id", id);
    return (data ?? []).length === 1;
  }

  it("B cannot delete A's resume, application, or scholarship save", async () => {
    for (const table of ["resumes", "applications", "scholarship_saves"]) {
      await B.client
        .from(table as "resumes")
        .delete()
        .eq("id", ids[table]);
      expect(await rowStillExists(table, ids[table]), `LEAK: B deleted A's ${table} row`).toBe(true);
    }
  });

  it("B cannot update A's resume content", async () => {
    await B.client
      .from("resumes")
      .update({ title: "OWNED BY B" })
      .eq("id", ids["resumes"]);
    const { data } = await admin.from("resumes").select("title").eq("id", ids["resumes"]).single();
    expect(data?.title, "LEAK: B modified A's resume").toBe("RLS test resume");
  });

  it("B cannot update A's profile (e.g. grant itself credits via A's row)", async () => {
    await B.client.from("profiles").update({ credits_balance: 9999 }).eq("id", A.id);
    const { data } = await admin.from("profiles").select("credits_balance").eq("id", A.id).single();
    expect(data?.credits_balance, "LEAK: B modified A's profile").not.toBe(9999);
  });

  it("B cannot insert a row owned by A", async () => {
    const { error } = await B.client
      .from("resumes")
      .insert({ user_id: A.id, title: "planted by B", structured_content: {} });
    expect(error, "LEAK: B inserted a row attributed to A").not.toBeNull();
  });

  it("B cannot write to the credit ledger at all (no owner INSERT policy)", async () => {
    const { error } = await B.client
      .from("credit_ledger")
      .insert({ user_id: B.id, delta: 1000, reason: "admin_adjustment", balance_after: 1000 });
    expect(error, "LEAK: a user could grant themselves credits").not.toBeNull();
  });
});

/**
 * 0151's own standing check: a systematic information_schema.table_privileges
 * sweep (same shape as 0150's) found ~20 more tables where `authenticated`
 * still held INSERT/UPDATE/DELETE with no covering RLS policy at all — RLS
 * already denies these today (a non-matching UPDATE/DELETE affects zero rows
 * silently; an INSERT with no satisfiable WITH CHECK is refused with a real
 * RLS-violation error), but the GRANT itself was still sitting open,
 * waiting for the next policy addition to expose it — CLAUDE.md's own
 * column-privilege lesson, at the table-grant level instead of the
 * column-grant level.
 *
 * Every table here was individually confirmed (not assumed from the sweep
 * alone) to have zero legitimate authenticated-client write path for the
 * specific command being asserted — see 0151's own migration header for the
 * full per-table reasoning. `profiles` (also flagged by the sweep) is
 * deliberately NOT here — its own migration/PR gives it the scrutiny its
 * status as the root identity table warrants, separate from this batch.
 * `organizations`/`organization_members` are also deliberately not here —
 * 0152's own header explains why their fix needs an accompanying code
 * change, not just a revoke.
 *
 * Tests use A's OWN rows where a seeded row already exists in this file's
 * own fixtures (a stronger check than "B can't touch A's row": even the
 * OWNER can no longer write via these commands, because the grant itself is
 * gone, not because of an ownership boundary).
 */
describe("0151: verified zero-write-path tables have NO client write at the grant level", () => {
  it("A cannot update or delete its own credit_ledger row", async () => {
    const { error: updateError } = await A.client
      .from("credit_ledger")
      .update({ delta: 999 })
      .eq("id", ids["credit_ledger"]);
    expect(updateError?.code, "GRANT BUG: credit_ledger UPDATE not refused at the grant level").toBe("42501");

    const { error: deleteError } = await A.client.from("credit_ledger").delete().eq("id", ids["credit_ledger"]);
    expect(deleteError?.code, "GRANT BUG: credit_ledger DELETE not refused at the grant level").toBe("42501");
  });

  it("A cannot insert, update, or delete its own payment_transactions row", async () => {
    const { error: insertError } = await A.client.from("payment_transactions").insert({
      user_id: A.id,
      amount: 1,
      product_type: "pass",
      product_id: passId,
      status: "success",
      paystack_reference: `rls_test_${randomUUID()}`,
    });
    expect(insertError?.code, "MONEY BUG: payment_transactions INSERT not refused at the grant level").toBe("42501");

    const { error: updateError } = await A.client
      .from("payment_transactions")
      .update({ status: "failed" })
      .eq("id", ids["payment_transactions"]);
    expect(updateError?.code, "MONEY BUG: payment_transactions UPDATE not refused at the grant level").toBe(
      "42501",
    );

    const { error: deleteError } = await A.client
      .from("payment_transactions")
      .delete()
      .eq("id", ids["payment_transactions"]);
    expect(deleteError?.code, "MONEY BUG: payment_transactions DELETE not refused at the grant level").toBe(
      "42501",
    );
  });

  it("A cannot update or delete its own user_passes row", async () => {
    const { error: updateError } = await A.client
      .from("user_passes")
      .update({ status: "cancelled" })
      .eq("id", ids["user_passes"]);
    expect(updateError?.code, "GRANT BUG: user_passes UPDATE not refused at the grant level").toBe("42501");

    const { error: deleteError } = await A.client.from("user_passes").delete().eq("id", ids["user_passes"]);
    expect(deleteError?.code, "GRANT BUG: user_passes DELETE not refused at the grant level").toBe("42501");
  });

  it("A cannot insert, update, or delete its own referrals row", async () => {
    const { data: existing } = await admin.from("referrals").select("id").eq("referrer_id", A.id).limit(1).single();

    const { error: insertError } = await A.client
      .from("referrals")
      .insert({ referrer_id: A.id, status: "activated" });
    expect(insertError?.code, "MONEY BUG: referrals INSERT not refused at the grant level").toBe("42501");

    const { error: updateError } = await A.client
      .from("referrals")
      .update({ status: "activated" })
      .eq("id", existing!.id);
    expect(updateError?.code, "MONEY BUG: referrals UPDATE not refused at the grant level").toBe("42501");

    const { error: deleteError } = await A.client.from("referrals").delete().eq("id", existing!.id);
    expect(deleteError?.code, "MONEY BUG: referrals DELETE not refused at the grant level").toBe("42501");
  });

  it("A cannot update or delete its own user_template_unlocks row", async () => {
    const { error: updateError } = await A.client
      .from("user_template_unlocks")
      .update({ template_id: templateId })
      .eq("id", ids["user_template_unlocks"]);
    expect(updateError?.code, "GRANT BUG: user_template_unlocks UPDATE not refused at the grant level").toBe(
      "42501",
    );

    const { error: deleteError } = await A.client
      .from("user_template_unlocks")
      .delete()
      .eq("id", ids["user_template_unlocks"]);
    expect(deleteError?.code, "GRANT BUG: user_template_unlocks DELETE not refused at the grant level").toBe(
      "42501",
    );
  });

  it("A cannot update or delete its own credit_gate_events row", async () => {
    const { error: updateError } = await A.client
      .from("credit_gate_events")
      .update({ outcome: "proceeded" })
      .eq("id", ids["credit_gate_events"]);
    expect(updateError?.code, "GRANT BUG: credit_gate_events UPDATE not refused at the grant level").toBe("42501");

    const { error: deleteError } = await A.client
      .from("credit_gate_events")
      .delete()
      .eq("id", ids["credit_gate_events"]);
    expect(deleteError?.code, "GRANT BUG: credit_gate_events DELETE not refused at the grant level").toBe("42501");
  });

  it("A cannot update or delete its own application_stage_events row", async () => {
    const { error: updateError } = await A.client
      .from("application_stage_events")
      .update({ stage: "hired" })
      .eq("id", ids["application_stage_events"]);
    expect(updateError?.code, "GRANT BUG: application_stage_events UPDATE not refused at the grant level").toBe(
      "42501",
    );

    const { error: deleteError } = await A.client
      .from("application_stage_events")
      .delete()
      .eq("id", ids["application_stage_events"]);
    expect(deleteError?.code, "GRANT BUG: application_stage_events DELETE not refused at the grant level").toBe(
      "42501",
    );
  });

  it("A (the org's own creator) cannot delete the fixture job posting directly", async () => {
    const { error } = await A.client.from("job_postings").delete().eq("id", jobPostingId);
    expect(error?.code, "GRANT BUG: job_postings DELETE not refused at the grant level").toBe("42501");
    const { data: stillThere } = await admin.from("job_postings").select("id").eq("id", jobPostingId).maybeSingle();
    expect(stillThere?.id, "the posting must survive an attempted client-side delete").toBe(jobPostingId);
  });

  it("B cannot insert or delete a scholarship", async () => {
    const { error: insertError } = await B.client.from("scholarships").insert({
      program_name: "Fabricated by B",
      provider: "Nobody",
      source_name: "fabricated",
      dedup_fingerprint: randomUUID(),
      moderation_status: "verified",
    } as never);
    expect(insertError?.code, "GRANT BUG: scholarships INSERT not refused at the grant level").toBe("42501");

    const { error: deleteError } = await B.client.from("scholarships").delete().eq("id", verifiedScholarshipId);
    expect(deleteError?.code, "GRANT BUG: scholarships DELETE not refused at the grant level").toBe("42501");
  });

  it("no client can write the catalog tables (credit_packs, passes, resume_templates) at all", async () => {
    const { error: packError } = await B.client
      .from("credit_packs")
      .update({ price_ngn: 1 })
      .eq("id", (await admin.from("credit_packs").select("id").limit(1).single()).data!.id);
    expect(packError?.code, "MONEY BUG: credit_packs UPDATE not refused at the grant level").toBe("42501");

    const { error: passError } = await B.client.from("passes").update({ price_ngn: 1 }).eq("id", passId);
    expect(passError?.code, "MONEY BUG: passes UPDATE not refused at the grant level").toBe("42501");

    const { error: templateError } = await B.client
      .from("resume_templates")
      .update({ is_premium: false })
      .eq("id", templateId);
    expect(templateError?.code, "GRANT BUG: resume_templates UPDATE not refused at the grant level").toBe("42501");
  });

  it("neither user can write country_default_events, farah_session_events, or resume_builder_start_events", async () => {
    for (const table of ["country_default_events", "farah_session_events", "resume_builder_start_events"] as const) {
      const { error } = await A.client.from(table).insert({ user_id: A.id } as never);
      expect(error?.code, `GRANT BUG: ${table} INSERT not refused at the grant level`).toBe("42501");
    }
  });

  it("A cannot delete a user_notifications row", async () => {
    const { data: notif } = await admin
      .from("user_notifications")
      .insert({ user_id: A.id, type: "mentorship_session_confirmed", title: "t", body: "b" } as never)
      .select("id")
      .single();
    const { error } = await A.client.from("user_notifications").delete().eq("id", notif!.id);
    expect(error?.code, "GRANT BUG: user_notifications DELETE not refused at the grant level").toBe("42501");
    await admin.from("user_notifications").delete().eq("id", notif!.id);
  });
});

describe("RLS: public and semi-public surfaces behave as intended", () => {
  it("both users can read the public job feed", async () => {
    for (const [label, u] of [["A", A], ["B", B]] as const) {
      const { data } = await u.client.from("job_postings").select("id").limit(1);
      expect(data, `${label} should see public job postings`).toHaveLength(1);
    }
  });

  it("both users can read the catalog tables", async () => {
    for (const table of ["credit_packs", "passes", "resume_templates"] as const) {
      const { data } = await B.client.from(table).select("id").limit(1);
      expect(data, `${table} should be publicly readable`).toHaveLength(1);
    }
  });

  it("M10 moderation gate holds for an authenticated user, not just anonymously", async () => {
    const { data: ok } = await B.client
      .from("scholarships")
      .select("id")
      .eq("id", verifiedScholarshipId);
    expect(ok, "a verified scholarship should be visible to any signed-in user").toHaveLength(1);

    const { data: hidden } = await B.client
      .from("scholarships")
      .select("id")
      .eq("id", pendingScholarshipId);
    expect(hidden, "LEAK: a pending scholarship was visible to a signed-in user").toHaveLength(0);
  });

  it("no user can publish a scholarship (no owner write policy)", async () => {
    await B.client
      .from("scholarships")
      .update({ moderation_status: "verified" })
      .eq("id", pendingScholarshipId);
    const { data } = await admin
      .from("scholarships")
      .select("moderation_status")
      .eq("id", pendingScholarshipId)
      .single();
    expect(data?.moderation_status, "LEAK: a user published an unreviewed scholarship").toBe("pending");
  });
});
