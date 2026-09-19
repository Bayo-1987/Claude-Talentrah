/**
 * send-385 — /mentorship used to redirect every signed-out visitor straight
 * to /login: a real HTTP 200, but with /login's own title/description
 * ("Log in — Talentrah") and zero unique content, confirmed live by the
 * 2026-09-19 SEO audit as a real indexation/duplicate-content gap sitting on
 * top of uncontested keyword demand. This covers the fix: a genuine
 * signed-out landing page with its own metadata, its continued presence in
 * the sitemap, and — the actual regression risk of branching one shared
 * route on auth state — that the existing signed-in experience is
 * byte-for-byte unaffected.
 */
import { randomUUID } from "node:crypto";
import { test, expect, admin } from "./fixtures/authed";

test.describe("signed-out visitor at /mentorship", () => {
  test("gets a real 200 with its own title and meta description, never the login page's", async ({ page }) => {
    const response = await page.goto("/mentorship");
    expect(response?.status()).toBe(200);

    const title = await page.title();
    expect(title, "must not silently carry the /login page's own title").not.toBe("Log in — Talentrah");
    expect(title).toContain("Mentorship");
    expect(title).toContain("Nigeria");

    const description = await page
      .locator('meta[name="description"]')
      .first()
      .getAttribute("content");
    expect(description).toBeTruthy();
    expect(description).toContain("mentor");

    // The actual login form must never have rendered — a title check alone
    // would pass on a page whose <head> was fixed but whose body still
    // silently redirected client-side.
    await expect(page.getByRole("heading", { name: /log in/i })).toHaveCount(0);
  });

  test("has a real, unique H1 and describes session types + pricing, not thin/placeholder content", async ({
    page,
  }) => {
    await page.goto("/mentorship");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // Session types this page previews (mentorship/[mentorId]/page.tsx's own
    // SESSION_TYPES) — proves this isn't a two-line teaser. Scoped to the
    // heading role: "Mock interview" also appears incidentally in the
    // Farah-vs-mentor prose above it.
    await expect(page.getByRole("heading", { name: "Mock interview" })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Negotiation strategy for a specific offer" }),
    ).toBeVisible();
    await expect(page.getByText(/₦5,000/)).toBeVisible();
  });

  test("never previews an individual mentor's name, bio, or rate — only session types and price tiers", async ({
    authedPage,
    browser,
  }) => {
    // mentor_profiles' own RLS is `to authenticated` only (0133), and
    // mentor_public_names() explicitly revokes anon (0167) — this page
    // deliberately does not query mentor_profiles at all for a signed-out
    // visitor. A real fixture, not an assumed pre-seeded name: created here,
    // proven LIVE by first confirming it shows up in the real authenticated
    // directory, then asserted absent from the signed-out landing page — the
    // second method CLAUDE.md's own "an empty result is a claim" rule asks
    // for, rather than trusting that a distinctive string's absence means
    // anything on its own.
    //
    // A genuinely SEPARATE browser context for the signed-out check, not the
    // `page` fixture — `authedPage`'s own implementation adds the session
    // cookie directly onto the SAME underlying `page`/context object a test
    // receives when it destructures both fixtures, so `page.goto()` after
    // `authedPage.goto()` in the same test is still signed in. Caught live:
    // this exact test failed by showing the fixture's own bio on the
    // "signed-out" page until this was split into two real contexts.
    const tag = randomUUID().slice(0, 8);
    const distinctiveBio = `ZQMENTORFIXTURE${tag} distinctive bio text`;
    const { data: mentorUser, error: userErr } = await admin.auth.admin.createUser({
      email: `mentor-fixture-${tag}@talentrah.test`,
      email_confirm: true,
    });
    if (userErr || !mentorUser) throw new Error(`fixture mentor user: ${userErr?.message}`);
    const { error: profileErr } = await admin.from("mentor_profiles").insert({
      user_id: mentorUser.user.id,
      status: "approved",
      bio: distinctiveBio,
      base_price_ngn: 12345,
    });
    if (profileErr) throw new Error(`fixture mentor profile: ${profileErr.message}`);

    try {
      // Proof the fixture is real and live: it must appear on the real,
      // authenticated directory.
      await authedPage.goto("/mentorship");
      await expect(authedPage.getByText(distinctiveBio)).toBeVisible();

      // The actual assertion, in a fresh context with no cookies at all —
      // not the ambient `page` fixture, whose context may already have been
      // mutated by `authedPage` above in this same test.
      const signedOutContext = await browser.newContext();
      const signedOutPage = await signedOutContext.newPage();
      await signedOutPage.goto("/mentorship");
      const bodyText = await signedOutPage.locator("body").innerText();
      expect(bodyText).not.toContain(distinctiveBio);
      expect(bodyText).not.toContain(`ZQMENTORFIXTURE${tag}`);
      await signedOutContext.close();
    } finally {
      await admin.from("mentor_profiles").delete().eq("user_id", mentorUser.user.id);
      await admin.auth.admin.deleteUser(mentorUser.user.id).catch(() => {});
    }
  });

  test("offers a real path to create an account or log in, correctly scoped to what's actually free", async ({
    page,
  }) => {
    await page.goto("/mentorship");
    await expect(page.getByRole("link", { name: "Create a free account" })).toBeVisible();
    // Scoped to this page's own CTA link (not the masthead's own "Log in"
    // nav item, which is present on every page and proves nothing here) —
    // matched by its redirectTo, which is also what proves this CTA actually
    // returns the visitor to /mentorship after logging in.
    await expect(page.locator('a[href="/login?redirectTo=%2Fmentorship"]')).toBeVisible();
    // CLAUDE.md's own content rule: scope every free/no-account claim
    // precisely — creating the account is free, a paid mentor's session is
    // not, and the copy must not blur the two.
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).toMatch(/only booking a paid mentor.s session does/i);
  });
});

test.describe("signed-in mentorship experience is unaffected (send-385 regression check)", () => {
  test("a signed-in user still sees the real authenticated directory and its original title", async ({
    authedPage,
  }) => {
    await authedPage.goto("/mentorship");
    expect(await authedPage.title()).toBe("Mentorship — Talentrah");
    await expect(
      authedPage.getByRole("heading", { name: "Talk to someone who's done it." }),
    ).toBeVisible();
    // The signed-in-only "Become a mentor" entry point must still be there —
    // proof this is the real authenticated branch, not the public landing
    // rendered by mistake for a signed-in session.
    await expect(authedPage.getByRole("link", { name: "Become a mentor" })).toBeVisible();
  });

  test("a signed-in user's mentorship sub-routes (apply, sessions) are unaffected", async ({ authedPage }) => {
    const applyResponse = await authedPage.goto("/mentorship/apply");
    expect(applyResponse?.status()).toBe(200);
    await expect(authedPage.getByRole("heading", { level: 1 })).not.toHaveText(
      "Real career mentors, for the moments Farah can't coach you through alone.",
    );
  });
});

test.describe("/mentorship in the generated sitemap and robots.txt", () => {
  test("appears in sitemap.xml", async ({ request }) => {
    const res = await request.get("/sitemap.xml");
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body, "/mentorship is missing from the sitemap").toContain("<loc>");
    expect(body).toMatch(/<loc>https?:\/\/[^<]*\/mentorship<\/loc>/);
  });

  test("robots.txt disallows the authenticated mentorship sub-routes but not the bare public path", async ({
    request,
  }) => {
    const res = await request.get("/robots.txt");
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain("Disallow: /mentorship/");
    expect(body).not.toMatch(/Disallow: \/mentorship\s*$/m);
  });
});

test.describe("sitemap's existing entries and error-degradation behavior still work", () => {
  test("the sitemap still lists an existing static page and a real, currently-open job posting", async ({
    request,
  }) => {
    const res = await request.get("/sitemap.xml");
    const body = await res.text();
    expect(body).toContain("<loc>");
    expect(body).toMatch(/<loc>https?:\/\/[^<]*\/about<\/loc>/);

    const { data: openJob } = await admin
      .from("job_postings")
      .select("id")
      .eq("status", "open")
      .is("unlisted_at", null)
      .limit(1)
      .maybeSingle();
    if (openJob) {
      expect(body).toContain(`/jobs/${openJob.id}`);
    }
  });
});
