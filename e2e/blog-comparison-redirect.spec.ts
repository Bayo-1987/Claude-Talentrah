import { test, expect } from "@playwright/test";

/**
 * send-436 — this pins the ACTUAL served HTTP response for send-429's
 * redirect, not just that `next.config.ts`'s `redirects()` entry exists.
 *
 * That distinction is the whole point: the config was correct from the
 * moment PR #525 merged, and a config-existence check would have passed
 * the entire time real traffic was still getting a live 200 with the old
 * post's content in production — an ISR-cached full-page response for this
 * exact path, generated before the redirect was ever deployed, kept being
 * served ahead of the new routing decision. Neither "an hour passes" nor
 * "a redeploy happens" — the two conditions blog/[slug]/page.tsx's own
 * `revalidate = 3600` comment names as self-healing triggers for a stale
 * ISR entry — actually cleared it; only further real wall-clock time did,
 * with no code change. A test that only imported/inspected the redirects()
 * array would never have caught that gap, because the gap lived entirely
 * in what a real request over the wire actually got back.
 *
 * `maxRedirects: 0` is load-bearing: Playwright's `request.get()` follows
 * redirects by default, which would silently paper over exactly the
 * distinction this test exists to catch (a 200 with the right final
 * content looks identical to a followed 308, from the caller's side,
 * unless redirects are disabled and the intermediate response inspected
 * directly).
 */
test("the retired comparison-post slug serves a real 308 to the canonical post, not the old page", async ({
  request,
}) => {
  const res = await request.get("/blog/ai-job-search-tools-nigeria-africa-compared", {
    maxRedirects: 0,
  });

  expect(res.status(), "MONEY BUG target: this must be a redirect, not the old page still rendering").toBe(308);
  expect(res.headers()["location"]).toBe("/blog/ai-job-search-tools-nigeria-africa");
});

test("the canonical post the redirect points at is itself a real, live page", async ({ request }) => {
  const res = await request.get("/blog/ai-job-search-tools-nigeria-africa");
  expect(res.status()).toBe(200);
});
