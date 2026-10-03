/**
 * The public job page, its structured data and its share image still load from the explicit column list (src/lib/jobs/job-columns.ts).
 *
 * Before, all three read the row with `select("*")`. Now the page and the image share one named list, so this checks the three outputs a
 * missing column would break without any error being thrown: the page itself (a failed read renders as a 404), the JSON-LD (built from
 * many of the columns), and the 1200x630 card. The employer's edit page, the fourth loader that changed, is opened by
 * employer.spec.ts and assessment-file-stage-before-save.spec.ts, which fail if it 404s.
 */
import { test, expect } from "@playwright/test";
import { admin } from "./fixtures/authed";

let JOB: string;
let TITLE: string;

test.beforeAll(async () => {
  const { data, error } = await admin
    .from("job_postings")
    .select("id, title")
    .eq("company_name", "Zaria Digital")
    .eq("title", "Backend Engineer (Node.js)")
    .limit(1);
  if (error || !data?.length) throw new Error(`seeded posting not found: ${error?.message ?? "no row"}`);
  JOB = data[0].id;
  TITLE = data[0].title;
});

test("the job page renders the posting and its JSON-LD carries the title, the company and the description", async ({ page }) => {
  const res = await page.goto(`/jobs/${JOB}`);
  expect(res?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Backend Engineer");
  const raw = await page.locator('script[type="application/ld+json"]').first().textContent();
  const ld = JSON.parse(raw ?? "{}");
  expect(ld["@type"]).toBe("JobPosting");
  expect(ld.title).toBe(TITLE);
  expect(ld.hiringOrganization?.name).toBe("Zaria Digital");
  expect(String(ld.description ?? "").length).toBeGreaterThan(20);
});

test("the share image for the posting is served as an image", async ({ page, request }) => {
  // Follow the page's own og:image: Next may add a hash to the file-convention route's path, so the bare /opengraph-image is not the URL.
  await page.goto(`/jobs/${JOB}`);
  const content = await page.locator('meta[property="og:image"]').first().getAttribute("content");
  expect(content, "the page declares an og:image").toBeTruthy();
  const url = new URL(content!, "http://localhost");
  const res = await request.get(`${url.pathname}${url.search}`);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toMatch(/^image\//);
  expect((await res.body()).length).toBeGreaterThan(1000);
});
