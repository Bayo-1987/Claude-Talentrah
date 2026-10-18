import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test, expect } from "@playwright/test";
import { waitForWorkerControl, registrationScopes } from "./support/pwa";

/**
 * Embed pages never register and are never intercepted (v2.1 section A).
 *
 * /embed/jobs/[orgId] is served to third-party iframes as its own standalone HTML under a strict CSP. With the worker ALREADY active for the
 * site: the embed response is delivered unchanged (not by the worker), no registration happens from a frame, and the page contains no
 * reference to the worker. Any organisation id gives the same neutral page when the server-side switch is off (the default), which is all
 * these checks need.
 */
const EMBED = "/embed/jobs/00000000-0000-4000-8000-000000000000";

test("a top-level visit with the worker active: the response is the server's, byte for byte, and not the worker's", async ({ page, context }) => {
  await page.goto("/about");
  await waitForWorkerControl(page);

  const direct = await context.request.get(EMBED); // APIRequestContext: no worker in the path
  const res = await page.goto(EMBED);
  expect(res?.fromServiceWorker(), "an embed navigation must not be answered by the worker").toBe(false);
  expect(res?.status()).toBe(direct.status());
  expect(await res!.text()).toBe(await direct.text());
  expect(res!.headers()["content-security-policy"]).toBe(direct.headers()["content-security-policy"]);
  expect(res!.headers()["content-security-policy"]).toContain("frame-ancestors *");
});

test("the embed HTML has no reference to the service worker", async ({ request }) => {
  const res = await request.get(EMBED);
  const html = await res.text();
  expect(html).not.toMatch(/sw\.js|serviceWorker|manifest/i);
  expect(html).not.toContain("<script");
});

test("in a cross-origin frame, with the worker active for the site: delivered unchanged and no registration happens from the frame", async ({ page, context, browser, baseURL }) => {
  await page.goto("/about");
  await waitForWorkerControl(page);
  const scopesBefore = await registrationScopes(page);
  expect(scopesBefore).toHaveLength(1);

  // A real server on another loopback origin plays the website that embeds the widget (as e2e/employer-job-widget.spec.ts does).
  const host = createServer((_req, res) => {
    res.setHeader("content-type", "text/html");
    res.end(`<!doctype html><iframe id="w" src="${baseURL}${EMBED}" title="widget" width="400" height="300"></iframe>`);
  });
  await new Promise<void>((resolve) => host.listen(0, "127.0.0.1", resolve));
  const frameHostUrl = `http://127.0.0.1:${(host.address() as AddressInfo).port}/careers`;
  try {
    // Same context (the worker is active for the site in it): the frame's response must not come from the worker.
    const outsider = await context.newPage();
    const embedResponses: boolean[] = [];
    outsider.on("response", (r) => {
      if (new URL(r.url()).pathname.startsWith("/embed/")) embedResponses.push(r.fromServiceWorker());
    });
    await outsider.goto(frameHostUrl);
    await expect(outsider.frameLocator("#w").getByText("No open jobs right now")).toBeVisible({ timeout: 15_000 });
    expect(embedResponses).toEqual([false]);
    await outsider.close();
    expect(await registrationScopes(page), "no new registration from the frame").toEqual(scopesBefore);

    // A fresh context where NO worker exists: loading the frame must not create one.
    const fresh = await browser.newContext();
    const freshPage = await fresh.newPage();
    await freshPage.goto(frameHostUrl);
    await expect(freshPage.frameLocator("#w").getByText("No open jobs right now")).toBeVisible({ timeout: 15_000 });
    await freshPage.waitForTimeout(1500); // longer than the post-load idle delay a registration would wait for
    expect(fresh.serviceWorkers(), "the frame registered a worker").toHaveLength(0);
    await fresh.close();
  } finally {
    await new Promise((resolve) => host.close(resolve));
  }
});
