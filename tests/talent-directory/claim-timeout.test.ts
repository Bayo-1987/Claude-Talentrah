/**
 * V4: a human resume review a mentor claimed and did not decide within 72 hours goes back to the pool (migration 0267, release_stale_verification_claims).
 * DATABASE-BACKED. Written before the migration: every test here fails with "function not found" until 0267 is applied.
 *
 * THE CLOCK IS INJECTED, AND KEPT AWAY FROM THE REAL ONE. The function takes p_now (the 0203 pattern), so each boundary is exact and nothing here sleeps. But the real sweep (tests/mentorship/no-show-sweep.test.ts and
 * payment-idempotency.test.ts run runMentorshipSweep for real, with the database's own clock) releases EVERY claim older than 72 hours, in whichever file planted it, so a fixture dated far in the past would be released
 * by somebody else's sweep at a random moment. Each test therefore takes ONE injected instant 30 seconds ahead of the database's clock (inside the function's one-minute allowance), and every claim that must be
 * stale is only 72 hours and a few seconds old AT THAT INSTANT, which makes it younger than 72 hours for a real sweep for the next ~20 seconds, longer than any test here runs. Claims that must stay are younger than that, or are not
 * claimed human reviews at all. The database's clock is read from the database (a probe row's requested_at default), never from this machine's.
 *
 * ONE FILE ON PURPOSE. The function releases every stale claim in the table, so two test files that each plant stale claims and sweep would release each other's rows when vitest runs them side by side
 * (found the hard way: the existing-readers cases were first a second file and failed at random). Both halves, the function's own behaviour and the existing readers of the rows it changes, share this file's
 * rows, users and sequential run.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { createAuthedTestUser, deleteTestUsers, type DB } from "../support/auth";
import { claimVerificationReview, releaseVerificationReviewClaim, resolveVerificationReview } from "@/lib/talent-directory/reviewer-runner";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY"] as const) {
  if (!process.env[key]) throw new Error(`The claim-timeout test cannot run: ${key} is not set.`);
}
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const admin: SupabaseClient<Database> = createClient<Database>(URL, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
const anon = createClient<Database>(URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });

const HOUR = 3_600_000;
/** A claim this much older than the injected instant is stale: 72 hours and a few seconds. Distinct values keep the rows apart; all are younger than 72 hours for a real sweep for ~20 seconds. */
const STALE = 72 * HOUR + 5_000;
const STALE_B = 72 * HOUR + 2_000;
const STALE_C = 72 * HOUR + 9_000;

/** The database's clock minus this machine's, found once from a probe row's default requested_at. */
let skewMs = 0;
interface Clock { now: Date; at: (offsetMs: number) => string }
let clk: Clock;
const newClock = (): Clock => {
  const now = new Date(Date.now() + skewMs + 30_000);
  return { now, at: (offsetMs) => new Date(now.getTime() + offsetMs).toISOString() };
};
const at = (offsetMs: number) => clk.at(offsetMs);
const sweep = (args: Record<string, unknown> = {}) => admin.rpc("release_stale_verification_claims", { p_now: clk.now.toISOString(), ...args });

let candidate: { id: string; client: DB };
let reviewerA: { id: string; client: DB };
let reviewerB: { id: string; client: DB };
let candidateId: string;
let reviewerAId: string;
let reviewerBId: string;
const created: string[] = [];

interface RowOptions {
  status?: string;
  reviewType?: string;
  claimedAt?: string | null;
  reviewerId?: string | null;
  payout?: number;
}
async function insertRow(o: RowOptions): Promise<string> {
  const status = o.status ?? "claimed";
  const { data, error } = await admin
    .from("talent_verifications")
    .insert({
      user_id: candidateId,
      status,
      review_type: o.reviewType ?? "human",
      reviewer_id: o.reviewerId === undefined ? (status === "pending" ? null : reviewerAId) : o.reviewerId,
      claimed_at: o.claimedAt === undefined ? null : o.claimedAt,
      reviewer_payout_ngn: o.payout ?? 0,
    } as never)
    .select("id")
    .single();
  if (error) throw error;
  created.push(data!.id);
  return data!.id;
}
const claimedAgo = (ms: number, extra: RowOptions = {}) => insertRow({ status: "claimed", claimedAt: at(-ms), ...extra });
const read = async (id: string) => (await admin.from("talent_verifications").select("*").eq("id", id).single()).data!;

beforeAll(async () => {
  [candidate, reviewerA, reviewerB] = await Promise.all([createAuthedTestUser("claim-timeout-candidate"), createAuthedTestUser("claim-timeout-a"), createAuthedTestUser("claim-timeout-b")]);
  candidateId = candidate.id;
  reviewerAId = reviewerA.id;
  reviewerBId = reviewerB.id;
  const { error } = await admin.from("mentor_profiles").upsert(
    [
      { user_id: reviewerAId, status: "approved", reviews_verifications: true },
      { user_id: reviewerBId, status: "approved", reviews_verifications: true },
    ],
    { onConflict: "user_id" },
  );
  if (error) throw error;
  const probe = await admin.from("talent_verifications").insert({ user_id: candidateId, status: "pending", review_type: "human" } as never).select("id, requested_at").single();
  if (probe.error) throw probe.error;
  skewMs = new Date(probe.data!.requested_at).getTime() - Date.now();
  await admin.from("talent_verifications").delete().eq("id", probe.data!.id);
}, 60_000);

beforeEach(async () => {
  clk = newClock();
  const ids = created.splice(0);
  if (ids.length) {
    const { error } = await admin.from("talent_verifications").delete().in("id", ids);
    if (error) throw error;
  }
});

afterAll(async () => {
  if (created.length) await admin.from("talent_verifications").delete().in("id", created);
  await admin.from("mentor_profiles").delete().in("user_id", [reviewerAId, reviewerBId]);
  await deleteTestUsers([candidateId, reviewerAId, reviewerBId]);
}, 60_000);

describe("the 72-hour boundary", () => {
  it("a claim one second younger than 72 hours stays claimed", async () => {
    const id = await claimedAgo(72 * HOUR - 1000);
    const { data, error } = await sweep();
    expect(error).toBeNull();
    expect(data).toBe(0);
    expect((await read(id)).status).toBe("claimed");
  });

  it("a claim exactly 72 hours old stays claimed (older than, not at least)", async () => {
    const id = await claimedAgo(72 * HOUR);
    const { data } = await sweep();
    expect(data).toBe(0);
    expect((await read(id)).status).toBe("claimed");
  });

  it("a claim one second older than 72 hours goes back to the pool", async () => {
    const id = await claimedAgo(72 * HOUR + 1000);
    const { data } = await sweep();
    expect(data).toBe(1);
    expect((await read(id)).status).toBe("pending");
  });
});

describe("what a release does to the row", () => {
  it("leaves exactly the state the reviewer's own release leaves: pending, no reviewer, no claim time, and no other column changed", async () => {
    const id = await claimedAgo(STALE);
    const before = await read(id);
    const { data } = await sweep();
    expect(data).toBe(1);
    const after = await read(id);
    expect(after.status).toBe("pending");
    expect(after.reviewer_id).toBeNull();
    expect(after.claimed_at).toBeNull();
    const untouched = (r: Record<string, unknown>) => Object.fromEntries(Object.entries(r).filter(([k]) => !["status", "reviewer_id", "claimed_at"].includes(k)));
    expect(untouched(after)).toEqual(untouched(before));
  });

  it("reaches the same row state as the reviewer releasing it themselves", async () => {
    const mine = await claimedAgo(STALE);
    const theirs = await claimedAgo(1 * HOUR);
    const { data: ok } = await admin.rpc("release_talent_verification_review_claim", { p_reviewer_id: reviewerAId, p_verification_id: theirs });
    expect(ok).toBe(true);
    await sweep();
    const a = await read(mine);
    const b = await read(theirs);
    expect([a.status, a.reviewer_id, a.claimed_at, a.reviewer_payout_ngn, a.decided_at]).toEqual([b.status, b.reviewer_id, b.claimed_at, b.reviewer_payout_ngn, b.decided_at]);
  });

  it("a claimed review with no claim time at all is released (no clock could ever expire it)", async () => {
    const id = await insertRow({ status: "claimed", claimedAt: null });
    const { data, error } = await sweep();
    expect(error).toBeNull();
    // a real sweep in another file may have released it a moment before this call (it has no claim time to wait on), so the count is 0 or 1; the row is what matters
    expect([0, 1]).toContain(data);
    expect((await read(id)).status).toBe("pending");
  });

  it("does not touch the candidate's profile status (the review is still waiting for someone)", async () => {
    await admin.from("profiles").update({ talent_verification_status: "pending" }).eq("id", candidateId);
    await claimedAgo(STALE);
    expect((await sweep()).data, "the release must have happened for the check below to mean anything").toBe(1);
    const { data } = await admin.from("profiles").select("talent_verification_status").eq("id", candidateId).single();
    expect(data!.talent_verification_status).toBe("pending");
  });
});

describe("what a release never touches", () => {
  it("a decided review, however old its claim, keeps its decision, its reviewer and its payout", async () => {
    const verified = await claimedAgo(500 * HOUR, { status: "verified", payout: 6375 });
    const rejected = await claimedAgo(500 * HOUR, { status: "rejected", payout: 6375 });
    const { data } = await sweep();
    expect(data).toBe(0);
    for (const [id, status] of [[verified, "verified"], [rejected, "rejected"]] as const) {
      const row = await read(id);
      expect([row.status, row.reviewer_id, row.reviewer_payout_ngn]).toEqual([status, reviewerAId, 6375]);
      expect(row.claimed_at).not.toBeNull();
    }
  });

  it("a review nobody has claimed is left as it is", async () => {
    const id = await insertRow({ status: "pending", claimedAt: at(-500 * HOUR) });
    const before = await read(id);
    const { data } = await sweep();
    expect(data).toBe(0);
    expect(await read(id)).toEqual(before);
  });

  it("an AI review is never released, whatever state and age it has", async () => {
    const id = await claimedAgo(500 * HOUR, { reviewType: "ai" });
    const { data } = await sweep();
    expect(data).toBe(0);
    const row = await read(id);
    expect([row.status, row.reviewer_id]).toEqual(["claimed", reviewerAId]);
  });

  it("pays nothing and takes nothing back: the payout column is exactly what it was", async () => {
    const id = await claimedAgo(STALE, { payout: 0 });
    expect((await sweep()).data, "the release must have happened for the check below to mean anything").toBe(1);
    const row = await read(id);
    expect([row.status, row.reviewer_payout_ngn]).toEqual(["pending", 0]);
  });
});

describe("the count and repeating the call", () => {
  it("returns how many it released, and releases only the stale ones", async () => {
    const stale = [await claimedAgo(STALE), await claimedAgo(STALE_B), await claimedAgo(STALE_C, { reviewerId: reviewerBId })];
    const fresh = [await claimedAgo(2 * HOUR), await claimedAgo(71 * HOUR)];
    const { data } = await sweep();
    expect(data).toBe(3);
    for (const id of stale) expect((await read(id)).status).toBe("pending");
    for (const id of fresh) expect((await read(id)).status).toBe("claimed");
  });

  it("a second call finds nothing and changes nothing", async () => {
    await claimedAgo(STALE);
    expect((await sweep()).data).toBe(1);
    expect((await sweep()).data).toBe(0);
  });

  it("two calls at the same moment release each row once between them", async () => {
    const ids = await Promise.all([claimedAgo(STALE), claimedAgo(STALE_B), claimedAgo(STALE_C)]);
    const [a, b] = await Promise.all([sweep(), sweep()]);
    expect((a.data as number) + (b.data as number)).toBe(3);
    for (const id of ids) expect((await read(id)).status).toBe("pending");
  });
});

describe("the arguments", () => {
  it("a shorter cut-off releases a claim the 72-hour default would keep", async () => {
    const id = await claimedAgo(25 * HOUR);
    expect((await sweep()).data).toBe(0);
    expect((await sweep({ p_older_than: "24 hours" })).data).toBe(1);
    expect((await read(id)).status).toBe("pending");
  });

  it("accepts the two ends of the allowed cut-off range", async () => {
    expect((await sweep({ p_older_than: "1 hour" })).error).toBeNull();
    expect((await sweep({ p_older_than: "30 days" })).error).toBeNull();
  });

  it.each([["59 minutes"], ["31 days"], ["0 seconds"], ["-5 hours"]])("refuses a cut-off of %s and releases nothing", async (cutoff) => {
    const id = await claimedAgo(STALE);
    const { data, error } = await sweep({ p_older_than: cutoff });
    expect(data).toBeNull();
    expect(error?.code).toBe("22023");
    expect((await read(id)).status).toBe("claimed");
  });

  it("refuses a null cut-off", async () => {
    const id = await claimedAgo(STALE);
    const { error } = await sweep({ p_older_than: null });
    expect(error?.code).toBe("22023");
    expect((await read(id)).status).toBe("claimed");
  });

  it("refuses a clock in the future, so a bad caller cannot make a fresh claim look old", async () => {
    const id = await insertRow({ status: "claimed", claimedAt: new Date().toISOString() });
    const { data, error } = await admin.rpc("release_stale_verification_claims", { p_now: new Date(Date.now() + skewMs + 100 * HOUR).toISOString() });
    expect(data).toBeNull();
    expect(error?.code).toBe("22023");
    expect((await read(id)).status).toBe("claimed");
  });

  it("refuses a null clock", async () => {
    const { error } = await admin.rpc("release_stale_verification_claims", { p_now: null as never });
    expect(error?.code).toBe("22023");
  });

  it("with no arguments it uses the database's own clock and 72 hours", async () => {
    const old = await insertRow({ status: "claimed", claimedAt: new Date(Date.now() + skewMs - 80 * HOUR).toISOString() });
    const fresh = await insertRow({ status: "claimed", claimedAt: new Date(Date.now() + skewMs - 60 * HOUR).toISOString() });
    const { data, error } = await admin.rpc("release_stale_verification_claims");
    expect(error).toBeNull();
    expect(data).toBeGreaterThanOrEqual(1);
    expect((await read(old)).status).toBe("pending");
    expect((await read(fresh)).status).toBe("claimed");
  });
});

describe("who may call it", () => {
  it("the service role can; an anonymous caller is refused at the database", async () => {
    expect((await sweep()).error).toBeNull();
    const { data, error } = await anon.rpc("release_stale_verification_claims" as never, { p_now: clk.now.toISOString() } as never);
    expect(data).toBeNull();
    expect(error?.code).toBe("42501");
  });
});

describe("after a release, with the existing claim and decision functions", () => {
  it("another reviewer can claim the released review, and the first reviewer's late decision is refused", async () => {
    const id = await claimedAgo(STALE);
    await sweep();
    const claim = await claimVerificationReview(reviewerBId, id);
    expect(claim).toEqual({ ok: true, reason: "ok" });
    const late = await resolveVerificationReview(reviewerAId, id, candidateId, true, "late");
    expect(late.status).toBe("error");
    const row = await read(id);
    expect([row.status, row.reviewer_id, row.reviewer_payout_ngn]).toEqual(["claimed", reviewerBId, 0]);
  });

  it("the same reviewer may claim it again", async () => {
    const id = await claimedAgo(STALE);
    await sweep();
    expect(await claimVerificationReview(reviewerAId, id)).toEqual({ ok: true, reason: "ok" });
  });

  it("a decision that lands before the sweep is not undone", async () => {
    const id = await claimedAgo(STALE);
    const decided = await resolveVerificationReview(reviewerAId, id, candidateId, true, "fine");
    expect(decided.status).toBe("success");
    expect((await sweep()).data).toBe(0);
    const row = await read(id);
    expect([row.status, row.reviewer_id, row.reviewer_payout_ngn]).toEqual(["verified", reviewerAId, 6375]);
  });

  it("a decision racing the sweep: exactly one wins and the row is never half-way (released with a payout, or decided and then released)", async () => {
    let decided = 0;
    let released = 0;
    for (let i = 0; i < 8; i++) {
      clk = newClock();
      const id = await claimedAgo(STALE);
      const [decision, swept] = await Promise.all([resolveVerificationReview(reviewerAId, id, candidateId, true, "race"), sweep()]);
      expect(swept.error).toBeNull();
      const row = await read(id);
      if (decision.status === "success") {
        decided += 1;
        expect(swept.data, "the decision won, so the sweep had nothing to release").toBe(0);
        expect([row.status, row.reviewer_id, row.reviewer_payout_ngn]).toEqual(["verified", reviewerAId, 6375]);
      } else {
        released += 1;
        expect(swept.data, "the sweep won, so it released this one row").toBe(1);
        expect([row.status, row.reviewer_id, row.reviewer_payout_ngn, row.claimed_at]).toEqual(["pending", null, 0, null]);
      }
    }
    expect(decided + released).toBe(8);
  }, 60_000);
});

/*
 * The existing readers of the rows the release changes. The release only ever turns a stale 'claimed' human review into 'pending' with no reviewer and no claim time, which is the state the reviewer's own
 * release (release_talent_verification_review_claim, 0142) already produces. The readers are the review queue, "my claims", the review detail, the claim itself, the decision and the candidate's own read of their row (RLS).
 * Every case runs once with nothing stale (the readers must behave exactly as before) and once around a release.
 */
const queueIds = async (who: { client: DB }) => ((await who.client.rpc("talent_verification_review_queue", {})).data ?? []).map((r) => r.id);
const myClaimIds = async (who: { client: DB }) => ((await who.client.rpc("talent_verification_my_claims")).data ?? []).map((r) => r.id);
const detail = async (who: { client: DB }, id: string) => (await who.client.rpc("talent_verification_review_detail", { p_verification_id: id })).data ?? [];
const readRow = async (id: string) => (await admin.from("talent_verifications").select("*").eq("id", id).single()).data!;

async function readersRow(status: "pending" | "claimed", claimedAgoMs: number | null = null, requestedAt?: string): Promise<string> {
  const { data, error } = await admin
    .from("talent_verifications")
    .insert({
      user_id: candidateId,
      status,
      review_type: "human",
      target_role: "Data Analyst",
      reviewer_id: status === "claimed" ? reviewerAId : null,
      claimed_at: claimedAgoMs === null ? null : at(-claimedAgoMs),
      ...(requestedAt ? { requested_at: requestedAt } : {}),
    } as never)
    .select("id")
    .single();
  if (error) throw error;
  created.push(data!.id);
  return data!.id;
}

describe("with nothing stale, the sweep changes nothing any reader sees", () => {
  it("a fresh claim made through the real claim function: every reader answers as before, and the sweep releases nothing", async () => {
    const id = await readersRow("pending");
    expect(await queueIds(reviewerB)).toContain(id);
    expect(await claimVerificationReview(reviewerAId, id)).toEqual({ ok: true, reason: "ok" });
    const before = await readRow(id);

    expect((await sweep()).data).toBe(0);

    expect(await readRow(id)).toEqual(before);
    expect(await queueIds(reviewerB)).not.toContain(id);
    expect(await myClaimIds(reviewerA)).toContain(id);
    expect((await detail(reviewerA, id))[0]?.id).toBe(id);
    expect(await detail(reviewerB, id)).toEqual([]);
    expect(await claimVerificationReview(reviewerBId, id)).toEqual({ ok: false, reason: "ALREADY_CLAIMED" });
  });

  it("the reviewer's own release, a second claim and a decision still work in order with a sweep in between", async () => {
    const id = await readersRow("pending");
    await claimVerificationReview(reviewerAId, id);
    await sweep();
    expect(await releaseVerificationReviewClaim(reviewerAId, id)).toBe(true);
    await sweep();
    expect(await queueIds(reviewerB)).toContain(id);
    expect(await claimVerificationReview(reviewerBId, id)).toEqual({ ok: true, reason: "ok" });
    await sweep();
    expect((await resolveVerificationReview(reviewerBId, id, candidateId, true, "looks right")).status).toBe("success");
    const decided = await readRow(id);
    expect([decided.status, decided.reviewer_id, decided.reviewer_payout_ngn]).toEqual(["verified", reviewerBId, 6375]);
    expect((await sweep()).data).toBe(0);
    expect(await readRow(id)).toEqual(decided);
  });
});

describe("around a release, the readers see the pending state they already know", () => {
  it("the queue, my claims, the detail, the claim and the late release each answer as they do after the reviewer's own release", async () => {
    const id = await readersRow("claimed", STALE);

    // before: claimed by A
    expect(await queueIds(reviewerB)).not.toContain(id);
    expect(await myClaimIds(reviewerA)).toContain(id);
    expect((await detail(reviewerA, id))[0]?.id).toBe(id);
    expect(await claimVerificationReview(reviewerBId, id)).toEqual({ ok: false, reason: "ALREADY_CLAIMED" });

    expect((await sweep()).data).toBe(1);

    // after: back in the pool
    expect(await queueIds(reviewerB)).toContain(id);
    expect(await queueIds(reviewerA)).toContain(id);
    expect(await myClaimIds(reviewerA)).not.toContain(id);
    expect(await detail(reviewerA, id)).toEqual([]);
    expect(await detail(reviewerB, id)).toEqual([]);
    expect(await releaseVerificationReviewClaim(reviewerAId, id), "the former claimant no longer holds anything to release").toBe(false);
    expect(await claimVerificationReview(reviewerBId, id)).toEqual({ ok: true, reason: "ok" });
    expect((await detail(reviewerB, id))[0]?.id).toBe(id);
    expect(await myClaimIds(reviewerB)).toContain(id);
  });

  it("the released review keeps its place in the queue: the request time is not touched", async () => {
    const requestedAt = at(-200 * HOUR);
    const id = await readersRow("claimed", STALE, requestedAt);
    await sweep();
    const listed = ((await reviewerB.client.rpc("talent_verification_review_queue", {})).data ?? []).find((r) => r.id === id);
    expect(listed).toBeDefined();
    expect(new Date(listed!.requested_at).toISOString()).toBe(requestedAt);
  });

  it("the candidate's own view of the row (row security, unchanged) shows an ordinary pending review", async () => {
    const id = await readersRow("claimed", STALE);
    await sweep();
    const { data, error } = await candidate.client.from("talent_verifications").select("id, status, review_type").eq("id", id).single();
    expect(error).toBeNull();
    expect(data).toEqual({ id, status: "pending", review_type: "human" });
  });

  it("a reviewer cannot release a stale claim through the client: the function is not reachable from a signed-in session", async () => {
    await readersRow("claimed", STALE);
    const { data, error } = await reviewerA.client.rpc("release_stale_verification_claims" as never, { p_now: clk.now.toISOString() } as never);
    expect(data).toBeNull();
    expect(error?.code).toBe("42501");
  });
});
