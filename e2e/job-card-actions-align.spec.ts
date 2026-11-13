import { test, expect, type Page } from "@playwright/test";
import { buildJobCardHarnessHtml } from "./support/job-card-harness/build";

/**
 * P3 (JOBS-POLISH-1): the feed card's action row on a phone. The page is the REAL JobCard with the app's real compiled stylesheet (support/job-card-harness), in the shell's own wrapper
 * structure; Server Actions are stubs. No app server, no login and no database, so it runs the same everywhere.
 *
 * WHAT WAS WRONG. Below 760px the footer put the age line ("Posted 2 days ago") BESIDE the action row, centred on it, and squeezed the wrapped controls into whatever width was left, so the rows read
 * as a ragged block floating mid-card. The controls themselves already ended at one right edge; the card around them did not hold that edge as a column.
 *
 * WHAT IT MUST BE. The Farah launcher's reserve STAYS (the right-hand 72px of the action row, data-farah-avoid, e2e/farah-launcher.spec.ts "never covering Apply"): the edge the reserve leaves is the
 * edge the controls align to. Below 760px the age line takes its own line and the action row takes the card's whole content width, every control ending at that edge; from 760px up, nothing moves.
 */
const ORIGIN = "http://harness.test";
const RESERVE = 72;
let html = "";
test.beforeAll(async () => {
  html = await buildJobCardHarnessHtml();
});

async function open(page: Page, width: number) {
  await page.route(`${ORIGIN}/**`, (route) => route.fulfill({ status: 200, contentType: "text/html", body: html }));
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`${ORIGIN}/`);
  await page.evaluate(() => (window as unknown as { __mountJobCards: () => void }).__mountJobCards());
  await page.waitForSelector('[data-testid="job-card-actions"]');
}

type Geometry = {
  cardContent: { left: number; right: number };
  actions: { left: number; right: number; top: number; bottom: number; paddingRight: number; avoid: string | null };
  age: { top: number; bottom: number };
  controls: { name: string; right: number; centre: number }[];
};

/** Everything measured in the page, for one of the three cards ("internal", "external", "applied"). */
async function geometry(page: Page, kind: string): Promise<Geometry> {
  return page.evaluate((k) => {
    const wrap = document.querySelector(`[data-testid="card-${k}"]`)!;
    const card = wrap.firstElementChild as HTMLElement;
    const cr = card.getBoundingClientRect();
    const cs = getComputedStyle(card);
    const act = wrap.querySelector('[data-testid="job-card-actions"]') as HTMLElement;
    const ar = act.getBoundingClientRect();
    const age = [...wrap.querySelectorAll("span")].find((s) => /^Posted /.test(s.textContent ?? ""))!.getBoundingClientRect();
    return {
      cardContent: { left: cr.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft), right: cr.right - parseFloat(cs.borderRightWidth) - parseFloat(cs.paddingRight) },
      actions: { left: ar.left, right: ar.right, top: ar.top, bottom: ar.bottom, paddingRight: parseFloat(getComputedStyle(act).paddingRight), avoid: act.getAttribute("data-farah-avoid") },
      age: { top: age.top, bottom: age.bottom },
      // The row's direct children: each is one control or one control with its form (Save, Share, Report, Ask Farah, Mark as applied, Apply, or the "Applied" label).
      controls: [...act.children].map((c) => {
        const r = c.getBoundingClientRect();
        return { name: (c.getAttribute("aria-label") ?? c.textContent ?? "").trim(), right: r.right, centre: r.top + r.height / 2 };
      }),
    };
  }, kind);
}
const KINDS = ["internal", "external", "applied"] as const;
const near = (a: number, b: number) => Math.abs(a - b) <= 1;

for (const width of [360, 390, 412]) {
  test.describe(`${width}px`, () => {
    test(`the reserve for the Farah launcher is still there: ${RESERVE}px on the right of the action row, marked data-farah-avoid`, async ({ page }) => {
      await open(page, width);
      for (const k of KINDS) {
        const g = await geometry(page, k);
        expect(g.actions.paddingRight, k).toBe(RESERVE);
        expect(g.actions.avoid, k).toBe("true");
      }
    });

    test("every control ends at the edge the reserve leaves (the card's content edge minus the reserve), the last one included, whatever row it wrapped onto", async ({ page }) => {
      await open(page, width);
      for (const k of KINDS) {
        const g = await geometry(page, k);
        const edge = g.cardContent.right - RESERVE;
        // The last control of each wrapped row: the one furthest right on its row. Rows are told apart by their vertical centre (the controls are centred on the row, so a text button and an icon share one).
        const rows = new Map<number, number>();
        for (const c of g.controls) rows.set(Math.round(c.centre / 12), Math.max(rows.get(Math.round(c.centre / 12)) ?? -Infinity, c.right));
        expect(rows.size, `${k}: has rows`).toBeGreaterThan(0);
        for (const [, right] of rows) expect(near(right, edge), `${k}: a row ends at ${right}, the edge is ${edge}`).toBe(true);
        expect(near(g.controls[g.controls.length - 1].right, edge), `${k}: the last control`).toBe(true);
      }
    });

    test("the action row takes the card's whole content width, with the age line above it rather than beside it", async ({ page }) => {
      await open(page, width);
      for (const k of KINDS) {
        const g = await geometry(page, k);
        expect(near(g.actions.left, g.cardContent.left), `${k}: row starts at the content edge (${g.actions.left} vs ${g.cardContent.left})`).toBe(true);
        expect(near(g.actions.right, g.cardContent.right), `${k}: row ends at the content edge`).toBe(true);
        expect(g.age.bottom, `${k}: the age line is above the row`).toBeLessThanOrEqual(g.actions.top);
      }
    });
  });
}

for (const width of [768, 1024, 1280]) {
  test(`${width}px: unchanged: no reserve, the row is a single line, and the age line sits beside it`, async ({ page }) => {
    await open(page, width);
    for (const k of KINDS) {
      const g = await geometry(page, k);
      expect(g.actions.paddingRight, k).toBe(0);
      expect(new Set(g.controls.map((c) => Math.round(c.centre / 12))).size, `${k}: one line`).toBe(1);
      // Beside, not above: the two share a line.
      expect(g.age.top, k).toBeLessThan(g.actions.bottom);
      expect(g.age.bottom, k).toBeGreaterThan(g.actions.top);
    }
  });
}

test("1280px: unchanged: the last control ends at the card's content edge, as it always did", async ({ page }) => {
  await open(page, 1280);
  for (const k of KINDS) {
    const g = await geometry(page, k);
    expect(near(g.controls[g.controls.length - 1].right, g.cardContent.right), `${k}: the last control (${g.controls[g.controls.length - 1].right} vs ${g.cardContent.right})`).toBe(true);
  }
});
