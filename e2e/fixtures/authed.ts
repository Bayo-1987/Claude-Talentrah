/**
 * Reusable Playwright fixtures for signed-in end-to-end tests.
 *
 * ── Using this in a new test ────────────────────────────────────────────
 *
 *   import { test, expect } from "./fixtures/authed";
 *
 *   test("something that needs a signed-in user", async ({ authedPage, testUser }) => {
 *     await authedPage.goto("/jobs");
 *     // testUser.id / testUser.email are available if you need to assert
 *     // against the database directly.
 *   });
 *
 * Each test gets a FRESH throwaway user, created before it and deleted
 * after (which cascades every row it produced). Tests therefore never
 * inherit each other's credits, tracker entries or resumes — the previous
 * e2e specs' habit of leaning on the shared seeded demo account is what
 * makes that kind of suite quietly order-dependent.
 *
 * ── How the session is established ──────────────────────────────────────
 *
 * Not by typing into the login form. Passwords in a UI flow are slow,
 * brittle, and would make every test depend on the login page continuing to
 * work. Instead this reuses the same admin-generated magic-link exchange the
 * RLS suite uses (tests/rls/cross-user.test.ts): create the user with the
 * service role, mint a one-time link, redeem it for a real session, and hand
 * the resulting `@supabase/ssr` cookie to the browser context.
 *
 * The cookie is produced by the ssr library itself rather than hand-rolled,
 * so its name and encoding stay correct if the library changes them.
 *
 * ── Why the model is stubbed ────────────────────────────────────────────
 *
 * The app under test must be started with `LLM_PROVIDER=stub` (see
 * src/lib/llm/stub-provider.ts and the e2e job in .github/workflows/ci.yml).
 * That swaps only the provider: routes, gating, credit ledger and UI are all
 * the real thing. `requireStubbedLlm()` below asserts it, because a golden
 * path silently making real model calls would be slow, costly, and flaky on
 * a shared rate limit.
 */
import { test as base, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { randomUUID } from "node:crypto";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

export interface TestUser {
  id: string;
  email: string;
}

interface SessionCookie {
  name: string;
  value: string;
}

async function createUserWithSession(): Promise<{ user: TestUser; cookie: SessionCookie }> {
  const email = `e2e-${randomUUID()}@talentrah.test`;
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (createErr) throw createErr;

  // Everything after creation is wrapped so a failure here can't orphan the
  // account. Playwright only runs a fixture's teardown if setup reached
  // use(), so an error while minting the session — a transient auth rate
  // limit is the realistic one — would otherwise leave a user behind on
  // every failed run. Observed: two orphans accumulated before this guard.
  try {
    return await mintSession(created.user.id, email);
  } catch (err) {
    await admin.auth.admin.deleteUser(created.user.id).catch(() => {});
    throw err;
  }
}

async function mintSession(
  userId: string,
  email: string,
): Promise<{ user: TestUser; cookie: SessionCookie }> {
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkErr) throw linkErr;

  // Redeem through @supabase/ssr with an in-memory cookie jar so the library
  // produces the exact cookie the server expects, rather than guessing its
  // name or encoding here.
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
  const { error: otpErr } = await ssr.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: "magiclink",
  });
  if (otpErr) throw otpErr;
  if (!captured.length) throw new Error("No session cookie was produced.");

  return { user: { id: userId, email }, cookie: captured[0] };
}

/**
 * Fails loudly if the app under test would make real model calls.
 *
 * The probe route answers 200 only when the stub is active and 404
 * otherwise, so "not ok" and "not stubbed" are the same signal — there is no
 * way to read this as confirmed when it isn't.
 */
export async function requireStubbedLlm(page: Page): Promise<void> {
  const res = await page.request.get("/api/e2e/llm-provider");
  if (!res.ok()) {
    throw new Error(
      "The app under test is NOT running the stub LLM provider. Refusing to drive the golden path against a real model — start it with LLM_PROVIDER=stub.",
    );
  }
}

/**
 * Gives the user a base resume.
 *
 * Stands in for the resume-upload step rather than driving it. Upload runs a
 * real PDF/DOCX through `pdf-parse`/`mammoth` and a heuristic extractor with
 * an LLM fallback — binary-fixture-dependent, and the fallback would defeat
 * the point of stubbing the model. That parsing has its own unit coverage
 * (tests/resume/); what the golden path needs from it is only the artifact.
 */
export async function seedBaseResume(userId: string): Promise<void> {
  const { error } = await admin.from("resumes").insert({
    user_id: userId,
    title: "E2E base resume",
    is_base: true,
    source: "uploaded",
    structured_content: {
      contact: { name: "E2E Tester", email: "e2e@talentrah.test", location: "Lagos, Nigeria" },
      summary: "Backend engineer with six years building payment systems.",
      experience: [
        {
          title: "Senior Engineer",
          company: "Paystack",
          location: "Lagos",
          startDate: "2021",
          endDate: "2026",
          description: "Built and operated payment APIs at scale.",
        },
      ],
      education: [{ school: "University of Lagos", degree: "BSc", field: "Computer Science" }],
      skills: ["Node.js", "Postgres", "TypeScript"],
      projects: [],
      certifications: [],
    },
  });
  if (error) throw error;
}

/**
 * Puts credits on the account.
 *
 * Stands in for a purchase: a real Paystack round-trip is explicitly out of
 * scope for e2e, and the payment path already has live verification of its
 * own. The ledger write here is the same one fulfilment performs, so what
 * the test then exercises — the gate, the spend, the balance the user sees —
 * is the genuine code path.
 */
export async function grantTestCredits(userId: string, amount: number): Promise<void> {
  const { error } = await admin.from("credit_ledger").insert({
    user_id: userId,
    delta: amount,
    reason: "admin_adjustment",
    balance_after: amount,
  });
  if (error) throw error;
}

export const test = base.extend<{ testUser: TestUser; authedPage: Page }>({
  testUser: async ({}, use) => {
    const { user, cookie } = await createUserWithSession();
    // Stashed so authedPage can reuse the same session without minting a
    // second one for the same test.
    sessionCookies.set(user.id, cookie);
    await use(user);
    sessionCookies.delete(user.id);
    // Deleting the auth user cascades every row the test created.
    await admin.auth.admin.deleteUser(user.id);
  },

  authedPage: async ({ page, testUser, baseURL }, use) => {
    const cookie = sessionCookies.get(testUser.id)!;
    const url = new URL(baseURL ?? "http://localhost:3000");
    await page.context().addCookies([
      {
        name: cookie.name,
        value: cookie.value,
        domain: url.hostname,
        path: "/",
        httpOnly: false,
        secure: url.protocol === "https:",
        sameSite: "Lax",
      },
    ]);
    await use(page);
  },
});

const sessionCookies = new Map<string, SessionCookie>();

export { expect };
