import { test, expect, admin } from "./fixtures/authed";
import type { Page } from "@playwright/test";
import { ATS_TEST_RESUME } from "@/lib/resume-builder/ats-test-fixture";
import { CATALOG_TEMPLATE_CONFIGS } from "@/components/resume-builder/skeletons/catalog-configs";
import { extractPdfText } from "./support/pdf-text";
import { expectedMarkerOrder, actualMarkerOrder } from "./support/ats-markers";

/**
 * send-473 — the REAL "Download PDF" click path, on a cold font cache.
 *
 * e2e/ats-safety.spec.ts proves what the skeleton preview route exports once
 * its fonts have settled, and it only protects that harness: it waits on
 * `document.fonts.ready` itself before `page.pdf()`. A real user never runs
 * that wait — they click PrintButton, which calls `window.print()`. Every
 * font here is `font-display: swap`, so a click on a first visit or a slow
 * connection landed mid-swap and Chromium locked page breaks in from the
 * fallback layout, dropping whole sections from the exported PDF
 * (reproduced in CI as `blueprint`'s trailing sections vanishing).
 *
 * This drives the actual editor, with every font file held back for 2s so
 * the click is guaranteed to land while fonts are still arriving, and clicks
 * the actual button. `window.print` is replaced by a stub that, at the exact
 * moment PrintButton calls it, (1) records the document's font state and
 * (2) asks Node to capture `page.pdf()` — Chromium's own print-to-PDF
 * pipeline, the same one `window.print()` feeds. So what is asserted is what
 * a real click would have printed, not what a page that has long since
 * settled would.
 *
 * Proven both ways: with PrintButton's wait removed this fails (fonts still
 * loading at print time, and the captured PDF is missing/misordered), with it
 * present it passes.
 */

const SLUG = "blueprint";
const FONT_DELAY_MS = 2000;

declare global {
  interface Window {
    __printCalls: Array<{ fontsStatus: string; loadingFaces: number }>;
    __capturePdfNow: () => Promise<void>;
  }
}

async function installPrintStub(page: Page, onPrint: () => Promise<void>) {
  await page.exposeFunction("__capturePdfNow", onPrint);
  await page.addInitScript(() => {
    window.__printCalls = [];
    window.print = () => {
      window.__printCalls.push({
        fontsStatus: document.fonts.status,
        loadingFaces: [...document.fonts].filter((f) => f.status === "loading").length,
      });
      void window.__capturePdfNow();
    };
  });
}

test("Download PDF on a cold font cache prints the settled document, not a mid-swap one", async ({
  authedPage: page,
  testUser,
}) => {
  const { data: template } = await admin.from("resume_templates").select("id").eq("slug", SLUG).single();
  expect(template, `no resume_templates row for "${SLUG}" — migrations/seed not applied`).toBeTruthy();

  const { data: resume, error } = await admin
    .from("resumes")
    .insert({
      user_id: testUser.id,
      title: "Print button font-wait fixture",
      is_base: false,
      source: "builder",
      template_id: template!.id,
      structured_content: JSON.parse(JSON.stringify(ATS_TEST_RESUME)),
    })
    .select("id")
    .single();
  expect(error).toBeNull();

  let pdfBuffer: Buffer | undefined;
  await installPrintStub(page, async () => {
    pdfBuffer = await page.pdf({ printBackground: true });
  });

  // A cold cache, made deterministic: every next/font file arrives late.
  await page.route("**/_next/static/media/**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, FONT_DELAY_MS));
    await route.continue();
  });

  await page.goto(`/resume-builder/edit?resumeId=${resume!.id}`, { waitUntil: "domcontentloaded" });

  const button = page.getByRole("button", { name: "Download PDF" });
  await expect(button).toBeEnabled();
  // Observed concurrently, asserted last: it is transient, and asserting it
  // first would hide whether the print itself fired at the right moment.
  const sawPreparing = page
    .getByRole("button", { name: "Preparing PDF…" })
    .waitFor({ timeout: 10_000 })
    .then(() => true, () => false);
  await button.click();

  await page.waitForFunction(() => window.__printCalls.length > 0, undefined, { timeout: 15_000 });
  await expect.poll(() => pdfBuffer?.length ?? 0, { timeout: 15_000 }).toBeGreaterThan(0);

  const calls = await page.evaluate(() => window.__printCalls);
  expect(calls, "window.print() should be called exactly once per click").toHaveLength(1);
  // soft: a failure here must not hide whether the captured PDF is also wrong.
  expect.soft(
    calls[0],
    "window.print() ran while fonts were still loading — the export race: page breaks lock in from the fallback layout",
  ).toEqual({ fontsStatus: "loaded", loadingFaces: 0 });

  // What was actually captured at print time must be the whole document, in
  // reading order — `blueprint` is where trailing sections went missing.
  const config = CATALOG_TEMPLATE_CONFIGS[SLUG];
  const text = await extractPdfText(pdfBuffer!);
  const expected = expectedMarkerOrder(config);
  expect(
    actualMarkerOrder(text, expected),
    `the PDF captured at print time was missing or misordering sections; expected [${expected.join(", ")}]`,
  ).toEqual(expected);

  // Feedback while it waited (not a dead click), and usable again afterwards.
  expect(await sawPreparing, 'the button never showed "Preparing PDF…" while waiting for fonts').toBe(true);
  await expect(page.getByRole("button", { name: "Download PDF" })).toBeEnabled();
});
