/**
 * The attempt limit on AI resume reviews: two per person per rolling 30 days, claimed and counted in ONE database statement (claim_ai_talent_verification).
 *
 * What counts: an AI review resolved as verified or rejected, charged or flagged. What does not: a pending row, a row the application released (a grader failure or a missing balance deletes it),
 * a human review, a row older than 30 days. A flagged attempt (the resume tried to instruct the grader) is recorded with its flag_source, counts, and is never charged.
 *
 * Database-backed (it runs in CI against the database every migration has been applied to). The grader is mocked: there is no way to make a real model call deterministic, and it is not what
 * this suite tests. tests/talent-directory/verification-runner-attempt-limit.test.ts holds what the runner does with each answer without a database.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { admin, createAuthedTestUser, createTestUser, deleteTestUsers, type TestUser } from "../support/auth";
import { CREDIT_COSTS } from "@/lib/credits/costs";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY"] as const) {
  if (!process.env[key]) throw new Error(`AI verification attempt-limit test cannot run: ${key} is not set.`);
}

const grade = vi.hoisted(() => vi.fn());
vi.mock("@/lib/talent-directory/verification", () => ({
  gradeResumeForVerification: grade,
  VERIFICATION_PASS_THRESHOLD: 70,
}));

const DAY = 86_400_000;
const FLAGGED = { score: 0, passed: false, flagged: true, flagSource: "model" as const, feedback: "Flagged: nothing was graded.", concerns: [] };
const LOW = { score: 20, passed: false, feedback: "Too thin.", concerns: [] };

let userId: string;
let authed: TestUser & { client: SupabaseClient<Database> };

beforeAll(async () => {
  const user = await createTestUser("ai-verification-limit");
  userId = user.id;
  authed = await createAuthedTestUser("ai-verification-limit-api");
}, 90_000);

afterAll(async () => {
  await deleteTestUsers([userId, authed.id]);
  // CI can confirm by this line (and by the 0238-DB-NN test names) that the database-backed tests ran rather than being skipped or not loaded.
  console.info(`[0238-db-tests] ran ${ran} database-backed tests, ids 0238-DB-01..0238-DB-${String(EXPECTED).padStart(2, "0")}`);
}, 60_000);

let ran = 0;
const EXPECTED = 14;

afterEach(async () => {
  ran++;
  grade.mockReset();
  await admin.from("talent_verifications").delete().eq("user_id", userId);
  await admin.from("credit_ledger").delete().eq("user_id", userId);
  await admin.from("profiles").update({ talent_verification_status: "unverified", talent_verification_score: null, talent_verified_at: null }).eq("id", userId);
});

async function setBalance(amount: number) {
  await admin.from("credit_ledger").delete().eq("user_id", userId);
  await admin.from("credit_ledger").insert({ user_id: userId, delta: amount, reason: "admin_adjustment", balance_after: amount });
}

async function seedResolved(n: number, opts: { review_type?: string; ageDays?: number; status?: string } = {}) {
  const at = new Date(Date.now() - (opts.ageDays ?? 1) * DAY).toISOString();
  const rows = Array.from({ length: n }, () => ({ user_id: userId, status: opts.status ?? "rejected", review_type: opts.review_type ?? "ai", requested_at: at, decided_at: at }));
  const { error } = await admin.from("talent_verifications").insert(rows);
  if (error) throw error;
  await admin.from("profiles").update({ talent_verification_status: "rejected" }).eq("id", userId);
}

async function claim() {
  const { data, error } = await admin.rpc("claim_ai_talent_verification", { p_user_id: userId });
  if (error) throw error;
  return data![0];
}

const rowsFor = async () => (await admin.from("talent_verifications").select("status, review_type, flag_source").eq("user_id", userId)).data ?? [];
const profileStatus = async () => (await admin.from("profiles").select("talent_verification_status").eq("id", userId).single()).data!.talent_verification_status;
const chargeRows = async () => (await admin.from("credit_ledger").select("id").eq("user_id", userId).eq("reason", "talent_directory_verification")).data ?? [];

async function runner() {
  return (await import("@/lib/talent-directory/verification-runner")).runTalentVerification;
}

describe("flagged attempts are recorded, counted and never charged", () => {
  it("0238-DB-01: a flagged attempt persists as a rejected AI review with its flag source, and nothing is charged", async () => {
    await setBalance(CREDIT_COSTS.talentDirectoryVerification * 3);
    grade.mockResolvedValue(FLAGGED);
    const run = await runner();
    const r = await run(userId);
    expect(r).toMatchObject({ status: "success", passed: false });
    expect(await rowsFor()).toEqual([{ status: "rejected", review_type: "ai", flag_source: "model" }]);
    expect(await chargeRows(), "a flagged attempt was never graded, so it must not cost credits").toEqual([]);
    expect(await profileStatus()).toBe("rejected");
  });

  it("0238-DB-02: a claimed row is an AI review (review_type written out, not left to the column default) and it counts toward the limit", async () => {
    await setBalance(CREDIT_COSTS.talentDirectoryVerification * 3);
    const first = await claim();
    expect(first.ok).toBe(true);
    const claimed = (await admin.from("talent_verifications").select("review_type, status").eq("id", first.verification_id!).single()).data;
    expect(claimed, "the claim must write review_type 'ai' itself").toEqual({ review_type: "ai", status: "pending" });

    // resolve it and a second claimed row as ordinary rejections: both must count, so the third claim is refused
    await admin.rpc("resolve_talent_verification", { p_verification_id: first.verification_id!, p_user_id: userId, p_verified: false, p_score: 30, p_feedback: "x" });
    const second = await claim();
    expect(second.ok).toBe(true);
    await admin.rpc("resolve_talent_verification", { p_verification_id: second.verification_id!, p_user_id: userId, p_verified: false, p_score: 30, p_feedback: "x" });
    const third = await claim();
    expect(third.ok, "two claimed-and-resolved reviews must use up the limit").toBe(false);
    expect(third.reason).toBe("limit_reached");
  });

  it("0238-DB-03: two flagged attempts use up the limit: the third is refused with no grading, no charge, no new row", async () => {
    await setBalance(CREDIT_COSTS.talentDirectoryVerification * 3);
    grade.mockResolvedValue(FLAGGED);
    const run = await runner();
    expect((await run(userId)).status).toBe("success");
    expect((await run(userId)).status).toBe("success");
    grade.mockClear();

    const third = await run(userId);
    expect(third.status).toBe("error");
    expect(third.message).toMatch(/both of your resume reviews/);
    expect(third.message).toMatch(/The next one opens on \d{1,2} \w+ \d{4}\./);
    expect(grade, "the third attempt must never reach the grader").not.toHaveBeenCalled();
    expect(await chargeRows()).toEqual([]);
    expect(await rowsFor()).toHaveLength(2);
    expect(await profileStatus()).toBe("rejected");
  });

  it("0238-DB-04: an ordinary charged failure counts the same as a flagged one", async () => {
    await setBalance(CREDIT_COSTS.talentDirectoryVerification * 3);
    const run = await runner();
    grade.mockResolvedValueOnce(LOW).mockResolvedValueOnce(FLAGGED);
    expect((await run(userId)).status).toBe("success");
    expect((await run(userId)).status).toBe("success");
    expect((await run(userId)).message).toMatch(/both of your resume reviews/);
    expect(await chargeRows()).toHaveLength(1);
  });
});

describe("what does not count", () => {
  it("0238-DB-05: a grader failure releases the claim and does not count: any number of them leaves both reviews available", async () => {
    await setBalance(CREDIT_COSTS.talentDirectoryVerification * 3);
    grade.mockRejectedValue(new Error("model down"));
    const run = await runner();
    for (let i = 0; i < 3; i++) expect((await run(userId)).status).toBe("error");
    expect(await rowsFor()).toEqual([]);
    expect(await profileStatus()).toBe("unverified");
    expect((await claim()).ok).toBe(true);
  });

  it("0238-DB-06: human reviews do not count", async () => {
    await seedResolved(3, { review_type: "human" });
    const c = await claim();
    expect(c.ok).toBe(true);
    expect(c.verification_id).toBeTruthy();
  });

  it("0238-DB-07: a review decided more than 30 days ago does not count; one decided 29 days ago does", async () => {
    await seedResolved(2, { ageDays: 31 });
    expect((await claim()).ok).toBe(true);
    await admin.from("talent_verifications").delete().eq("user_id", userId);
    await seedResolved(2, { ageDays: 29 });
    const refused = await claim();
    expect(refused.ok).toBe(false);
    expect(refused.reason).toBe("limit_reached");
    // opens when the older of the two leaves the window: about a day from now
    const opens = new Date(refused.next_allowed_at!).getTime() - Date.now();
    expect(opens).toBeGreaterThan(0.9 * DAY);
    expect(opens).toBeLessThan(1.1 * DAY);
  });
});

describe("the claim is one statement: concurrent attempts cannot both get through", () => {
  it("0238-DB-08: one resolved review: three concurrent claims, exactly one proceeds and exactly one pending row exists", async () => {
    await seedResolved(1);
    const results = await Promise.all([claim(), claim(), claim()]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok).every((r) => r.reason === "not_claimable")).toBe(true);
    expect((await rowsFor()).filter((r) => r.status === "pending")).toHaveLength(1);
  });

  it("0238-DB-09: two resolved reviews: three concurrent claims, none proceeds and no row is created", async () => {
    await seedResolved(2);
    const results = await Promise.all([claim(), claim(), claim()]);
    expect(results.filter((r) => r.ok)).toHaveLength(0);
    expect(results.every((r) => r.reason === "limit_reached")).toBe(true);
    expect((await rowsFor()).filter((r) => r.status === "pending")).toHaveLength(0);
    expect(await profileStatus()).toBe("rejected");
  });

  it("0238-DB-10: a human-review claim racing an AI claim on the same person: exactly one pending row is left, every round", async () => {
    const { runTalentVerificationHumanReview } = await import("@/lib/talent-directory/verification-runner");
    for (let round = 1; round <= 8; round++) {
      await admin.from("talent_verifications").delete().eq("user_id", userId);
      await admin.from("profiles").update({ talent_verification_status: round % 2 ? "unverified" : "rejected" }).eq("id", userId);
      await setBalance(CREDIT_COSTS.talentDirectoryHumanReview * 2);

      const [ai, human] = await Promise.all([claim(), runTalentVerificationHumanReview(userId)]);
      const rows = await rowsFor();
      const pending = rows.filter((r) => r.status === "pending");
      expect(pending, `round ${round}: exactly one pending row must be left`).toHaveLength(1);
      expect(rows, `round ${round}: and no other row`).toHaveLength(1);
      expect([ai.ok, human.status === "success"].filter(Boolean), `round ${round}: exactly one of the two claims won`).toHaveLength(1);
      expect(pending[0].review_type, `round ${round}: the row left is the winner's`).toBe(ai.ok ? "ai" : "human");
      expect(await profileStatus()).toBe("pending");
      if (ai.ok) expect(human.status).toBe("error");
      else expect(ai.reason).toBe("not_claimable");
    }
  });
});

describe("fails closed", () => {
  it("0238-DB-11: a person with no profile gets no_profile and no row", async () => {
    const stranger = "00000000-0000-4000-8000-00000000f0f0";
    const { data, error } = await admin.rpc("claim_ai_talent_verification", { p_user_id: stranger });
    expect(error).toBeNull();
    expect(data![0]).toMatchObject({ ok: false, reason: "no_profile", verification_id: null });
    const { count } = await admin.from("talent_verifications").select("id", { count: "exact", head: true }).eq("user_id", stranger);
    expect(count).toBe(0);
  });

  it("0238-DB-12: a verified person is not claimable", async () => {
    await admin.from("profiles").update({ talent_verification_status: "verified" }).eq("id", userId);
    expect((await claim()).reason).toBe("not_claimable");
    expect(await rowsFor()).toEqual([]);
  });
});

describe("no API role can reach it", () => {
  it("0238-DB-13: anon and a signed-in user cannot execute either function, and cannot read or write flag_source", async () => {
    const anon = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
    for (const client of [anon, authed.client]) {
      const c = await client.rpc("claim_ai_talent_verification", { p_user_id: userId });
      expect(c.error?.code, "claim_ai_talent_verification must be service_role only").toBe("42501");
      const f = await client.rpc("resolve_flagged_talent_verification", { p_verification_id: "00000000-0000-4000-8000-000000000001", p_user_id: userId, p_feedback: "x", p_flag_source: "model" });
      expect(f.error?.code, "resolve_flagged_talent_verification must be service_role only").toBe("42501");
    }
    const read = await authed.client.from("talent_verifications").select("flag_source").limit(1);
    expect(read.error?.code).toBe("42501");
    const write = await authed.client.from("talent_verifications").update({ flag_source: "model" }).eq("user_id", authed.id);
    expect(write.error?.code).toBe("42501");
  });

  it("0238-DB-14: flag_source can only be set on a rejected AI review, and only to pattern or model (the table's own check)", async () => {
    const human = await admin.from("talent_verifications").insert({ user_id: userId, status: "rejected", review_type: "human", flag_source: "model" });
    expect(human.error?.message).toMatch(/talent_verifications_flag_source_check/);
    const pending = await admin.from("talent_verifications").insert({ user_id: userId, status: "pending", flag_source: "model" });
    expect(pending.error?.message).toMatch(/talent_verifications_flag_source_check/);
    const odd = await admin.from("talent_verifications").insert({ user_id: userId, status: "rejected", flag_source: "other" });
    expect(odd.error?.message).toMatch(/talent_verifications_flag_source_check/);
  });
});
