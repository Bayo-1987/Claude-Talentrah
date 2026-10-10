/**
 * Tailoring: two requests at the same instant (QA, 9 Oct; stub model, local stack). The one-time free trial and the credit balance are CHECKED before the model runs and COMMITTED after it, so two simultaneous
 * requests can both pass the check. (A) A new account with the free trial unused and 0 credits sends two at once: one run is free; the second must be refused (no credits), not a second free run.
 * (B) An account whose free trial is used and whose balance covers exactly ONE run sends two at once: one succeeds and is charged; the second must be refused, never delivered unpaid. Reads the status codes, the
 * tailored resumes created and the ledger. Minted session, throwaway user; the requests are real POSTs to /api/tailoring.
 */
import { test, expect, admin, seedBaseResume, requireStubbedLlm } from "./fixtures/authed";
import { CREDIT_COSTS } from "../src/lib/credits/costs";

const JD = `We are looking for a backend engineer to design and operate payment APIs at scale. You will work with Node.js, Postgres and distributed systems, own services end to end, review code, and mentor other engineers.`;

async function atOnce(page: import("@playwright/test").Page, n: number, extra: Record<string, unknown> = {}) {
  const rs = await Promise.all(Array.from({ length: n }, () => page.request.post("/api/tailoring", { data: { jdText: JD, ...extra }, timeout: 60_000 })));
  return rs.map((r) => r.status());
}
const twoAtOnce = (page: import("@playwright/test").Page) => atOnce(page, 2);
const tailored = async (userId: string) => ((await admin.from("resumes").select("id").eq("user_id", userId).eq("source", "tailored")).data ?? []).length;
const profile = async (userId: string) => (await admin.from("profiles").select("credits_balance, free_trial_tailoring_used").eq("id", userId).single()).data!;

// TAILOR-RACE-1 (fixed by #906; each of these was red before it).
test("tailoring A: two simultaneous requests on an unused free trial make one free run", async ({ authedPage: page, testUser }) => {
  test.setTimeout(150_000);
  await requireStubbedLlm(page);
  await seedBaseResume(testUser.id);
  expect((await profile(testUser.id)).free_trial_tailoring_used).toBe(false);
  const codes = await twoAtOnce(page);
  const made = await tailored(testUser.id);
  expect.soft(made, `TAILOR-RACE-1: two simultaneous requests on the one-time free trial delivered ${made} runs (status codes ${codes})`).toBe(1);
});

test("tailoring B: two simultaneous requests with credit for exactly one run deliver one paid run", async ({ authedPage: page, testUser }) => {
  test.setTimeout(150_000);
  await requireStubbedLlm(page);
  await seedBaseResume(testUser.id);
  await admin.from("profiles").update({ free_trial_tailoring_used: true }).eq("id", testUser.id);
  const cost = CREDIT_COSTS.tailoringRun;
  await admin.from("credit_ledger").insert({ user_id: testUser.id, delta: cost, reason: "admin_adjustment", balance_after: cost });
  expect((await profile(testUser.id)).credits_balance).toBe(cost);
  const codes = await twoAtOnce(page);
  const made = await tailored(testUser.id);
  const bal = (await profile(testUser.id)).credits_balance;
  expect.soft(made, `TAILOR-RACE-2: credit for one run, two simultaneous requests delivered ${made} runs (status codes ${codes}, balance now ${bal})`).toBe(1);
  expect(bal, "the balance never goes negative").toBeGreaterThanOrEqual(0);
});

test("tailoring A5: five simultaneous requests on an unused free trial make ONE free run and four clean refusals", async ({ authedPage: page, testUser }) => {
  test.setTimeout(150_000);
  await requireStubbedLlm(page);
  await seedBaseResume(testUser.id);
  const codes = await atOnce(page, 5);
  const made = await tailored(testUser.id);
  expect.soft(made, `TAILOR-RACE-1: five at once delivered ${made} runs (status codes ${codes})`).toBe(1);
  expect.soft(codes.filter((c) => c === 200).length).toBe(1);
  expect.soft(codes.filter((c) => c === 500), "TAILOR-RACE-2: the refusals are clean (402), never an empty 500").toHaveLength(0);
  expect((await profile(testUser.id)).free_trial_tailoring_used).toBe(true);
});

test("tailoring C: five simultaneous requests with a cover letter use the free cover-letter trial ONCE", async ({ authedPage: page, testUser }) => {
  test.setTimeout(150_000);
  await requireStubbedLlm(page);
  await seedBaseResume(testUser.id);
  await admin.from("profiles").update({ free_trial_tailoring_used: true }).eq("id", testUser.id);
  const start = 1000;
  await admin.from("credit_ledger").insert({ user_id: testUser.id, delta: start, reason: "admin_adjustment", balance_after: start });
  const codes = await atOnce(page, 5, { includeCoverLetter: true });
  const ok = codes.filter((c) => c === 200).length;
  const spent = start - (await profile(testUser.id)).credits_balance;
  // Each delivered run costs the tailoring price; all but ONE of them also pays the cover-letter price (the first is the free trial).
  const expected = ok * CREDIT_COSTS.tailoringRun + Math.max(0, ok - 1) * CREDIT_COSTS.coverLetterRun;
  expect.soft(spent, `TAILOR-RACE-3: ${ok} delivered runs (codes ${codes}) should cost ${expected} credits, cost ${spent}: the free cover-letter trial was used more than once`).toBe(expected);
});

// TAILOR-RACE-2 (raised to P2): with credit for exactly ONE run, simultaneous requests must give one 200 and clear refusals, never an empty 500, and charge nothing for the refused ones. Red on main (one 200, the rest an empty
// 500 from an uncaught InsufficientCreditsError after the model ran). Live since the fix for it (src/app/api/tailoring/route.ts: a shortfall at the commit is a 402 with the normal message).
test("tailoring D: credit for exactly one run, three at once: one paid run, the others a clear refusal with nothing charged", async ({ authedPage: page, testUser }) => {
  test.setTimeout(150_000);
  await requireStubbedLlm(page);
  await seedBaseResume(testUser.id);
  await admin.from("profiles").update({ free_trial_tailoring_used: true }).eq("id", testUser.id);
  const cost = CREDIT_COSTS.tailoringRun;
  await admin.from("credit_ledger").insert({ user_id: testUser.id, delta: cost, reason: "admin_adjustment", balance_after: cost });
  const rs = await Promise.all([1, 2, 3].map(() => page.request.post("/api/tailoring", { data: { jdText: JD }, timeout: 60_000 })));
  const codes = rs.map((r) => r.status());
  expect(codes.filter((c) => c === 200), `exactly one run is delivered (codes ${codes})`).toHaveLength(1);
  // The burst limit (2 starts per 15 s per user) may refuse the third request up front with a 429 and a message that says a run is already in progress; a request that got past it and lost the spend
  // is a 402 about credits. Either is a clear refusal; a 500, or a refusal with no message, is the bug.
  for (const r of rs.filter((x) => x.status() !== 200)) {
    expect([402, 429], "a refused request is a 402 (not enough credits) or a 429 (a run is already in progress), never a 500").toContain(r.status());
    const body = (await r.json().catch(() => null)) as { error?: string } | null;
    expect(body?.error, "...with a message the person can read").toMatch(r.status() === 402 ? /credit/i : /already in progress/i);
  }
  expect(await tailored(testUser.id), "one tailored resume, none for the refused requests").toBe(1);
  expect((await profile(testUser.id)).credits_balance, "charged for the one delivered run only, never below zero").toBe(0);
});
