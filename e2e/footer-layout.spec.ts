/**
 * send-486 — the marketing footer after the Compare column was removed.
 *
 * Signed-out and database-free (it imports nothing from ./fixtures), so it can be pointed at any
 * deployment with E2E_BASE_URL. The footer is one shared component rendered by the homepage, the
 * marketing pages, the legal pages and the signed-out app shell; two representative pages are
 * checked, and tests/marketing/marketing-footer.test.tsx pins the component itself.
 *
 * What the layout must be:
 *  - 1280px: Product | For Employers | Company & Support | Legal & Trust in ONE row (Legal & Trust
 *    used to wrap under Product, because five columns sat in a four-column grid).
 *  - 390px: a 2x2 block (Product, For Employers / Company & Support, Legal & Trust), no empty cell
 *    where Compare was, and no horizontal scroll.
 */
import { test, expect, type Page } from "@playwright/test";

const HEADINGS = ["Product", "For Employers", "Company & Support", "Legal & Trust"];

async function headingBoxes(page: Page) {
  const boxes = [];
  for (const name of HEADINGS) {
    const box = await page.locator("footer").getByText(name, { exact: true }).first().boundingBox();
    expect(box, `the "${name}" footer heading has no box`).not.toBeNull();
    boxes.push({ name, ...box! });
  }
  return boxes;
}

for (const path of ["/", "/about"]) {
  test.describe(`footer on ${path}, signed out`, () => {
    test("desktop (1280px): four columns in one row, in order, with no Compare", async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const page = await context.newPage();
      await page.goto(path);
      await expect(page.locator("footer")).toBeVisible();
      await expect(page.locator("footer").getByText("Compare", { exact: true })).toHaveCount(0);

      const boxes = await headingBoxes(page);
      // One row: all four headings share a top edge (to the pixel; same grid row).
      expect(new Set(boxes.map((b) => Math.round(b.y))).size, "headings are not all in one row").toBe(1);
      // In order, left to right, strictly increasing.
      for (let i = 1; i < boxes.length; i++) {
        expect(boxes[i].x, `${boxes[i].name} must sit right of ${boxes[i - 1].name}`).toBeGreaterThan(boxes[i - 1].x);
      }
      // Legal & Trust's links are in its own column, to the right of Company & Support, not under Product.
      const privacy = await page.locator("footer").getByRole("link", { name: "Privacy Policy" }).boundingBox();
      expect(privacy!.x).toBeGreaterThan(boxes[2].x - 1);
      await context.close();
    });

    test("phone (390px): a 2x2 block with no empty cell, and nothing scrolls sideways", async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      const page = await context.newPage();
      await page.goto(path);
      await expect(page.locator("footer")).toBeVisible();
      const boxes = await headingBoxes(page);
      const [product, employers, company, legal] = boxes;

      // Stacking order: Product and For Employers share the first row, Company & Support and
      // Legal & Trust the second; left column then right column within a row.
      expect(Math.round(product.y)).toBe(Math.round(employers.y));
      expect(Math.round(company.y)).toBe(Math.round(legal.y));
      expect(company.y, "the second row must sit below the first").toBeGreaterThan(product.y + 20);
      expect(employers.x).toBeGreaterThan(product.x);
      expect(legal.x).toBeGreaterThan(company.x);
      expect(Math.round(company.x)).toBe(Math.round(product.x));
      expect(Math.round(legal.x)).toBe(Math.round(employers.x));

      const geometry = await page.evaluate(() => ({
        clientW: document.documentElement.clientWidth,
        scrollW: document.documentElement.scrollWidth,
      }));
      expect(geometry.scrollW, "the footer makes the page scroll sideways").toBeLessThanOrEqual(geometry.clientW);
      await context.close();
    });
  });
}
