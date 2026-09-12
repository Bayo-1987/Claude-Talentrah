import { test, expect } from "./fixtures/authed";

/**
 * send-186: a signed-in visitor re-finding one of the programmatic SEO
 * landing pages (a bookmark, a repeat search — exactly the visitor most
 * likely to land here twice) was still pitched "Create a free account…"
 * with copy claiming a free account would score roles and let Farah tailor
 * a resume, neither of which is a real offer to someone who already has
 * both. None of `/jobs/in/[city]`, `/jobs/remote/[country]` or `/jobs/remote`
 * ever checked the visitor's session — confirmed by reading each file
 * before this fix, not assumed.
 *
 * Uses `authedPage` (a cookie-seeded session, no UI login) rather than
 * `farah-panel-job-context-switch.spec.ts`'s heavier real-login pattern —
 * nothing here calls an LLM, so there is no reason to pay that cost. Also
 * deliberately NOT the full two-state proof `landing-auth-variant.spec.ts`
 * runs for the marketing homepage's client-side variant switch: these three
 * pages are server-rendered per request (already `force-dynamic`), so
 * there is no client/server race to prove — a signed-in request either
 * contains the anonymous pitch or it does not.
 *
 * Both directions are checked, not just "signed in hides it": a fix that
 * accidentally hid the CTA for EVERYONE would break the actual conversion
 * path for the anonymous visitors these pages exist to convert, and that
 * regression would look identical to this one passing if only the signed-in
 * side were ever asserted.
 */
const ROUTES = ["/jobs/remote", "/jobs/remote/nigeria", "/jobs/in/lagos"];

test.describe("SEO landing pages: the signup pitch only shows to a visitor without an account", () => {
  for (const path of ROUTES) {
    test(`${path} — signed OUT still shows the free-account pitch`, async ({ page }) => {
      const res = await page.goto(path);
      test.skip(res?.status() !== 200, `${path} is below the landing-page threshold right now`);
      await expect(page.getByText("Create a free account to see your match score")).toBeVisible();
    });

    test(`${path} — signed IN shows a real next step, not the anonymous pitch`, async ({
      authedPage,
    }) => {
      const res = await authedPage.goto(path);
      test.skip(res?.status() !== 200, `${path} is below the landing-page threshold right now`);

      await expect(
        authedPage.getByText("Create a free account to see your match score"),
      ).toHaveCount(0);
      // Not just "the old copy is gone" — a REAL destination is there instead.
      const seeScore = authedPage.getByRole("link", { name: "See your match score" });
      await expect(seeScore).toBeVisible();
      const href = await seeScore.getAttribute("href");
      expect(href, `${path}'s signed-in CTA must point at a real /jobs destination`).toMatch(
        /^\/jobs(\?|$)/,
      );
    });
  }
});
