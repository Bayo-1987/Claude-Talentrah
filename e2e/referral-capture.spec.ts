/**
 * Referral capture on any route — the mechanism a scholarship share actually
 * depends on. `getReferralUrl` only ever built `/signup?ref=CODE`; a
 * scholarship share has to land on the scholarship itself (a signup wall in
 * front of shared content is how a WhatsApp share dies), so the code has to
 * be picked up wherever the visitor lands — src/proxy.ts's `captureReferral`
 * — not just on /signup.
 *
 * This is a real end-to-end test rather than a unit test of `captureReferral`
 * in isolation, deliberately: the function's only real job is a first-party
 * cookie set on a real `NextResponse` and a real database round trip
 * (`is_valid_referral_code`, migration 0098) — both of which a mocked
 * NextRequest/NextResponse pair would have to fake convincingly to be worth
 * anything, and the actual risk (a real browser silently dropping or keeping
 * the wrong cookie) only shows up against a real server and a real cookie
 * jar.
 *
 * Uses a fixed scholarship (Gates Cambridge Scholarship), same as
 * e2e/public-scholarship-page.spec.ts and for the same reason: resolved by
 * natural key so a fresh per-run local Supabase stack's generated ids don't
 * matter.
 */
import { randomUUID } from "node:crypto";
import type { Cookie } from "@playwright/test";
import { test, expect, admin } from "./fixtures/authed";
import { REFERRAL_COOKIE } from "@/lib/referrals/cookie";

const DEMO_PASSWORD = process.env.DEMO_PASSWORD;
let SCHOLARSHIP: string;

/** Every throwaway referrer this file creates, torn down in afterAll. */
const created: string[] = [];

/**
 * A per-user subdomain, not a shared `@talentrah.test` — same reasoning as
 * fixtures/authed.ts's own `createUserWithSession`: a shared domain across
 * this file's several throwaway users would make them "colleagues" for
 * employer-domain-verification purposes, and one leaked verified org has
 * already been shown (in that file's own comment) to break unrelated specs.
 */
function testEmail(tag: string): string {
  return `e2e-refcap-${tag}-${randomUUID()}@${randomUUID().slice(0, 12)}.talentrah.test`;
}

async function makeReferrer(tag: string): Promise<{ id: string; code: string }> {
  const email = testEmail(tag);
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (error) throw error;
  created.push(data.user.id);
  const { data: profile } = await admin
    .from("profiles")
    .select("referral_code")
    .eq("id", data.user.id)
    .single();
  return { id: data.user.id, code: profile!.referral_code };
}

test.beforeAll(async () => {
  const { data, error } = await admin
    .from("scholarships")
    .select("id")
    .eq("program_name", "Gates Cambridge Scholarship")
    .eq("moderation_status", "verified")
    .single();
  if (error || !data) {
    throw new Error(
      `seeded "Gates Cambridge Scholarship" not found — run \`npm run seed:catalog\`: ${error?.message ?? "no row"}`,
    );
  }
  SCHOLARSHIP = data.id;
});

test.afterAll(async () => {
  await Promise.all(created.map((id) => admin.auth.admin.deleteUser(id).catch(() => {})));
});

function refCookie(cookies: Cookie[]) {
  return cookies.find((c) => c.name === REFERRAL_COOKIE);
}

test("a valid ?ref= on the scholarship page sets a first-party cookie", async ({ page }) => {
  const referrer = await makeReferrer("valid");
  await page.goto(`/scholarships/${SCHOLARSHIP}?ref=${referrer.code}`);

  const cookie = refCookie(await page.context().cookies());
  expect(cookie, "no referral cookie was set for a real code").toBeTruthy();
  expect(cookie!.value).toBe(referrer.code);
  expect(cookie!.httpOnly).toBe(true);
  expect(cookie!.sameSite).toBe("Lax");
});

test("an unknown ?ref= sets nothing — no error, no redirect, no cookie", async ({ page }) => {
  const res = await page.goto(`/scholarships/${SCHOLARSHIP}?ref=NOTAREALCODE`);
  expect(res?.status(), "an unknown code must not break the page").toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(refCookie(await page.context().cookies())).toBeUndefined();
});

test("a malformed ?ref= never reaches the database — still no cookie", async ({ page }) => {
  // Not 8 hex chars — REFERRAL_CODE_PATTERN must reject this before any RPC call.
  const res = await page.goto(
    `/scholarships/${SCHOLARSHIP}?ref=${encodeURIComponent("' OR '1'='1")}`,
  );
  expect(res?.status(), "a malformed code must not break the page").toBe(200);
  expect(refCookie(await page.context().cookies())).toBeUndefined();
});

test(
  "SABOTAGE-PROOF TARGET: first-touch — a second real code does NOT overwrite an existing cookie",
  async ({ page }) => {
    const first = await makeReferrer("first");
    const second = await makeReferrer("second");

    await page.goto(`/scholarships/${SCHOLARSHIP}?ref=${first.code}`);
    expect(refCookie(await page.context().cookies())?.value).toBe(first.code);

    // The attempted overwrite. If first-touch were broken, this would flip
    // the cookie to `second.code` — that is the failure this test exists to
    // catch, not a hypothetical.
    await page.goto(`/scholarships/${SCHOLARSHIP}?ref=${second.code}`);
    const cookie = refCookie(await page.context().cookies());
    expect(cookie?.value, "FIRST-TOUCH BROKEN: a later sharer's code overwrote the first").toBe(
      first.code,
    );
  },
);

test("a signed-in visitor clicking a friend's link gets no referral cookie", async ({
  authedPage,
}) => {
  const referrer = await makeReferrer("signedin");
  await authedPage.goto(`/scholarships/${SCHOLARSHIP}?ref=${referrer.code}`);
  expect(
    refCookie(await authedPage.context().cookies()),
    "an existing session must not pick up a referral cookie",
  ).toBeUndefined();
});

test("signup with no ?ref= in the URL but a live cookie still creates the referral", async ({
  page,
}) => {
  test.skip(!DEMO_PASSWORD, "DEMO_PASSWORD is not set");
  const referrer = await makeReferrer("cookie-signup");

  // The visit that plants the cookie — the scholarship page, not /signup.
  await page.goto(`/scholarships/${SCHOLARSHIP}?ref=${referrer.code}`);
  expect(refCookie(await page.context().cookies())?.value).toBe(referrer.code);

  // Signup itself carries no ?ref= at all — SignupForm/signUpAction must
  // fall back to the cookie, exactly the shape a scholarship share produces:
  // the visitor read the listing, THEN decided to sign up from the nav, with
  // nothing left in the URL to carry the code.
  const email = testEmail("signup");
  await page.goto("/signup");
  await page.getByLabel("First name").fill("Cookie");
  await page.getByLabel("Last name").fill("Fallback");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Country").selectOption("Nigeria");
  await page.getByRole("checkbox").check();
  await page.getByLabel("Password", { exact: true }).fill("Str0ng-Enough-Passw0rd!");
  await page.getByRole("button", { name: "Create a free account" }).click();
  await page.waitForURL(/\/(onboarding|signup\/check-email)/);

  const { data: newUser } = await admin
    .from("profiles")
    .select("id, referred_by")
    .eq("email", email)
    .single();
  expect(newUser, "the account was not created").toBeTruthy();
  created.push(newUser!.id);
  expect(
    newUser!.referred_by,
    "the cookie-sourced code did not attribute — the fallback did not run",
  ).toBe(referrer.id);

  const { data: referralRow } = await admin
    .from("referrals")
    .select("id, status")
    .eq("referrer_id", referrer.id)
    .eq("referred_user_id", newUser!.id)
    .maybeSingle();
  expect(referralRow, "no referrals row was created from the cookie fallback").toBeTruthy();

  // The cookie's job is done — it must not persist to keep re-attributing
  // this browser's NEXT signup to a referral that has already happened.
  expect(
    refCookie(await page.context().cookies()),
    "the referral cookie was not cleared after signup",
  ).toBeUndefined();
});

test("self-referral through a cookie-sourced code is still refused by the existing guard", async ({
  page,
}) => {
  test.skip(!DEMO_PASSWORD, "DEMO_PASSWORD is not set");
  // Same email, Gmail-dot-normalised — the exact shape 0036 (and
  // tests/referrals/referrals.test.ts) already pin as a self-referral. This
  // test's only job is confirming a COOKIE-sourced code reaches that same
  // guard unchanged, not re-proving the guard itself.
  const tag = randomUUID().slice(0, 8);
  const referrerEmail = `e2e-refcap-self-${tag}.x@gmail.com`;
  const referredEmail = `e2e-refcap-self-${tag}x@gmail.com`;

  const { data: referrerUser, error } = await admin.auth.admin.createUser({
    email: referrerEmail,
    email_confirm: true,
  });
  if (error) throw error;
  created.push(referrerUser.user.id);
  const { data: profile } = await admin
    .from("profiles")
    .select("referral_code")
    .eq("id", referrerUser.user.id)
    .single();

  await page.goto(`/scholarships/${SCHOLARSHIP}?ref=${profile!.referral_code}`);
  expect(refCookie(await page.context().cookies())?.value).toBe(profile!.referral_code);

  await page.goto("/signup");
  await page.getByLabel("First name").fill("Self");
  await page.getByLabel("Last name").fill("Referral");
  await page.getByLabel("Email").fill(referredEmail);
  await page.getByLabel("Country").selectOption("Nigeria");
  await page.getByRole("checkbox").check();
  await page.getByLabel("Password", { exact: true }).fill("Str0ng-Enough-Passw0rd!");
  await page.getByRole("button", { name: "Create a free account" }).click();
  await page.waitForURL(/\/(onboarding|signup\/check-email)/);

  const { data: newUser } = await admin
    .from("profiles")
    .select("id, referred_by")
    .eq("email", referredEmail)
    .single();
  created.push(newUser!.id);
  expect(
    newUser!.referred_by,
    "SELF-REFERRAL: a cookie-sourced code paid out a dotted-alias self-referral",
  ).toBeNull();
});
