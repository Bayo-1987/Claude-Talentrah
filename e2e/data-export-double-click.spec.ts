import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { renderConfirmPage } from "../src/lib/data-export/pages";

/**
 * The data export confirm page's Download button is disabled on submit, so a double-click sends ONE POST (DATA-EXPORT-DOWNLOAD-DELIVERY-1, owner amendment 3).
 *
 * Needs no server and no database: the page markup is the real one (renderConfirmPage, what the route serves) and the network is answered by the test, on a made-up host. It lives here and not
 * in Vitest because it needs a real browser, which the unit-test job does not install and this job does.
 */
async function open(page: import("@playwright/test").Page) {
  const id = randomUUID();
  const posts: string[] = [];
  await page.route(`https://confirm.example.test/data-export/${id}`, async (route) => {
    if (route.request().method() === "POST") {
      posts.push("POST");
      await new Promise((r) => setTimeout(r, 300));
      await route.fulfill({ status: 200, headers: { "content-type": "application/json", "content-disposition": 'attachment; filename="talentrah-data-2026-10-19.json"' }, body: "{}" });
    } else {
      await route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: renderConfirmPage({ id, expiresText: "2026-10-22 09:30 UTC" }) });
    }
  });
  await page.goto(`https://confirm.example.test/data-export/${id}`);
  return posts;
}

// Chromium on its own already ignores a second submit while the first is in flight, so the POST count alone would pass without the script; the disabled state is what proves the script ran.
test("a double-click sends exactly ONE POST and the button ends up disabled", async ({ page }) => {
  const posts = await open(page);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download my data" }).dblclick();
  await download;
  expect(posts).toHaveLength(1);
  await expect(page.getByRole("button", { name: "Download my data" })).toBeDisabled();
});

test("a rapid triple click is still one POST", async ({ page }) => {
  const posts = await open(page);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download my data" }).click({ clickCount: 3 });
  await download;
  expect(posts).toHaveLength(1);
});

test.describe("with scripts off", () => {
  test.use({ javaScriptEnabled: false });
  test("the plain form still works: one click, one POST", async ({ page }) => {
    const posts = await open(page);
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download my data" }).click();
    await download;
    expect(posts).toHaveLength(1);
  });
});
