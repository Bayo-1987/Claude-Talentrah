/**
 * Job Tracker and Farah chat — the mutations, tested against real policies.
 *
 * The single highest-value gap this closes: the existing cross-user suite
 * proves user B cannot READ or DELETE user A's application, and never proved B
 * cannot UPDATE it. That is the mutation with the most leverage on this table —
 * flipping someone else's entry to `hired` fires their referral payout, and
 * blanking their notes destroys data — so it is tested first and directly.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { Database } from "@/lib/supabase/types";
import { createAuthedTestUser, deleteTestUsers } from "../support/auth";
import { deleteOrgsCascade } from "../support/delete-orgs";
import { listUsersWithPrefix, RUN_TAG } from "../support/list-users";

for (const key of [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const) {
  // ANON is read by tests/support/auth.ts rather than here, but a missing one
  // must still fail loudly at load, not halfway through a run.
  if (!process.env[key]) throw new Error(`Tracker test cannot run: ${key} is not set.`);
}

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
type DB = SupabaseClient<Database>;

const admin: DB = createClient<Database>(URL, SERVICE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let created: string[] = [];

/*
 * One account reused by every test that only needs "some signed-in owner".
 *
 * Auth budget is a shared, limited resource across the whole suite — Supabase
 * rate-limits admin account creation, and a burst from several files running in
 * parallel surfaces as an unrelated assertion failure elsewhere rather than as
 * a rate-limit error. Tests that genuinely need two distinct principals (the
 * cross-user cases) still mint their own; nothing else does.
 */
let sharedOwner: { id: string; client: DB };

async function makeAuthedUser(label: string) {
  // Goes through the shared helper so a transient Supabase Auth rate limit is
  // retried, rather than surfacing as a nonsense assertion failure in whichever
  // suite happens to run next — see tests/support/auth.ts.
  const user = await createAuthedTestUser(`trk-${RUN_TAG}-${label}`);
  created.push(user.id);
  return { id: user.id, client: user.client };
}

/** A manual tracker entry — no job_posting_id, exactly as the UI creates one. */
async function manualEntry(userId: string, stage: Database["public"]["Enums"]["application_stage"]) {
  const { data, error } = await admin
    .from("applications")
    .insert({
      user_id: userId,
      job_posting_id: null,
      manual_job_snapshot: { companyName: "Invented Ltd", title: "Chief Nobody" },
      stage,
      source: "manual",
      applied_at: stage === "saved" ? null : new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error) throw error;
  return data!.id;
}

/** Clears the shared owner's rows so reuse can't leak state between tests. */
async function clearSharedOwnerData() {
  if (!sharedOwner) return;
  await admin.from("applications").delete().eq("user_id", sharedOwner.id);
  await admin.from("farah_messages").delete().eq("user_id", sharedOwner.id);
}

async function stageOf(id: string) {
  const { data } = await admin.from("applications").select("stage, notes").eq("id", id).single();
  return data;
}

/**
 * A posting this suite OWNS.
 *
 * Two tests below used to grab whatever `job_postings` returned first for
 * `status = open AND source_type = internal`, with no ordering and no
 * ownership. That reads harmless and is not: there is no staging database
 * (CLAUDE.md), up to 21 files run in parallel, and the row it lands on may
 * belong to a suite that is about to delete it. It did — CI failed with
 *
 *     expected undefined to be 'Campaign Role 74d6c2'
 *
 * `Campaign Role …` is the ad-campaigns suite's naming. That suite created the
 * posting, this test borrowed it, and its afterAll cascade-deleted the org (and
 * the posting with it) between this test's write and its read. The tracker was
 * never broken; the fixture was.
 *
 * Creating one costs a single insert and removes the whole class.
 */
async function makeOwnPosting(): Promise<{ id: string; title: string }> {
  // An internal posting must belong to an organisation
  // (job_postings_internal_has_org), so the fixture owns one of those too.
  // Created once and reused: the constraint is about shape, not about each
  // test having a distinct company.
  if (!fixtureOrgId) {
    const { data: org, error: orgErr } = await admin
      .from("organizations")
      .insert({
        name: `Tracker Fixture Co ${randomUUID().slice(0, 8)}`,
        domain: `trkfix-${randomUUID().slice(0, 8)}.example`,
        created_by: sharedOwner.id,
        // VERIFIED, and that is load-bearing rather than incidental. 0027 gates
        // the authenticated SELECT policy on job_postings behind
        // organizations.verified, so an unverified org's postings are invisible
        // to a normal session and the tracker's embedded join returns nothing.
        // The row this test used to borrow happened to belong to a verified
        // org, which is why borrowing appeared to work — another thing the
        // fixture was silently depending on.
        verified: true,
      })
      .select("id")
      .single();
    if (orgErr) throw orgErr;
    fixtureOrgId = org.id;
  }

  const title = `Tracker Fixture Role ${randomUUID().slice(0, 8)}`;
  const { data, error } = await admin
    .from("job_postings")
    .insert({
      source_type: "internal",
      organization_id: fixtureOrgId,
      title,
      company_name: "Tracker Fixture Co",
      description: "Fixture posting owned by tests/tracker.",
      structured_jd: {},
      status: "open",
      posted_at: new Date().toISOString(),
      dedup_fingerprint: randomUUID(),
    })
    .select("id, title")
    .single();
  if (error) throw error;
  // Tracked for readability; deleteOrgsCascade removes them via the org.
  createdPostings.push(data.id);
  return data;
}

const createdPostings: string[] = [];
let fixtureOrgId: string | null = null;

beforeAll(async () => {
  const user = await createAuthedTestUser(`trk-${RUN_TAG}-shared`);
  sharedOwner = { id: user.id, client: user.client };
}, 60_000);

afterEach(async () => {
  await clearSharedOwnerData();
  await Promise.all(created.map((id) => admin.auth.admin.deleteUser(id).catch(() => {})));
  created = [];
}, 60_000);

afterAll(async () => {
  /*
   * Via deleteOrgsCascade, which throws on failure.
   *
   * The comment previously here said "deleting the org cascades any posting
   * the line above missed". That is FALSE, and it is the exact misconception
   * that let test organisations pile up in production:
   * `job_postings_organization_id_fkey` is NO ACTION, and `job_postings` has
   * NO ACTION children of its own (`applications`, which this suite creates).
   * Both deletes were also unchecked, so either failing would have been
   * invisible. This teardown worked only because afterEach happens to clear
   * applications first.
   */
  if (fixtureOrgId) await deleteOrgsCascade(admin, [fixtureOrgId]);

  const trkUserIds: string[] = [];
  if (sharedOwner) trkUserIds.push(sharedOwner.id);
  /*
   * PAGINATED. `listUsers()` with no arguments returns only the first page —
   * GoTrue's default is 50, ordered newest-first — so this swept whichever
   * `trk-` accounts happened to land on page one and silently left the rest.
   * Same defect as the seed's, fixed in #53; it lived here too.
   */
  // SCOPED TO THIS RUN. An unscoped `trk-` swept every concurrent run's
  // live fixtures too — see RUN_TAG in tests/support/list-users.ts.
  trkUserIds.push(...(await listUsersWithPrefix(admin, `trk-${RUN_TAG}-`)).map((u) => u.id));
  await deleteTestUsers([...new Set(trkUserIds)]);
});

/* ========================================================================== *
 * §2 — the cross-user UPDATE gap (must-have)
 * ========================================================================== */

describe("user B cannot mutate user A's tracker entries", () => {
  it("cannot flip A's application to hired", async () => {
    /*
     * The highest-leverage mutation on this table. `hired` is the milestone the
     * referral flywheel reads, so writing it into someone else's row is not
     * vandalism, it is triggering a payout on their account.
     */
    const [a, b] = await Promise.all([makeAuthedUser("a"), makeAuthedUser("b")]);
    const appId = await manualEntry(a.id, "applied");

    await b.client.from("applications").update({ stage: "hired" }).eq("id", appId);

    const after = await stageOf(appId);
    expect(after?.stage, "ESCALATION: B moved A's application to hired").toBe("applied");
  });

  it("cannot blank A's notes", async () => {
    const [a, b] = await Promise.all([makeAuthedUser("a2"), makeAuthedUser("b2")]);
    const appId = await manualEntry(a.id, "applied");
    await admin.from("applications").update({ notes: "A's private notes" }).eq("id", appId);

    await b.client.from("applications").update({ notes: null }).eq("id", appId);

    expect((await stageOf(appId))?.notes, "B destroyed A's notes").toBe("A's private notes");
  });

  it("cannot reassign A's application to themselves", async () => {
    const [a, b] = await Promise.all([makeAuthedUser("a3"), makeAuthedUser("b3")]);
    const appId = await manualEntry(a.id, "saved");

    await b.client.from("applications").update({ user_id: b.id }).eq("id", appId);

    const { data } = await admin.from("applications").select("user_id").eq("id", appId).single();
    expect(data?.user_id, "B took ownership of A's application").toBe(a.id);
  });

  it("POSITIVE CONTROL: A can update their own entry", async () => {
    const a = sharedOwner;
    const appId = await manualEntry(a.id, "applied");
    const { error } = await a.client
      .from("applications")
      .update({ stage: "interviewing", notes: "phone screen booked" })
      .eq("id", appId);
    expect(error, "the owner must still be able to move their own entry").toBeNull();
    expect((await stageOf(appId))?.stage).toBe("interviewing");
  });
});

describe("user B cannot mutate user A's Farah history", () => {
  async function seedMessage(userId: string, content: string) {
    const { data, error } = await admin
      .from("farah_messages")
      .insert({ user_id: userId, role: "user", content })
      .select("id")
      .single();
    if (error) throw error;
    return data!.id;
  }

  it("cannot rewrite or delete another user's messages", async () => {
    // Reads are covered by the existing RLS suite; writes were not.
    const [a, b] = await Promise.all([makeAuthedUser("fa"), makeAuthedUser("fb")]);
    const msgId = await seedMessage(a.id, "A's private question");

    await b.client.from("farah_messages").update({ content: "rewritten" }).eq("id", msgId);
    await b.client.from("farah_messages").delete().eq("id", msgId);

    const { data } = await admin
      .from("farah_messages")
      .select("content")
      .eq("id", msgId)
      .maybeSingle();
    expect(data?.content, "B rewrote or deleted A's chat history").toBe("A's private question");
  });

  it("POSITIVE CONTROL: A can delete their own messages", async () => {
    const a = sharedOwner;
    const msgId = await seedMessage(a.id, "mine");
    await a.client.from("farah_messages").delete().eq("id", msgId);
    const { data } = await admin
      .from("farah_messages")
      .select("id")
      .eq("id", msgId)
      .maybeSingle();
    expect(data, "a user must be able to clear their own history").toBeNull();
  });
});

/* ========================================================================== *
 * §0 — stage transitions
 * ========================================================================== */

describe("a hired application cannot be silently un-hired (0037)", () => {
  it("refuses hired -> saved from the user's own client", async () => {
    /*
     * Enforced by a trigger rather than in the Server Action, because
     * `applications` has a permissive owner-only FOR ALL policy — anything the
     * action refuses is still reachable with a direct PATCH from the browser's
     * own session. This test therefore goes through the user's client, not the
     * action, so it proves the rule where it actually has to hold.
     */
    const a = sharedOwner;
    const appId = await manualEntry(a.id, "hired");

    const { error } = await a.client
      .from("applications")
      .update({ stage: "saved" })
      .eq("id", appId);

    expect(error, "hired -> saved should be refused outright").not.toBeNull();
    expect((await stageOf(appId))?.stage, "MILESTONE LOST: a hired row was regressed").toBe(
      "hired",
    );
  });

  it("refuses hired -> every other non-archived stage", async () => {
    // One account, four entries — rather than four accounts. Auth budget is a
    // shared, limited resource across the whole suite; see tests/support/auth.ts.
    const a = sharedOwner;
    for (const target of ["applied", "interviewing", "offer", "rejected"] as const) {
      const appId = await manualEntry(a.id, "hired");
      await a.client.from("applications").update({ stage: target }).eq("id", appId);
      expect((await stageOf(appId))?.stage, `hired -> ${target} was allowed`).toBe("hired");
    }
  });

  it("ALLOWS hired -> archived, the one legitimate exit", async () => {
    const a = sharedOwner;
    const appId = await manualEntry(a.id, "hired");
    const { error } = await a.client
      .from("applications")
      .update({ stage: "archived" })
      .eq("id", appId);
    expect(error, "tidying away a finished search must still work").toBeNull();
    expect((await stageOf(appId))?.stage).toBe("archived");
  });

  it("still allows ordinary corrections between non-hired stages", async () => {
    /*
     * The deliberately-narrow half of the rule. Strict funnel adjacency was
     * rejected: the tracker is the user's own private record, and correcting a
     * mis-clicked dropdown is legitimate. Forbidding backwards moves in general
     * would trade one real bug for a stream of "why won't it let me fix this".
     */
    const a = sharedOwner;
    const appId = await manualEntry(a.id, "offer");

    for (const target of ["applied", "saved", "interviewing", "rejected"] as const) {
      const { error } = await a.client
        .from("applications")
        .update({ stage: target })
        .eq("id", appId);
      expect(error, `a legitimate correction to ${target} was blocked`).toBeNull();
    }
  });

  it("the trigger is what blocks it — nothing else in the schema does", async () => {
    /*
     * Brackets the claim rather than asserting it.
     *
     * 0037 deliberately lets service_role through, so support and test setup
     * can correct genuine mistakes. That exemption doubles as the measurement:
     * the same hired -> saved update that the user's client is refused
     * SUCCEEDS through the service role, which shows no column constraint,
     * check or policy would have stopped it — the trigger is the only thing
     * standing between the product surface and a silently un-hired row.
     */
    const a = sharedOwner;
    const appId = await manualEntry(a.id, "hired");

    const { error: userError } = await a.client
      .from("applications")
      .update({ stage: "saved" })
      .eq("id", appId);
    expect(userError, "the product surface must be refused").not.toBeNull();

    const { error: adminError } = await admin
      .from("applications")
      .update({ stage: "saved" })
      .eq("id", appId);
    expect(adminError, "service_role is exempt by design, for support corrections").toBeNull();
    expect((await stageOf(appId))?.stage).toBe("saved");
  });

  it("saved -> offer is allowed: people start tracking a job late", async () => {
    const a = sharedOwner;
    const appId = await manualEntry(a.id, "saved");
    const { error } = await a.client
      .from("applications")
      .update({ stage: "offer" })
      .eq("id", appId);
    expect(error).toBeNull();
  });
});

/* ========================================================================== *
 * §1 — the activation trigger, pinned
 * ========================================================================== */

describe("what a manual entry does to the referral ledger", () => {
  async function referredUser(tag: string) {
    const referrerEmail = `trk-${RUN_TAG}-ref-${tag}-${randomUUID()}@talentrah.test`;
    const { data: r } = await admin.auth.admin.createUser({
      email: referrerEmail,
      email_confirm: true,
    });
    created.push(r!.user!.id);
    const { data: prof } = await admin
      .from("profiles")
      .select("referral_code")
      .eq("id", r!.user!.id)
      .single();

    const { data: b } = await admin.auth.admin.createUser({
      email: `trk-${RUN_TAG}-refd-${tag}-${randomUUID()}@talentrah.test`,
      email_confirm: true,
      user_metadata: { referred_by_code: prof!.referral_code },
    });
    created.push(b!.user!.id);
    return { referrer: r!.user!.id, referred: b!.user!.id };
  }

  async function activationBonuses(referrerId: string) {
    const { data } = await admin
      .from("credit_ledger")
      .select("reason")
      .eq("user_id", referrerId)
      .eq("reason", "referral_activation_bonus");
    return (data ?? []).length;
  }

  it("'applied' on a fabricated entry pays the activation bonus", async () => {
    /*
     * Pinned as an intentional regression guard, not an endorsement. The
     * trigger fires on `applied_at`, and check_and_activate_referral treats any
     * stage above `saved` as activation — so a manual entry naming a company
     * that does not exist is enough. That is the documented rule ("completed
     * profile OR first application") working as written; what bounds it is the
     * 10-per-30-days cap, not any verification of the job.
     */
    const { referrer, referred } = await referredUser("applied");
    expect(await activationBonuses(referrer)).toBe(0);

    await manualEntry(referred, "applied");
    await new Promise((r) => setTimeout(r, 1200));

    expect(await activationBonuses(referrer)).toBe(1);
  });

  it("moving that same entry on to 'hired' pays nothing further", async () => {
    /*
     * The non-obvious half, and the one a future change could easily get
     * backwards: `hired` drives a UI banner only. All of the credit effect
     * already happened at `applied`. If someone later "fixes" the flywheel by
     * hooking the ledger to `hired`, this starts failing — which is the point.
     */
    const { referrer, referred } = await referredUser("hired");
    const appId = await manualEntry(referred, "applied");
    await new Promise((r) => setTimeout(r, 1200));
    expect(await activationBonuses(referrer)).toBe(1);

    await admin.from("applications").update({ stage: "interviewing" }).eq("id", appId);
    await admin.from("applications").update({ stage: "hired" }).eq("id", appId);
    await new Promise((r) => setTimeout(r, 1200));

    expect(
      await activationBonuses(referrer),
      "reaching hired must not pay a second activation bonus",
    ).toBe(1);
  });

  it("a 'saved' entry pays nothing — applied_at stays null", async () => {
    const { referrer, referred } = await referredUser("saved");
    const appId = await manualEntry(referred, "saved");
    await new Promise((r) => setTimeout(r, 1000));

    const { data } = await admin.from("applications").select("applied_at").eq("id", appId).single();
    expect(data?.applied_at, "saved must not set applied_at").toBeNull();
    expect(await activationBonuses(referrer)).toBe(0);
  });
});

/* ========================================================================== *
 * §1/§2 — data integrity around manual entries
 * ========================================================================== */

describe("manual entry integrity", () => {
  it("an entry whose posting is later closed still renders its data", async () => {
    // Soft-delete safety: closing a posting must not orphan a tracker row.
    const a = sharedOwner;
    const job = await makeOwnPosting();

    const { data: app } = await admin
      .from("applications")
      .insert({ user_id: a.id, job_posting_id: job.id, stage: "applied", source: "internal_apply" })
      .select("id")
      .single();

    await admin.from("job_postings").update({ status: "closed" }).eq("id", job.id);
    try {
      const { data, error } = await a.client
        .from("applications")
        .select("id, stage, job_postings(title, company_name)")
        .eq("id", app!.id)
        .single();
      expect(error, "a closed posting must not break the tracker join").toBeNull();
      expect(data?.job_postings?.title).toBe(job.title);
    } finally {
      await admin.from("job_postings").update({ status: "open" }).eq("id", job.id);
    }
  });

  it("the (user_id, job_posting_id) uniqueness holds, and surfaces as a clean error", async () => {
    /*
     * A double-submit of "save this job" before the first insert lands hits the
     * unique constraint. Worth knowing it produces a typed 23505 the caller can
     * branch on, not an opaque failure — no current code path catches insert
     * errors on the save action.
     */
    const a = sharedOwner;
    const job = await makeOwnPosting();

    // Shared owner, so clear any prior row for this pair first.
    await admin
      .from("applications")
      .delete()
      .eq("user_id", a.id)
      .eq("job_posting_id", job.id);

    await a.client
      .from("applications")
      .insert({ user_id: a.id, job_posting_id: job.id, stage: "saved", source: "manual" });
    const { error } = await a.client
      .from("applications")
      .insert({ user_id: a.id, job_posting_id: job.id, stage: "saved", source: "manual" });

    expect(error?.code, "a duplicate save should be a unique violation, not a crash").toBe("23505");
  });

  it("every stage renders with null resume and cover-letter ids", async () => {
    // True of every manual entry. The card has per-stage branching, so this is
    // checked at all seven rather than only at "saved".
    const a = sharedOwner;
    for (const stage of [
      "saved",
      "applied",
      "interviewing",
      "offer",
      "rejected",
      "archived",
      "hired",
    ] as const) {
      const id = await manualEntry(a.id, stage);
      const { data, error } = await a.client
        .from("applications")
        .select("id, stage, resume_id, cover_letter_id, manual_job_snapshot")
        .eq("id", id)
        .single();
      expect(error, `stage ${stage} failed to load`).toBeNull();
      expect(data?.resume_id).toBeNull();
      expect(data?.cover_letter_id).toBeNull();
    }
  });

  it("a very long fabricated title is stored unbounded — no cap exists", async () => {
    /*
     * Documenting, not asserting a fix. There is no length limit on the
     * fabricated company/title, so a pathological value is stored verbatim and
     * will visually break the fixed-width tracker card. Low severity; recorded
     * so that a future decision to cap it is deliberate.
     */
    const a = sharedOwner;
    const longTitle = "X".repeat(5000);
    const { data, error } = await a.client
      .from("applications")
      .insert({
        user_id: a.id,
        job_posting_id: null,
        manual_job_snapshot: { companyName: "Co", title: longTitle },
        stage: "saved",
        source: "manual",
      })
      .select("manual_job_snapshot")
      .single();
    expect(error).toBeNull();
    expect(
      (data?.manual_job_snapshot as { title: string }).title.length,
      "no length cap is enforced today",
    ).toBe(5000);
  });
});

/* ========================================================================== *
 * §3 — Farah chat limits
 * ========================================================================== */

describe("Farah's rate limit and message bounds", () => {
  it("counts only the last hour, from the user's own rows", async () => {
    /*
     * Pinning the mechanism the limit is built on rather than driving 30 HTTP
     * requests: the route counts `farah_messages` rows for this user in the
     * last hour. An older message must not consume the allowance, and another
     * user's messages must not either — both are ways the limit could silently
     * become wrong.
     */
    const a = sharedOwner;
    const b = await makeAuthedUser("rl-b");
    await admin.from("farah_messages").delete().eq("user_id", a.id);
    const hourAgo = new Date(Date.now() - 61 * 60 * 1000).toISOString();

    /*
     * Every row carries an explicit created_at on purpose. PostgREST builds a
     * single uniform column list for a batch insert, so a row that omits a
     * column another row sets is sent an explicit NULL — which overrides the
     * DEFAULT and fails the NOT NULL constraint. Found the hard way: the first
     * version of this test silently inserted nothing and counted zero.
     */
    const now = new Date().toISOString();
    const { error: seedErr } = await admin.from("farah_messages").insert([
      { user_id: a.id, role: "user", content: "old", created_at: hourAgo },
      { user_id: a.id, role: "user", content: "recent", created_at: now },
      { user_id: b.id, role: "user", content: "someone else", created_at: now },
    ]);
    expect(seedErr, "test setup failed to seed messages").toBeNull();

    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count } = await admin
      .from("farah_messages")
      .select("id", { count: "exact", head: true })
      .eq("user_id", a.id)
      .eq("role", "user")
      .gte("created_at", since);

    expect(count, "only this user's messages from the last hour should count").toBe(1);
  });

  it("the message-length bound is 2000 characters", async () => {
    // Exact boundary, since an off-by-one here is invisible until a user hits
    // it. 2000 is accepted by the schema, 2001 is what the route rejects.
    const a = sharedOwner;
    const { error: ok } = await a.client
      .from("farah_messages")
      .insert({ user_id: a.id, role: "user", content: "x".repeat(2000) });
    expect(ok, "exactly 2000 characters must be storable").toBeNull();
  });
});
