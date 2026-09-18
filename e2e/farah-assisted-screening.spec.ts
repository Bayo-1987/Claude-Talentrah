/**
 * send-345 Part B (0176) — "Let Farah screen this for you," end to end: an
 * employer turns Farah mode on for a free_text question, funds the ad
 * wallet for exactly ONE review, a seeker answers TWO farah-mode questions
 * on the same application, and the employer reads back a genuinely
 * completed Farah annotation on one answer and a "balance too low" note on
 * the other — from the SAME concurrent pair of `after()`-deferred reviews
 * racing the same wallet.
 *
 * WHY ONE WALLET FUNDED FOR EXACTLY ONE REVIEW, RATHER THAN TWO SEPARATE
 * FIXTURES (one funded org, one empty org): both `runFarahScreeningReview`
 * calls fire concurrently from the same `applyWithScreeningAction` call
 * (see that file's own `after()` loop) against the SAME
 * `ad_wallets.balance_ngn`, and only enough balance for one charge exists.
 * Which of the two questions wins the race is not something this test
 * controls or needs to — `record_farah_screening_review`'s own row lock
 * (0176) guarantees exactly one debit succeeds regardless of ordering, so
 * the real assertion is "exactly one of the two ends up completed, the
 * other insufficient_balance", not "question A always wins." That is a
 * genuine, real-LLM proof of the wallet-race property the DB-level test
 * (tests/employer/farah-screening-review.test.ts) already pins with a
 * synchronous, deterministic double-call — this is the same guarantee
 * under the actual concurrent, non-deterministic shape production hits.
 *
 * This calls the REAL configured LLM provider, same as jd-demo.spec.ts
 * already does elsewhere in this suite (90s-class timeouts, no mock at the
 * e2e layer) — there is no way to swap `@/lib/llm` from inside a
 * `next build && next start` server the way vitest's `vi.mock` can.
 *
 * Sabotage-verified: temporarily made `FarahReviewNote` (applicant-list.tsx)
 * always render null regardless of review state, confirmed this test's own
 * polling loop timed out waiting for a tier/top-up note that could no
 * longer appear, then restored the real component and re-confirmed green.
 */
import { randomUUID } from "node:crypto";
import { test as base, expect, type Page } from "@playwright/test";
import { admin, seedBaseResume } from "./fixtures/authed";
import { createServerClient } from "@supabase/ssr";
import { runCleanups } from "../tests/support/teardown";
import { deleteOrgsCascade } from "../tests/support/delete-orgs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const REVIEW_COST_NGN = 100;

interface SessionCookie {
  name: string;
  value: string;
}

/** Identical to screening-questions.spec.ts's own helper — mints a real, verifiable session with no login UI. */
async function mintSessionCookie(email: string): Promise<SessionCookie> {
  const { data: link, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw error;
  const jar = new Map<string, string>();
  const captured: SessionCookie[] = [];
  const ssr = createServerClient(SUPABASE_URL, ANON_KEY, {
    cookies: {
      getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
      setAll: (list) => {
        for (const c of list) {
          jar.set(c.name, c.value);
          captured.push({ name: c.name, value: c.value });
        }
      },
    },
  });
  const { error: otpErr } = await ssr.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
  if (otpErr) throw otpErr;
  if (!captured.length) throw new Error("no session cookie produced");
  return captured[0];
}

/**
 * The reviews land via `after()` on the SEEKER's own apply request, fully
 * decoupled from the employer's page — so the employer side has to poll,
 * not just wait once. Reloads the applicants page and re-opens "View
 * answers" (a fresh Server Action fetch each time, per applicant-list.tsx's
 * own `toggleAnswers`) until both farah-mode questions show a terminal
 * state (a tier, or the balance-too-low note) or the deadline passes.
 */
async function waitForBothFarahReviews(page: Page, applicantsUrl: string, deadlineMs: number): Promise<string> {
  const start = Date.now();
  let lastBody = "";
  while (Date.now() - start < deadlineMs) {
    await page.goto(applicantsUrl);
    const toggle = page.getByRole("button", { name: "View answers" });
    if (await toggle.isVisible().catch(() => false)) {
      await toggle.click();
      // The click only starts the Server Action fetch — reading the body
      // immediately after would just capture "Loading answers…" every
      // single iteration, forever. Wait for that fetch to actually settle
      // (it's a plain DB read, not the LLM call itself, so this resolves in
      // well under a second normally) before treating the snapshot as real.
      await page
        .getByText("Loading answers…")
        .waitFor({ state: "detached", timeout: 10_000 })
        .catch(() => {});
    }
    const panel = page.locator("body");
    lastBody = (await panel.textContent()) ?? "";
    const hasCompleted = /Farah — (Strong|Adequate|Weak):/.test(lastBody);
    const hasSkipped = lastBody.includes("your ad wallet balance was too low");
    if (hasCompleted && hasSkipped) return lastBody;
    await page.waitForTimeout(3000);
  }
  return lastBody;
}

base.describe("Farah-assisted screening review — funded and zero-balance, same wallet", () => {
  let employerUserId: string;
  let seekerUserId: string;
  let orgId: string;

  base.afterEach(async () => {
    await runCleanups(
      [
        "farah-review e2e organisation",
        async () => {
          if (orgId) await deleteOrgsCascade(admin, [orgId]);
        },
      ],
      [
        "farah-review e2e users",
        async () => {
          if (employerUserId) await admin.auth.admin.deleteUser(employerUserId).catch(() => {});
          if (seekerUserId) await admin.auth.admin.deleteUser(seekerUserId).catch(() => {});
        },
      ],
    );
  });

  base(
    "one question ends up Farah-reviewed, the other reports a too-low balance — from the same wallet, same application",
    async ({ browser, baseURL }) => {
      base.setTimeout(150_000);
      const domain = `${randomUUID().slice(0, 12)}.talentrah.test`;
      const employerEmail = `employer-${randomUUID()}@${domain}`;
      const seekerEmail = `seeker-${randomUUID()}@${domain}`;

      const { data: employerUser, error: eErr } = await admin.auth.admin.createUser({
        email: employerEmail,
        email_confirm: true,
      });
      if (eErr) throw eErr;
      employerUserId = employerUser.user.id;

      const { data: seekerUser, error: sErr } = await admin.auth.admin.createUser({
        email: seekerEmail,
        email_confirm: true,
      });
      if (sErr) throw sErr;
      seekerUserId = seekerUser.user.id;
      // A resume-less seeker now sees "Add a resume to apply" instead of
      // the self-assessment gate at all (see e2e/apply-requires-resume.spec.ts)
      // — correct, but this test is about the Farah review/wallet pipeline,
      // not that gate, so it needs a seeker who can actually reach Apply.
      await seedBaseResume(seekerUserId);

      const orgName = `E2E Farah Review Co ${randomUUID().slice(0, 8)}`;
      const { data: org, error: orgErr } = await admin
        .from("organizations")
        .insert({ name: orgName, created_by: employerUserId, verified: true })
        .select("id")
        .single();
      if (orgErr || !org) throw new Error(`fixture org: ${orgErr?.message}`);
      orgId = org.id;
      const { error: memErr } = await admin
        .from("organization_members")
        .insert({ organization_id: orgId, user_id: employerUserId, role: "owner" });
      if (memErr) throw new Error(`fixture membership: ${memErr.message}`);

      // Funded for exactly ONE review — see this file's own header for why
      // this is the point, not an oversight.
      const { error: walletErr } = await admin
        .from("ad_wallets")
        .insert({ organization_id: orgId, balance_ngn: REVIEW_COST_NGN });
      if (walletErr) throw new Error(`fixture wallet: ${walletErr.message}`);

      const { data: job, error: jobErr } = await admin
        .from("job_postings")
        .insert({
          source_type: "internal",
          organization_id: orgId,
          company_name: orgName,
          title: `E2E Farah Review Role ${randomUUID().slice(0, 6)}`,
          description: "We are hiring for a role that involves real written communication.",
          structured_jd: {},
          status: "open",
          posted_at: new Date().toISOString(),
          dedup_fingerprint: randomUUID(),
        })
        .select("id")
        .single();
      if (jobErr || !job) throw new Error(`fixture job: ${jobErr?.message}`);
      const jobId = job.id;

      // Two farah-mode free_text questions, created directly (the editor's
      // own toggle is covered by a component-level check; this file is
      // about the money-and-review pipeline, not re-proving the form works).
      const { error: qErr } = await admin.from("job_posting_screening_questions").insert([
        {
          job_posting_id: jobId,
          question_text: "Why does this role interest you?",
          question_type: "free_text",
          required: false,
          sort_order: 0,
          screening_mode: "farah",
        },
        {
          job_posting_id: jobId,
          question_text: "What would you bring to this team?",
          question_type: "free_text",
          required: false,
          sort_order: 1,
          screening_mode: "farah",
        },
      ]);
      if (qErr) throw new Error(`fixture questions: ${qErr.message}`);

      const url = new URL(baseURL ?? "http://localhost:3000");

      // ---- Seeker: apply, answering both farah-mode questions -------------
      const seekerCookie = await mintSessionCookie(seekerEmail);
      const seekerContext = await browser.newContext();
      await seekerContext.addCookies([
        { name: seekerCookie.name, value: seekerCookie.value, domain: url.hostname, path: "/" },
      ]);
      const seekerPage = await seekerContext.newPage();

      await seekerPage.goto(`/jobs/${jobId}`);
      await expect(seekerPage.getByText("A quick self-assessment before you apply")).toBeVisible();
      await seekerPage
        .getByLabel(/Why does this role interest you\?/)
        .fill("I've spent three years building payment infrastructure and this role's merchant-onboarding problem is exactly what I want to work on next.");
      await seekerPage
        .getByLabel(/What would you bring to this team\?/)
        .fill("Deep hands-on experience shipping production payment APIs, plus a habit of writing things down so the next engineer isn't guessing.");

      const submitButton = seekerPage.getByRole("button", { name: "Submit application" });
      await expect(submitButton).toBeEnabled();
      await submitButton.click();
      await expect(seekerPage.getByText("A quick self-assessment before you apply")).toHaveCount(0, {
        timeout: 20_000,
      });
      await seekerContext.close();

      // ---- Employer: poll until both reviews have landed -------------------
      const employerCookie = await mintSessionCookie(employerEmail);
      const employerContext = await browser.newContext();
      await employerContext.addCookies([
        { name: employerCookie.name, value: employerCookie.value, domain: url.hostname, path: "/" },
      ]);
      const employerPage = await employerContext.newPage();

      const applicantsUrl = `/employer/jobs/${jobId}/applicants`;
      const finalBody = await waitForBothFarahReviews(employerPage, applicantsUrl, 100_000);

      expect(finalBody, "expected exactly one completed Farah tier").toMatch(/Farah — (Strong|Adequate|Weak):/);
      expect(finalBody, "expected the other question to report insufficient balance").toContain(
        "your ad wallet balance was too low",
      );
      // Exactly one of each — not both completed, not both skipped. A
      // regression that let the wallet be double-charged (or never charged
      // at all) would show up here as 0 or 2 of either marker.
      const completedCount = (finalBody.match(/Farah — (Strong|Adequate|Weak):/g) ?? []).length;
      expect(completedCount).toBe(1);

      const { data: wallet } = await admin.from("ad_wallets").select("balance_ngn").eq("organization_id", orgId).single();
      expect(wallet?.balance_ngn, "exactly one charge should have been taken").toBe(0);

      await employerContext.close();
    },
  );
});
