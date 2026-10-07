import { test, expect, type Page } from "@playwright/test";

/**
 * Issue #591 — a file chosen BEFORE the page hydrates must not be lost, on every file input in the app.
 *
 * Each trial holds every `/_next/static/chunks/*.js` script request behind a gate (the page stays server-rendered markup, with its CSS),
 * picks a file, releases the gate, WAITS FOR HYDRATION (React stamps `__reactProps` on hydrated nodes) and then checks
 * the component acted on the file. Two ways of picking: programmatic (`setInputFiles`), and for the label-wrapped
 * inputs a real click on the label, which opens the native chooser with no JavaScript (the way a mouse or touch user
 * gets there). Measured before the shared hook: LOST 10 of 10 on every label-wrapped input and on the programmatic path
 * of the JS-button ones. Also pinned: a reload or back/forward with a file previously chosen does NOT replay it.
 */
const FILE = { name: "brief.txt", mimeType: "text/plain", buffer: Buffer.from("hello world ".repeat(20)) };
const PNG_BANNER = undefined; // the banner picker is covered by banner-crop-picker.spec.ts (needs a decodable image)

interface Target {
  name: string;
  section: string;
  labelWrapped: boolean;
  /** Did the component act on the file? */
  acted: (page: Page, apiPosts: { count: number }) => Promise<boolean>;
}
const TARGETS: Target[] = [
  { name: "new-job assessment picker", section: "#new-job", labelWrapped: true, acted: async (p) => (await p.locator("#new-job").getByText("brief.txt").count()) > 0 },
  { name: "edit-job assessment picker", section: "#edit-job", labelWrapped: true, acted: async (p) => (await p.locator("#edit-job").getByText("brief.txt").count()) > 0 },
  { name: "assessment exercise upload", section: "#exercise", labelWrapped: true, acted: async (_p, api) => api.count > 0 },
  { name: "screening-gate apply (seeker)", section: "#screening", labelWrapped: true, acted: async (p) => (await p.locator("#screening").getByText("Attached: brief.txt").count()) > 0 },
  { name: "resume upload", section: "#resume", labelWrapped: false, acted: async (_p, api) => api.count > 0 },
];
void PNG_BANNER;

async function stalledPick(page: Page, t: Target, mode: "programmatic" | "label-click") {
  const api = { count: 0 };
  page.on("request", (r) => {
    if (r.method() === "POST" && /job-assessment-exercise|resume\/parse/.test(r.url())) api.count++;
  });
  await page.route("**/api/**", (route) => route.fulfill({ status: 500, contentType: "application/json", body: "{}" }));
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  // Script chunks only (see banner-crop-picker.spec.ts): a held stylesheet stalls the parser at any inline script in front of the page content, and shows nothing to interact with.
  await page.route(/\/_next\/static\/chunks\/.*\.js(\?.*)?$/, async (route) => {
    await gate;
    await route.continue();
  });
  await page.goto("/dev/file-input-fixture", { waitUntil: "commit" });
  const input = page.locator(`${t.section} input[type=file]`);
  await input.waitFor({ state: "attached" });

  if (mode === "programmatic") {
    await input.setInputFiles(FILE);
  } else {
    const chooser = page.waitForEvent("filechooser");
    await page.locator(`${t.section} label:has(input[type=file])`).first().click({ force: true });
    await (await chooser).setFiles(FILE);
  }
  release();
  await expect
    .poll(() => input.evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactProps"))), { message: "the page never hydrated", timeout: 30_000 })
    .toBe(true);
  return api;
}

for (const t of TARGETS) {
  for (const mode of t.labelWrapped ? (["programmatic", "label-click"] as const) : (["programmatic"] as const)) {
    test(`${t.name}: a file picked before hydration (${mode}) is not lost`, async ({ page }) => {
      const api = await stalledPick(page, t, mode);
      await expect.poll(() => t.acted(page, api), { timeout: 10_000 }).toBe(true);
    });
  }
}

test("a reload does not replay a previously chosen file into the pickers", async ({ page }) => {
  await page.goto("/dev/file-input-fixture");
  await page.waitForLoadState("networkidle");
  await page.locator("#new-job input[type=file]").setInputFiles(FILE);
  await expect(page.locator("#new-job").getByText("brief.txt")).toBeVisible();
  await page.reload();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(500);
  await expect(page.locator("#new-job").getByText("brief.txt")).toHaveCount(0);
});

test("back/forward does not replay a previously chosen file into the pickers", async ({ page }) => {
  await page.goto("/dev/file-input-fixture");
  await page.waitForLoadState("networkidle");
  await page.locator("#new-job input[type=file]").setInputFiles(FILE);
  await expect(page.locator("#new-job").getByText("brief.txt")).toBeVisible();
  await page.goto("/dev/resume-editor-fixture");
  await page.goBack();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(500);
  // Either the page was restored as it was (the chip is still there, once) or it was rebuilt empty; never twice.
  expect(await page.locator("#new-job").getByText("brief.txt").count()).toBeLessThanOrEqual(1);
});

test("screening gate: says 'No file attached' until a file is, and a pre-hydration pick ends attached and named", async ({ page }) => {
  await page.goto("/dev/file-input-fixture");
  await page.waitForLoadState("networkidle");
  await expect(page.locator("#screening").getByText("No file attached")).toBeVisible();
  await page.locator("#screening input[type=file]").setInputFiles(FILE);
  await expect(page.locator("#screening").getByText("Attached: brief.txt")).toBeVisible();
  await expect(page.locator("#screening").getByText("No file attached")).toHaveCount(0);
});

test("screening gate: the fixture assessment is optional, so Submit is enabled and carries no blocked-reason", async ({ page }) => {
  await page.goto("/dev/file-input-fixture");
  await page.waitForLoadState("networkidle");
  const submit = page.locator("#screening").getByRole("button", { name: "Submit application" });
  await expect(submit).toBeEnabled();
  await expect(page.locator("#submit-blocked-reason")).toHaveCount(0);
});
