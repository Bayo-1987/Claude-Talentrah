import { test, expect, type Page } from "@playwright/test";
import { buildHarnessHtml } from "./support/farah-launcher-harness/build";

/**
 * The Farah launcher sheet must not make an iPhone zoom in (owner report, 27 Oct 2026: after tapping the composer the owner had to pinch the page out to reach the Send button).
 *
 * Safari on iPhone zooms the page when a text field whose font size is under 16px takes focus, by 16 divided by the field's size, and stays zoomed after the keyboard closes. The composer was 12.5px, so
 * the zoom was 1.28: a sheet 390px wide then shows only its left 305px, and the Send button (which ends at 355px) is off the right edge. The fix is a 16px minimum on phones; pinch-zoom itself must stay
 * possible (no maximum-scale and no user-scalable=no: tests/farah/viewport-allows-zoom.test.ts).
 *
 * The page is the REAL Farah panel inside the REAL sheet host (support/farah-launcher-harness, `__mountRealPanel`); its history is answered by the spec. No app server, no database. Chromium cannot zoom on
 * focus, so what is pinned here is the CAUSE (the computed font size of every text-entry control in the open sheet) and the CONSEQUENCE modelled from it (the width a person can see, the layout width divided
 * by the zoom that font size would cause, must contain the Send button), plus the plain fit of the sheet with the on-screen keyboard emulated. A real iPhone is the only full proof.
 */
const ORIGIN = "http://harness.test";
let html = "";
test.beforeAll(async () => {
  html = await buildHarnessHtml();
});

const PHONE_WIDTHS = [320, 375, 390, 430] as const;
const LONG_REPLY = Array.from({ length: 24 }, (_, i) => `Paragraph ${i + 1}: here is a longer piece of advice about how to prepare for the conversation, with enough words to wrap onto a second line on a phone.`).join("\n\n") + "\n\nTHE END of the reply.";
const LONG_THREAD = {
  messages: [
    { id: "u1", role: "user", content: "Help me prepare.", created_at: new Date(Date.now() - 120_000).toISOString() },
    { id: "f1", role: "farah", content: LONG_REPLY, created_at: new Date(Date.now() - 60_000).toISOString() },
  ],
  freeMessagesRemaining: 2,
  nextFreeMessageAt: null,
  hasUnreadNotification: false,
};
const EMPTY = { messages: [], freeMessagesRemaining: 3, nextFreeMessageAt: null, hasUnreadNotification: false };

async function mountPanel(page: Page, width: number, opts: { keyboard?: boolean; history?: object } = {}) {
  if (opts.keyboard) {
    // An emulated on-screen keyboard: window.visualViewport is replaced by a small object whose height the test shrinks (as src/lib/farah/keyboard-open.ts reads it).
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
  await page.route(`${ORIGIN}/**`, (route) => route.fulfill({ status: 200, contentType: "text/html", body: html }));
  await page.route("**/api/farah/history", (route) => route.fulfill({ json: opts.history ?? EMPTY }));
  await page.setViewportSize({ width, height: 800 });
  await page.goto(`${ORIGIN}/`);
  await page.evaluate(() => {
    localStorage.setItem("talentrah.farahLauncher", '{"v":1,"opened":true}');
    window.__pathname = "/jobs";
    window.__mountRealPanel();
  });
  await page.waitForSelector('[data-testid="farah-sheet"]', { state: "attached" });
}

async function openSheet(page: Page, width: number, opts: { keyboard?: boolean; history?: object } = {}) {
  await mountPanel(page, width, opts);
  await page.getByTestId("farah-launcher").click();
  await expect(page.getByTestId("farah-sheet")).toHaveAttribute("data-sheet", "open");
  await expect(page.getByRole("button", { name: "Send to Farah" })).toBeVisible();
  await page.waitForTimeout(400); // the slide-in
}

/** Every control in the sheet that opens a text keyboard on a phone, with its computed font size (plain JS so no tooling helper leaks into the page). */
function textEntryControls(page: Page) {
  return page.evaluate(`(function () {
    var out = [];
    var all = document.getElementById("farah-sheet").querySelectorAll("input, textarea, select, [contenteditable=''], [contenteditable='true']");
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      var type = (el.getAttribute("type") || "").toLowerCase();
      if (el.tagName === "INPUT" && ["hidden", "checkbox", "radio", "file", "submit", "button", "reset", "image", "range", "color"].indexOf(type) !== -1) continue;
      out.push({ tag: el.tagName.toLowerCase(), name: el.getAttribute("name") || el.getAttribute("aria-label") || "", fontPx: parseFloat(getComputedStyle(el).fontSize) });
    }
    return out;
  })()`) as Promise<Array<{ tag: string; name: string; fontPx: number }>>;
}

function sendAndSheetGeometry(page: Page) {
  return page.evaluate(`(function () {
    var sheet = document.getElementById("farah-sheet");
    var vw = document.documentElement.clientWidth;
    var over = [];
    var all = sheet.querySelectorAll("*");
    for (var i = 0; i < all.length; i++) {
      var r = all[i].getBoundingClientRect();
      if (r.width > 0 && r.right > vw + 0.5) over.push(all[i].tagName.toLowerCase() + " right=" + Math.round(r.right));
    }
    var send = document.querySelector('button[aria-label="Send to Farah"]');
    var s = send.getBoundingClientRect();
    var top = document.elementFromPoint(s.left + s.width / 2, s.top + s.height / 2);
    return { vw: vw, sheetScrollWidth: sheet.scrollWidth, sheetClientWidth: sheet.clientWidth, over: over.slice(0, 6), send: { left: s.left, right: s.right, width: s.width, height: s.height }, sendIsTopmost: !!top && (top === send || send.contains(top)) };
  })()`) as Promise<{ vw: number; sheetScrollWidth: number; sheetClientWidth: number; over: string[]; send: { left: number; right: number; width: number; height: number }; sendIsTopmost: boolean }>;
}

for (const width of PHONE_WIDTHS) {
  test.describe(`${width}px`, () => {
    test("every text-entry control in the open sheet is at least 16px, so an iPhone does not zoom when it takes focus", async ({ page }) => {
      await openSheet(page, width);
      const controls = await textEntryControls(page);
      expect(controls.length, "the scan found no text-entry control in the sheet: it would pass for nothing").toBeGreaterThan(0);
      expect(controls.map((c) => c.name)).toContain("farah-message");
      for (const c of controls) expect(c.fontPx, `the ${c.tag} "${c.name}" is ${c.fontPx}px; Safari on iPhone zooms the page on focus under 16px`).toBeGreaterThanOrEqual(16);
    });

    test("with the zoom the composer's font size would cause on an iPhone, Send is still inside what a person can see", async ({ page }) => {
      await openSheet(page, width);
      const [composer] = (await textEntryControls(page)).filter((c) => c.name === "farah-message");
      const g = await sendAndSheetGeometry(page);
      const zoom = Math.max(1, 16 / composer.fontPx);
      expect(g.send.right, `zoom ${zoom.toFixed(2)}: an iPhone would show only the left ${Math.floor(g.vw / zoom)}px of ${g.vw}; Send ends at ${Math.round(g.send.right)}px`).toBeLessThanOrEqual(g.vw / zoom);
    });

    test("with the on-screen keyboard up (shrunken visual viewport) and a long unbroken string typed, the sheet and Send stay inside the viewport", async ({ page }) => {
      await openSheet(page, width, { keyboard: true });
      const box = page.getByRole("textbox", { name: "Ask me anything…" });
      await box.focus();
      await page.evaluate("window.__setVisualHeight(420)");
      await box.fill("x".repeat(300) + " " + "y".repeat(120));
      await page.waitForTimeout(250);
      const g = await sendAndSheetGeometry(page);
      expect(g.sheetScrollWidth, "the sheet scrolls sideways").toBeLessThanOrEqual(g.sheetClientWidth);
      expect(g.over, "parts of the sheet are right of the viewport").toEqual([]);
      expect(g.send.left).toBeGreaterThanOrEqual(0);
      expect(g.send.right, "Send runs past the viewport edge").toBeLessThanOrEqual(g.vw);
      expect(g.send.width).toBeGreaterThanOrEqual(44);
      expect(g.send.height).toBeGreaterThanOrEqual(44);
      expect(g.sendIsTopmost, "something covers the centre of Send").toBe(true);
    });
  });
}

test.describe("a long Farah reply can be read to its end in the sheet's message area", () => {
  for (const [width, height] of [[390, 800], [375, 667], [320, 568]] as const) {
    test(`${width}x${height}: scrolling the message area to the bottom shows the last line of the reply in full`, async ({ page }) => {
      await mountPanel(page, width, { history: LONG_THREAD });
      await page.setViewportSize({ width, height });
      await page.getByTestId("farah-launcher").click();
      await expect(page.getByTestId("farah-sheet")).toHaveAttribute("data-sheet", "open");
      await expect(page.getByText("THE END of the reply.")).toHaveCount(1);
      await page.waitForTimeout(500);
      const m = (await page.evaluate(`(function () {
        var scroller = document.querySelector('[data-testid="farah-panel-scroller"]');
        scroller.scrollTop = scroller.scrollHeight;
        var sheet = document.getElementById("farah-sheet");
        sheet.scrollTop = sheet.scrollHeight;
        var last = [].slice.call(scroller.querySelectorAll("p")).filter(function (p) { return p.textContent.indexOf("THE END") !== -1; })[0];
        var send = document.querySelector('button[aria-label="Send to Farah"]').getBoundingClientRect();
        var s = scroller.getBoundingClientRect();
        var l = last.getBoundingClientRect();
        return { scrollerTop: s.top, scrollerBottom: s.bottom, lastTop: l.top, lastBottom: l.bottom, atEnd: Math.abs(scroller.scrollTop + scroller.clientHeight - scroller.scrollHeight) <= 1, scrollerHeight: s.height, sendBottom: send.bottom, vh: window.innerHeight };
      })()`)) as { scrollerTop: number; scrollerBottom: number; lastTop: number; lastBottom: number; atEnd: boolean; scrollerHeight: number; sendBottom: number; vh: number };
      // Reading to the end: the message area scrolls to the very end and the last line is whole inside it.
      expect(m.atEnd, "the message area cannot be scrolled to its end").toBe(true);
      expect(m.scrollerHeight, "the message area is too short to read in").toBeGreaterThanOrEqual(100);
      expect(m.lastBottom, "the last line is cut off at the bottom of the message area").toBeLessThanOrEqual(m.scrollerBottom + 1);
      expect(m.lastTop, "the last line is above the message area").toBeGreaterThanOrEqual(m.scrollerTop - 1);
      // Reaching Send: on a short phone the sheet's own content is taller than the sheet (message area plus composer), so Send is reached by scrolling the SHEET; it must be reachable that way.
      expect(m.sendBottom, "Send cannot be brought onto the screen by scrolling the sheet").toBeLessThanOrEqual(m.vh);
    });
  }
});

test.describe("the docked composer from 760px is unchanged", () => {
  for (const width of [760, 1280]) {
    test(`${width}px: the composer keeps its 12.5px size (the 16px minimum is for phones only)`, async ({ page }) => {
      await mountPanel(page, width);
      await expect(page.getByRole("textbox", { name: "Ask me anything…" })).toBeVisible();
      const composer = (await textEntryControls(page)).find((c) => c.name === "farah-message");
      expect(composer?.fontPx).toBe(12.5);
    });
  }
});
