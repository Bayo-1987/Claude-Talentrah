import { test, expect, type Page } from "@playwright/test";
import { buildHarnessHtml } from "./support/farah-launcher-harness/build";

/**
 * The Farah launcher and bottom sheet (phones, below 760px) in a real browser. The page is the REAL FarahSheetHost, FarahJobMenu, install strip and first-visit hint in the shell's own wrapper
 * structure with the app's real compiled stylesheet (see support/farah-launcher-harness/entry.tsx); the Farah panel inside is a stand-in that, like the real one, moves focus to a job's first
 * option when a job is handed over. No app server, no login and no database, so it runs the same everywhere. The signed-in specs for the real panel are the existing farah-* specs.
 *
 * Things a browser spec cannot show, and which need a real phone (listed in the report, not claimed here): the soft keyboard on iOS Safari and Android, the home-indicator inset (Playwright cannot
 * set env(safe-area-inset-bottom), so only the style string is asserted), the dynamic toolbar, VoiceOver and TalkBack, a landscape phone.
 */
const ORIGIN = "http://harness.test";
let html = "";
test.beforeAll(async () => {
  html = await buildHarnessHtml();
});

const PHONES = [360, 390, 412] as const;

async function open(page: Page, width: number, opts: { unread?: boolean; hint?: boolean; strip?: boolean; pathname?: string; height?: number; seen?: boolean } = {}) {
  await page.route(`${ORIGIN}/**`, (route) => route.fulfill({ status: 200, contentType: "text/html", body: html }));
  await page.setViewportSize({ width, height: opts.height ?? 800 });
  await page.goto(`${ORIGIN}/`);
  await page.evaluate(([seen, pathname]) => {
    if (seen) localStorage.setItem("talentrah.farahLauncher", '{"v":1,"opened":true}');
    else localStorage.clear();
    window.__pathname = (pathname as string | undefined) ?? "/jobs";
  }, [opts.seen ?? true, opts.pathname] as const);
  await page.evaluate((o) => window.__mountLauncher(o), { unread: opts.unread, hint: opts.hint, strip: opts.strip });
  // "attached", not visible: on a phone the closed sheet is deliberately invisible.
  await page.waitForSelector('[data-testid="farah-sheet"]', { state: "attached" });
}
const launcher = (page: Page) => page.getByTestId("farah-launcher");
const sheet = (page: Page) => page.getByTestId("farah-sheet");
const box = async (page: Page, testId: string) => (await page.getByTestId(testId).boundingBox())!;

test.describe("below 760px: the launcher replaces the bottom bar", () => {
  for (const width of PHONES) {
    test(`${width}: a round launcher is there, there is no bottom bar, and the closed sheet cannot be reached`, async ({ page }) => {
      await open(page, width);
      await expect(launcher(page)).toBeVisible();
      await expect(page.getByTestId("farah-mobile-tab")).toHaveCount(0);
      await expect(page.getByTestId("farah-tab-spacer")).toHaveCount(0);
      // The closed sheet is mounted (the conversation lives in it) but invisible: out of the tab order and of the accessibility tree.
      await expect(sheet(page)).toHaveAttribute("data-sheet", "closed");
      await expect(sheet(page)).toHaveCSS("visibility", "hidden");
      await expect(page.getByRole("textbox", { name: "Message Farah" })).toHaveCount(0);
      await expect(page.getByTestId("farah-panel")).toHaveCount(1);
    });
  }

  test("geometry: 56px, a 16px margin on the LEFT, above the bottom edge, a target of at least 44px; the style carries the safe-area inset", async ({ page }) => {
    await open(page, 390);
    const b = await box(page, "farah-launcher");
    expect(Math.round(b.width)).toBe(56);
    expect(Math.round(b.height)).toBe(56);
    expect(Math.round(b.x)).toBe(16);
    expect(Math.round(390 - (b.x + b.width)), "not the right edge any more").toBeGreaterThan(16);
    expect(Math.round(800 - (b.y + b.height))).toBe(16);
    expect(await launcher(page).evaluate((el) => el.getAttribute("style"))).toContain("env(safe-area-inset-bottom)");
    expect(await launcher(page).evaluate((el) => getComputedStyle(el).borderRadius)).not.toBe("0px");
  });

  test("the accessible name is 'Ask Farah, AI assistant' and it says it opens a dialog", async ({ page }) => {
    await open(page, 390);
    await expect(page.getByRole("button", { name: "Ask Farah, AI assistant" })).toHaveCount(1);
    await expect(launcher(page)).toHaveAttribute("aria-haspopup", "dialog");
    await expect(launcher(page)).toHaveAttribute("aria-expanded", "false");
  });

  test("the unread dot shows on the launcher", async ({ page }) => {
    await open(page, 390, { unread: true });
    await expect(launcher(page).getByTestId("farah-unread-dot")).toHaveCount(1);
    await open(page, 390, { unread: false });
    await expect(launcher(page).getByTestId("farah-unread-dot")).toHaveCount(0);
  });
});

test.describe("the boundary is exactly 760", () => {
  // Tailwind's max-[N] is EXCLUSIVE (width < N): a phone rule written max-[759px] missed 759 itself. The complement of the shell's min-[760px] is max-[760px].
  for (const [width, phone] of [[758, true], [759, true], [760, false], [761, false]] as const) {
    test(`${width}: ${phone ? "the launcher and the fixed sheet" : "the docked panel"}`, async ({ page }) => {
      await open(page, width);
      expect(await sheet(page).evaluate((el) => getComputedStyle(el).position)).toBe(phone ? "fixed" : "static");
      await expect(launcher(page)).toBeVisible({ visible: phone });
    });
  }
});

test.describe("from 760px: nothing changes", () => {
  for (const width of [760, 1280]) {
    test(`${width}: no launcher, no scrim, the panel is the docked 280px column beside the content`, async ({ page }) => {
      await open(page, width);
      await expect(launcher(page)).toBeHidden();
      await expect(page.getByTestId("farah-launcher-spacer")).toBeHidden();
      await expect(sheet(page)).toBeVisible();
      await expect(sheet(page)).toHaveCSS("position", "static");
      const panel = await box(page, "farah-panel");
      const content = await box(page, "content-column");
      expect(Math.round(panel.width)).toBe(280);
      expect(panel.x).toBeGreaterThanOrEqual(content.x + content.width - 1);
      // The phone-only header (Close) is not there.
      await expect(page.getByRole("button", { name: "Close Farah" })).toBeHidden();
    });
  }

  test("a masthead 'Ask Farah' at 1280 never opens a sheet", async ({ page }) => {
    await open(page, 1280);
    await page.getByTestId("masthead-ask-farah").click();
    await expect(sheet(page)).toHaveAttribute("data-sheet", "closed");
    await expect(page.getByTestId("farah-sheet-scrim")).toHaveCount(0);
  });

  test("a docked panel is not a dialog and not hidden from assistive technology", async ({ page }) => {
    await open(page, 1280);
    await expect(sheet(page)).not.toHaveAttribute("role", "dialog");
    await expect(sheet(page)).not.toHaveAttribute("aria-hidden", /.*/);
    await expect(page.getByRole("textbox", { name: "Message Farah" })).toHaveCount(1);
  });
});

test.describe("from 760px: the action rows are what they always were", () => {
  for (const width of [768, 1024, 1280]) {
    test(`${width}: no reserve on either row, the job page's row is left-aligned, and there is no launcher to avoid`, async ({ page }) => {
      await open(page, width);
      await expect(launcher(page)).toBeHidden();
      const rows = await page.evaluate(() =>
        [...document.querySelectorAll("[data-farah-avoid]")].map((r) => {
          const cs = getComputedStyle(r);
          return { id: (r as HTMLElement).dataset.testid, pl: cs.paddingLeft, pr: cs.paddingRight, justify: cs.justifyContent };
        }),
      );
      for (const r of rows) {
        expect(r.pl, r.id).toBe("0px");
        expect(r.pr, r.id).toBe("0px");
        if (r.id === "job-page-actions") expect(["normal", "flex-start"], "left-aligned, as always").toContain(r.justify);
        if (r.id === "job-card-actions") expect(r.justify).toBe("flex-end");
      }
      expect(rows.map((r) => r.id)).toContain("job-page-actions");
    });
  }
});

test.describe("opening and closing the sheet", () => {
  test("a tap opens a dialog of about 85% of the screen with the panel inside; the page behind cannot be reached or scrolled", async ({ page }) => {
    await open(page, 390);
    await launcher(page).click();
    await expect(sheet(page)).toHaveAttribute("data-sheet", "open");
    await expect(sheet(page)).toHaveAttribute("role", "dialog");
    await expect(sheet(page)).toHaveAttribute("aria-modal", "true");
    // Measured once the slide has finished, not mid-transition.
    await expect.poll(async () => { const b = await box(page, "farah-sheet"); return Math.round(b.y + b.height); }).toBe(800);
    const b = await box(page, "farah-sheet");
    expect(Math.abs(b.height - 800 * 0.85)).toBeLessThanOrEqual(2);
    await expect(page.getByRole("textbox", { name: "Message Farah" })).toBeVisible();
    // Behind it: inert, and the body does not scroll.
    await expect(page.getByTestId("content-column")).toHaveAttribute("inert", "");
    await expect(page.getByTestId("masthead-band")).toHaveAttribute("inert", "");
    expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).toBe("hidden");
    await expect(launcher(page)).toHaveAttribute("aria-expanded", "true");
  });

  for (const how of ["the Close button", "Escape", "a tap on the scrim"] as const) {
    test(`${how} closes it, and everything behind it comes back`, async ({ page }) => {
      await open(page, 390);
      await launcher(page).click();
      await expect(sheet(page)).toHaveAttribute("data-sheet", "open");
      if (how === "the Close button") await page.getByRole("button", { name: "Close Farah" }).click();
      else if (how === "Escape") await page.keyboard.press("Escape");
      else await page.getByTestId("farah-sheet-scrim").click({ position: { x: 20, y: 20 } });
      await expect(sheet(page)).toHaveAttribute("data-sheet", "closed");
      await expect(sheet(page)).toHaveCSS("visibility", "hidden");
      await expect(page.getByTestId("content-column")).not.toHaveAttribute("inert", "");
      await expect(page.getByTestId("masthead-band")).not.toHaveAttribute("inert", "");
      expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).not.toBe("hidden");
    });
  }

  test("a tap that starts inside the sheet does not close it", async ({ page }) => {
    await open(page, 390);
    await launcher(page).click();
    await page.getByRole("textbox", { name: "Message Farah" }).click();
    await expect(sheet(page)).toHaveAttribute("data-sheet", "open");
  });

  test("focus moves into the sheet on open and returns to the launcher on close", async ({ page }) => {
    await open(page, 390);
    await launcher(page).focus();
    await launcher(page).click();
    expect(await page.evaluate(() => document.getElementById("farah-sheet")!.contains(document.activeElement))).toBe(true);
    await page.keyboard.press("Escape");
    await expect(launcher(page)).toBeFocused();
  });

  test("the conversation survives open and close and a rotation: it is the same DOM node", async ({ page }) => {
    await open(page, 390);
    await page.evaluate(() => ((document.querySelector('[data-testid="farah-panel"]') as HTMLElement).dataset.marker = "same-node"));
    await launcher(page).click();
    await page.getByRole("textbox", { name: "Message Farah" }).fill("a half-written question");
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 844, height: 390 });
    await page.setViewportSize({ width: 390, height: 844 });
    await launcher(page).click();
    await expect(page.getByTestId("farah-panel")).toHaveAttribute("data-marker", "same-node");
    await expect(page.getByRole("textbox", { name: "Message Farah" })).toHaveValue("a half-written question");
  });

  test("an open sheet closes when the window reaches the docked layout, and the panel is docked", async ({ page }) => {
    await open(page, 390);
    await launcher(page).click();
    await page.setViewportSize({ width: 1024, height: 800 });
    await expect(sheet(page)).toHaveAttribute("data-sheet", "closed");
    await expect(page.getByTestId("farah-sheet-scrim")).toHaveCount(0);
    expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).not.toBe("hidden");
    await expect(sheet(page)).toBeVisible();
  });

  test("the masthead's Ask Farah opens the sheet on a phone", async ({ page }) => {
    await open(page, 390);
    await page.getByTestId("masthead-ask-farah").click();
    await expect(sheet(page)).toHaveAttribute("data-sheet", "open");
  });
});

test.describe("a job's Ask Farah link", () => {
  test("opens the sheet and focus lands on the job's first option (the seed arrives after the sheet is open)", async ({ page }) => {
    await open(page, 390);
    // Scoped to the content column: the masthead's own "Ask Farah" comes first in the page and opens the sheet without a job.
    await page.getByTestId("content-column").getByRole("button", { name: "Ask Farah" }).first().click();
    await expect(sheet(page)).toHaveAttribute("data-sheet", "open");
    await expect(page.getByText("Farah has Job number 1 at Acme.")).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.__focusLanded)).toBe(true);
    await expect(page.getByRole("button", { name: "Am I a fit?" })).toBeFocused();
  });

  test("focus returns to that link when the sheet closes", async ({ page }) => {
    await open(page, 390);
    const link = page.getByTestId("content-column").getByRole("button", { name: "Ask Farah" }).first();
    await link.focus();
    await link.click();
    await page.keyboard.press("Escape");
    await expect(link).toBeFocused();
  });
});

test.describe("the first visit", () => {
  test("a new browser sees the pill, opening Farah collapses it for good, a returning browser never sees it", async ({ page }) => {
    await open(page, 390, { seen: false });
    await expect(launcher(page)).toHaveAttribute("data-launcher", "pill");
    await expect(launcher(page)).toContainText("Ask Farah · AI assistant");
    expect(Math.round((await box(page, "farah-launcher")).x), "the pill is anchored on the left too").toBe(16);
    await expect(page.getByRole("button", { name: "Ask Farah · AI assistant" })).toHaveCount(1);
    await launcher(page).click();
    await page.keyboard.press("Escape");
    await expect(launcher(page)).toHaveAttribute("data-launcher", "round");
    expect(await page.evaluate(() => localStorage.getItem("talentrah.farahLauncher"))).toBe('{"v":1,"opened":true}');
    await page.reload();
    await page.evaluate(() => { window.__pathname = "/jobs"; });
    await page.evaluate(() => window.__mountLauncher({}));
    await expect(launcher(page)).toHaveAttribute("data-launcher", "round");
  });

  test("the first paint is the round launcher (no pill flash for a returning browser)", async ({ page }) => {
    await open(page, 390, { seen: true });
    await expect(launcher(page)).toHaveAttribute("data-launcher", "round");
  });
});

test.describe("where it does not appear", () => {
  for (const pathname of ["/billing/callback", "/mentorship/book/callback", "/settings/account-deletion", "/settings/delete-account/confirm"]) {
    test(`${pathname}: no launcher and no reserve`, async ({ page }) => {
      await open(page, 390, { pathname });
      await expect(launcher(page)).toHaveCount(0);
      await expect(page.getByTestId("farah-launcher-spacer")).toHaveCount(0);
    });
  }
  test("/billing itself keeps it (decision Q1)", async ({ page }) => {
    await open(page, 390, { pathname: "/billing" });
    await expect(launcher(page)).toBeVisible();
  });
});

test.describe("never covering Apply", () => {
  for (const width of PHONES) {
    test(`${width}: the card row never meets the launcher, the page row scrolls clear of it, and nothing is behind it at the end of the page`, async ({ page }) => {
      await open(page, width);
      // Precondition: the launcher is floating inside the viewport. In the flow it would be far below and every check here would pass for nothing.
      const floating = await box(page, "farah-launcher");
      expect(floating.y + floating.height).toBeLessThanOrEqual(800);
      expect(floating.y).toBeGreaterThan(0);
      // The job CARD's row, BY CONSTRUCTION and at every scroll position: every control starts at least 8px right of the launcher's column (the row ends at the card's right edge and keeps a small clearance on its left).
      // The job PAGE's row is LEFT-aligned (changed 22 Nov, the owner's call): it starts in the launcher's column, so it cannot clear by construction. It clears by SCROLLING instead, checked below.
      const clearances = await page.evaluate(() => {
        const l = document.querySelector('[data-testid="farah-launcher"]')!.getBoundingClientRect();
        return [...document.querySelectorAll("[data-farah-avoid]")].flatMap((row) =>
          [...row.querySelectorAll("a, button")].map((c) => ({ row: (row as HTMLElement).dataset.testid ?? "", name: (c.textContent ?? "").trim(), gap: c.getBoundingClientRect().left - l.right })),
        );
      });
      expect(new Set(clearances.map((c) => c.row)), "both kinds of row are in the page").toEqual(new Set(["job-card-actions", "job-page-actions"]));
      for (const c of clearances.filter((c) => c.row === "job-card-actions")) expect(c.gap, `${c.row} / ${c.name}`).toBeGreaterThanOrEqual(8);
      const total = await page.evaluate(() => document.documentElement.scrollHeight);
      const hitsAt: Record<number, { row: string; at: string }[]> = {};
      for (let y = 0; y <= total; y += 90) {
        await page.evaluate((top) => window.scrollTo(0, top), y);
        hitsAt[y] = await page.evaluate(() => {
          const l = document.querySelector('[data-testid="farah-launcher"]')!.getBoundingClientRect();
          const out: { row: string; at: string }[] = [];
          for (const row of document.querySelectorAll('[data-farah-avoid]')) {
            for (const c of row.querySelectorAll("a, button")) {
              const r = c.getBoundingClientRect();
              if (r.width === 0 || r.height === 0) continue;
              if (r.left < l.right && r.right > l.left && r.top < l.bottom && r.bottom > l.top) out.push({ row: (row as HTMLElement).dataset.testid ?? "", at: `${c.textContent?.trim()} @${Math.round(r.left)},${Math.round(r.top)}` });
            }
          }
          return out;
        });
        // The card's row never meets the launcher, at any scroll position.
        expect(hitsAt[y].filter((h) => h.row === "job-card-actions"), `card row, scrollY ${y}`).toEqual([]);
      }
      // The page's row may pass under the launcher while the page scrolls (it is fixed and the row is left-aligned), but it SCROLLS CLEAR: past the last position where it meets the launcher there is
      // a position, at or before the end of the page, where it does not, and the very end of the page is clear.
      const ys = Object.keys(hitsAt).map(Number).sort((a, b) => a - b);
      const lastEnd = await page.evaluate(() => { window.scrollTo(0, document.documentElement.scrollHeight); return Math.round(window.scrollY); });
      const pageHitYs = ys.filter((y) => hitsAt[y].some((h) => h.row === "job-page-actions"));
      expect(pageHitYs.length, "precondition: the page's row does pass under the launcher at some scroll position, or this check proves nothing").toBeGreaterThan(0);
      expect(Math.max(...pageHitYs), "it scrolls clear: the last overlap is before the end of the page").toBeLessThan(lastEnd);
      const atEnd = await page.evaluate(() => {
        const l = document.querySelector('[data-testid="farah-launcher"]')!.getBoundingClientRect();
        return [...document.querySelectorAll('[data-testid="job-page-actions"] a, [data-testid="job-page-actions"] button, [data-testid="job-page-actions"] p')].map((c) => ({ name: (c.textContent ?? "").trim().slice(0, 30), clear: c.getBoundingClientRect().bottom <= l.top }));
      });
      expect(atEnd.length).toBeGreaterThan(4);
      for (const c of atEnd) expect(c.clear, `at the end of the page: ${c.name}`).toBe(true);
      // End of the page: the reserve sits under the last thing, so the launcher is over the reserve and nothing else.
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const clear = await page.evaluate(() => {
        const l = document.querySelector('[data-testid="farah-launcher"]')!.getBoundingClientRect();
        const lastCard = [...document.querySelectorAll('[data-testid="content-column"] > div')].pop()!.getBoundingClientRect();
        return lastCard.bottom <= l.top;
      });
      expect(clear).toBe(true);
    });
  }
});

test.describe("the job page's last controls scroll clear of the launcher, with no padding of their own", () => {
  // The shell keeps a spacer under the last thing on every page below 760px (farah-launcher-spacer, as tall as the launcher's column), and the install strip keeps its own; the launcher floats above
  // the strip. So the end of the page needs no extra padding from the job page: measured here with and without the strip, on a short phone and a tall one.
  for (const strip of [false, true]) {
    for (const height of [640, 844]) {
      test(`390x${height}${strip ? " with the install strip" : ""}: at the end of the page every control of the job page's row is above the launcher`, async ({ page }) => {
        await open(page, 390, { strip, height });
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        const r = await page.evaluate(() => {
          const l = document.querySelector('[data-testid="farah-launcher"]')!.getBoundingClientRect();
          const bottoms = [...document.querySelectorAll('[data-testid="job-page-actions"] > *')].map((c) => c.getBoundingClientRect().bottom);
          return { launcherTop: l.top, lowest: Math.max(...bottoms), n: bottoms.length };
        });
        expect(r.n).toBeGreaterThanOrEqual(6);
        expect(r.lowest, "the lowest control ends above the launcher").toBeLessThanOrEqual(r.launcherTop);
      });
    }
  }
});

test.describe("the job page's action row is left-aligned on a phone", () => {
  // Changed 22 Nov (the owner's call): below 760px the row used to be right-aligned with the launcher's 72px column reserved on its left (so on a 390px phone Save, Apply by email, Copy address, Mark as
  // applied, the dashed note, Tailor my resume and Ask Farah were all pushed away from the left edge). The row now starts at the same left edge as the rest of the page.
  for (const width of PHONES) {
    test(`${width}: every control and the note start at the row's left edge, and nothing is spread to the right`, async ({ page }) => {
      await open(page, width);
      const row = page.getByTestId("job-page-actions");
      await expect(row).toBeVisible();
      for (const name of ["Save", "Apply by email", "Copy address", "Mark as applied", "Tailor my resume for this", "Ask Farah"]) {
        await expect(row.getByText(name, { exact: false }).first(), name).toBeVisible();
      }
      await expect(row.getByText("Use Apply by email to open your mail app", { exact: false })).toBeVisible();
      const css = await row.evaluate((el) => { const cs = getComputedStyle(el); return { pl: cs.paddingLeft, pr: cs.paddingRight, justify: cs.justifyContent }; });
      expect(css.pl).toBe("0px");
      expect(css.pr).toBe("0px");
      expect(["normal", "flex-start", "start"], "left-aligned").toContain(css.justify);
      const items = await row.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const boxes = [...el.children].map((c) => { const b = c.getBoundingClientRect(); return { name: (c.textContent ?? "").trim().slice(0, 28), left: b.left, right: b.right, top: b.top, w: b.width, h: b.height }; }).filter((b) => b.w > 0 && b.h > 0);
        return { left: r.left, right: r.right, boxes };
      });
      expect(items.boxes.length).toBeGreaterThanOrEqual(6);
      // Group into visual lines; the first item of EVERY line starts at the row's left edge, and within a line the items follow each other with the row's own 12px gap (nothing spread out to the right).
      const lines: (typeof items.boxes)[] = [];
      for (const b of [...items.boxes].sort((a, c) => a.top - c.top || a.left - c.left)) {
        const line = lines.find((l) => Math.abs(l[0].top - b.top) < 6);
        if (line) line.push(b); else lines.push([b]);
      }
      for (const line of lines) {
        line.sort((a, c) => a.left - c.left);
        expect(Math.abs(line[0].left - items.left), `line starting "${line[0].name}": first item at the row's left edge`).toBeLessThanOrEqual(1);
        for (let i = 1; i < line.length; i++) expect(line[i].left - line[i - 1].right, `${line[i - 1].name} -> ${line[i].name}`).toBeLessThanOrEqual(13);
      }
      // The row's own left edge is the page's content edge (24px gutter), not 72px in.
      expect(Math.round(items.left)).toBe(24);
    });
  }
});

test.describe("the soft keyboard", () => {
  async function fakeViewport(page: Page) {
    await page.addInitScript(() => {
      const vv = new EventTarget() as EventTarget & { height: number; scale: number };
      vv.height = window.innerHeight;
      vv.scale = 1;
      Object.defineProperty(window, "visualViewport", { value: vv, configurable: true });
      (window as unknown as { __setVisualHeight: (h: number) => void }).__setVisualHeight = (h) => {
        vv.height = h;
        vv.dispatchEvent(new Event("resize"));
      };
    });
  }
  test("while a text field has focus and the visual viewport has shrunk, the launcher is hidden; it returns on blur", async ({ page }) => {
    await fakeViewport(page);
    await open(page, 390);
    await page.getByRole("textbox", { name: "Search jobs" }).focus();
    await page.evaluate(() => (window as unknown as { __setVisualHeight: (h: number) => void }).__setVisualHeight(480));
    await expect(launcher(page)).toHaveCSS("visibility", "hidden");
    await page.getByRole("textbox", { name: "Search jobs" }).blur();
    await page.evaluate(() => (window as unknown as { __setVisualHeight: (h: number) => void }).__setVisualHeight(800));
    await expect(launcher(page)).toHaveCSS("visibility", "visible");
  });

  test("a shrink with no text field focused (a toolbar) does not hide it", async ({ page }) => {
    await fakeViewport(page);
    await open(page, 390);
    await page.evaluate(() => (window as unknown as { __setVisualHeight: (h: number) => void }).__setVisualHeight(480));
    await expect(launcher(page)).toHaveCSS("visibility", "visible");
  });
});

test.describe("reduced motion", () => {
  // Whether an element really animates: a transition needs a property that is not "none" AND a duration above zero (an element with no transition utility has property "all" and duration 0s).
  const animates = (el: import("@playwright/test").Locator) =>
    el.evaluate((node) => {
      const cs = getComputedStyle(node);
      return cs.transitionProperty !== "none" && cs.transitionDuration.split(",").some((d) => parseFloat(d) > 0);
    });

  test("neither the launcher nor the sheet animates", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await open(page, 390);
    expect(await animates(launcher(page))).toBe(false);
    expect(await animates(sheet(page))).toBe(false);
  });
  test("with motion allowed the sheet slides and the launcher eases", async ({ page }) => {
    await open(page, 390);
    expect(await animates(sheet(page))).toBe(true);
    expect(await animates(launcher(page))).toBe(true);
  });
});

test.describe("the install strip and the first-visit hint", () => {
  test.use({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" });

  test("the strip stands on the bottom edge and the launcher floats above it, uncovered", async ({ page }) => {
    await open(page, 390, { strip: true });
    await expect(page.getByTestId("install-strip")).toBeVisible();
    const strip = await box(page, "install-strip");
    expect(Math.round(strip.y + strip.height)).toBe(800);
    const l = await box(page, "farah-launcher");
    expect(l.y + l.height).toBeLessThanOrEqual(strip.y);
    await page.getByRole("button", { name: "Not now" }).click();
    await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue("--farah-strip-h"))).toBe("");
    const after = await box(page, "farah-launcher");
    expect(Math.round(800 - (after.y + after.height))).toBe(16);
  });

  test("on a phone the first-visit hint leaves the page, so the strip is not held back by a hint nobody can see", async ({ page }) => {
    await open(page, 390, { strip: true, hint: true });
    await expect(page.getByTestId("farah-first-visit-hint")).toHaveCount(0);
    await expect(page.getByTestId("install-strip")).toBeVisible();
  });

  test("at 1280 the hint is still there beside the panel", async ({ page }) => {
    await open(page, 1280, { hint: true });
    await expect(page.getByTestId("farah-first-visit-hint")).toBeVisible();
  });
});

test.describe("the launcher and the account menu's side switch in the same header (absorbing #994)", () => {
  const SEEKER = { creditsBalance: 5, activePass: null, initials: "SH", email: "sam.hall@example.test", displayName: "Sam Hall" };

  async function mountHeader(page: Page, width: number, extra: Record<string, unknown>) {
    await page.route(`${ORIGIN}/**`, (route) => route.fulfill({ status: 200, contentType: "text/html", body: html }));
    await page.setViewportSize({ width, height: 800 });
    await page.goto(`${ORIGIN}/`);
    await page.evaluate(() => {
      localStorage.setItem("talentrah.farahLauncher", '{"v":1,"opened":true}');
      window.__pathname = "/jobs";
    });
    await page.evaluate((props) => window.__mountHeader(props), { ...SEEKER, ...extra });
    await page.waitForSelector('[data-testid="masthead"]', { state: "attached" });
  }

  for (const width of [390, 1280]) {
    test(`${width}: the signed-in header shows the account menu with "Switch to Employer" AND the page has its Farah entry (launcher on a phone, docked panel from 760)`, async ({ page }) => {
      await mountHeader(page, width, { isOrganisationMember: true });
      await page.getByRole("button", { name: "Account menu" }).click();
      await expect(page.getByRole("menuitem", { name: "Switch to Employer" })).toBeVisible();
      await expect(page.getByRole("menuitem", { name: "Sign out" })).toBeVisible();
      await page.keyboard.press("Escape");
      if (width < 760) {
        await expect(launcher(page)).toBeVisible();
        // The launcher floats clear of the header, and opening the sheet works with the menu closed.
        const header = await box(page, "masthead-band");
        const l = await box(page, "farah-launcher");
        expect(l.y).toBeGreaterThanOrEqual(header.y + header.height);
        await launcher(page).click();
        await expect(sheet(page)).toHaveAttribute("data-sheet", "open");
      } else {
        await expect(launcher(page)).toBeHidden();
        await expect(page.getByTestId("farah-panel")).toBeVisible();
      }
    });
  }

  test("390: the account menu and the sheet do not fight: opening the menu leaves the launcher where it was, and an account that cannot switch has no switch item but still has the launcher", async ({ page }) => {
    await mountHeader(page, 390, {});
    await page.getByRole("button", { name: "Account menu" }).click();
    await expect(page.getByRole("menuitem", { name: /Switch to/ })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(launcher(page)).toBeVisible();
  });
});
