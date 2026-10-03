import { test, expect, type Page } from "@playwright/test";

/**
 * The homepage "How it works" steps share a top line for each row (S1-43).
 *
 * Steps 3 and 4 have two-line headings, so with plain stacked columns their body text started lower than steps 1 and 2. Each step now
 * takes three rows of the parent grid as a subgrid, so the numbers, the headings and the paragraphs each align across the row. Measured
 * on the real laid-out page, not on class names: at 1440px the four paragraphs' tops must be equal (within 1px), and at the two-column
 * width each pair must align.
 */
async function paragraphTops(page: Page): Promise<number[]> {
  const steps = page.locator("#how-it-works .row-span-3");
  await expect(steps).toHaveCount(4);
  const tops: number[] = [];
  for (let i = 0; i < 4; i++) {
    const box = await steps.nth(i).locator("p").boundingBox();
    expect(box, `step ${i + 1} paragraph has no box`).not.toBeNull();
    tops.push(box!.y);
  }
  return tops;
}

test.describe("How it works alignment", () => {
  test("at 1440px the four paragraphs start on the same line", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.locator("#how-it-works").scrollIntoViewIfNeeded();
    const tops = await paragraphTops(page);
    expect(Math.max(...tops) - Math.min(...tops), `paragraph tops: ${tops.join(", ")}`).toBeLessThanOrEqual(1);
  });

  test("the four headings take the same height and are balanced", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    const headings = page.locator("#how-it-works h3");
    await expect(headings).toHaveCount(4);
    const heights: number[] = [];
    for (let i = 0; i < 4; i++) heights.push((await headings.nth(i).boundingBox())!.height);
    expect(Math.max(...heights) - Math.min(...heights), `heading heights: ${heights.join(", ")}`).toBeLessThanOrEqual(1);
    expect(await headings.first().evaluate((el) => getComputedStyle(el).textWrap)).toMatch(/balance/);
  });

  test("at the two-column width each row of steps shares its paragraph line", async ({ page }) => {
    await page.setViewportSize({ width: 700, height: 900 });
    await page.goto("/");
    const tops = await paragraphTops(page);
    expect(Math.abs(tops[0] - tops[1]), `row 1: ${tops[0]}, ${tops[1]}`).toBeLessThanOrEqual(1);
    expect(Math.abs(tops[2] - tops[3]), `row 2: ${tops[2]}, ${tops[3]}`).toBeLessThanOrEqual(1);
  });
});
