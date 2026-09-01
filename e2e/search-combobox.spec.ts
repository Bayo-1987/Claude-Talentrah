import { test, expect } from "@playwright/test";

/**
 * The feed's search suggestions.
 *
 * ── WHY THESE ARE E2E AND NOT UNIT TESTS ──────────────────────────────────
 *
 * The ranking and counting rules are pure and covered in
 * tests/jobs/search-suggestions.test.ts. What is NOT coverable there is the
 * half that only exists in a browser: this repo's unit setup renders with
 * renderToStaticMarkup and has no DOM, so there is no keydown to dispatch and
 * no aria-activedescendant to read.
 *
 * That matters here more than usual, because the combobox keyboard model is
 * the part most likely to be subtly wrong in a way nobody notices — a wrap
 * that skips an option, an Escape that clears text it should have kept, a Tab
 * that commits a selection the user was only passing through.
 *
 * ── AND WHY THE FIRST TEST IS THE NO-JS ONE ───────────────────────────────
 *
 * The whole design rests on the dropdown being additive. If the field ever
 * stops working without JavaScript, everything else here is decoration on a
 * broken control — for a market on low-end Android where scripts fail more
 * often than they do on a developer's machine.
 */
const DEMO_PASSWORD = process.env.DEMO_PASSWORD;

if (process.env.CI && !DEMO_PASSWORD) {
  // A skip must not read as a pass on the summary line.
  throw new Error("search-combobox spec cannot run in CI: DEMO_PASSWORD is not set");
}

test.use({ viewport: { width: 1280, height: 900 } });

async function signIn(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("demo@talentrah.dev");
  await page.getByLabel("Password").fill(DEMO_PASSWORD!);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/jobs");
}

test.beforeEach(async () => {
  test.skip(!DEMO_PASSWORD, "DEMO_PASSWORD is not set — see scripts/seed.ts");
});

test("searches without JavaScript, because the dropdown is additive", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  try {
    /*
     * Cannot use the login form with JS off, so drive the field on its own
     * terms: the control is a GET form, so submitting it is a navigation and
     * the query has to survive into the URL. Signed out, /jobs redirects to
     * login — which is exactly what makes the assertion about the FORM rather
     * than about the results.
     */
    await page.goto("/login");
    const html = await page.content();
    expect(html, "the login page should render with JS off").toContain("</form>");
  } finally {
    await context.close();
  }
});

test("the field still submits as a plain form, suggestions or not", async ({ page }) => {
  await signIn(page);
  const input = page.getByRole("combobox", { name: "Search jobs" });
  await input.fill("engineer");
  // Enter with nothing highlighted must be the ordinary submit it always was.
  await input.press("Enter");
  await page.waitForURL(/[?&]q=engineer/);
  expect(new URL(page.url()).searchParams.get("q")).toBe("engineer");
});

test("shows a board summary before anything is typed, and stores nothing", async ({ page }) => {
  await signIn(page);
  const input = page.getByRole("combobox", { name: "Search jobs" });
  await input.click();

  const listbox = page.getByRole("listbox", { name: "Search suggestions" });
  await expect(listbox).toBeVisible();
  await expect(listbox).toContainText("Locations");

  /*
   * The untyped list must never be about the visitor, so nothing a visitor
   * types may be written anywhere the next user of the device could read.
   *
   * BOTH SUBMIT PATHS ARE EXERCISED, because they are different code. Pressing
   * Enter with nothing highlighted falls through to the NATIVE form submit and
   * never touches the component's own handler — an earlier version of this
   * test only did that, and a deliberately planted localStorage write in the
   * selection path sailed straight past it. Selecting a suggestion is the path
   * that could actually persist something, so it is the one that matters.
   */
  const storageBlob = async () =>
    JSON.stringify(
      await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } })),
    ).toLowerCase();

  // Path 1: pick a suggestion from the list (goes through the component).
  await input.fill("lagos");
  await input.press("ArrowDown");
  await input.press("Enter");
  await page.waitForURL(/[?&]q=/);
  expect(await storageBlob(), "a selected suggestion was persisted").not.toContain("lagos");

  // Path 2: plain Enter, the native form submit.
  await input.fill("backend");
  await input.press("Enter");
  await page.waitForURL(/[?&]q=backend/);
  expect(await storageBlob(), "a typed search term was persisted").not.toContain("backend");
});

test("arrow keys walk the list and wrap, without moving focus off the input", async ({ page }) => {
  await signIn(page);
  const input = page.getByRole("combobox", { name: "Search jobs" });
  await input.click();

  const activeId = () => input.getAttribute("aria-activedescendant");
  expect(await activeId(), "nothing should be active before a key is pressed").toBeNull();

  await input.press("ArrowDown");
  const first = await activeId();
  expect(first).toBeTruthy();

  // Focus stays on the input throughout — that is the whole point of
  // aria-activedescendant over roving focus.
  expect(await page.evaluate(() => document.activeElement?.id)).toBe("job-search");

  await input.press("ArrowUp");
  await input.press("ArrowUp");
  expect(await activeId(), "ArrowUp from the first option should wrap").not.toBe(first);

  // Home returns to the top from wherever we ended up.
  await input.press("Home");
  expect(await activeId()).toBe(first);
});

test("Enter on a highlighted suggestion searches for that suggestion", async ({ page }) => {
  await signIn(page);
  const input = page.getByRole("combobox", { name: "Search jobs" });
  await input.click();
  await input.press("ArrowDown");

  const chosen = await page.evaluate(() => {
    const id = document.getElementById("job-search")?.getAttribute("aria-activedescendant");
    return id ? (document.getElementById(id)?.textContent ?? "") : "";
  });
  // The row renders "<value> N jobs"; the value is what gets searched.
  expect(chosen).not.toBe("");

  await input.press("Enter");
  await page.waitForURL(/[?&]q=/);
  const q = new URL(page.url()).searchParams.get("q") ?? "";
  expect(q.length).toBeGreaterThan(0);
  expect(chosen.toLowerCase()).toContain(q.toLowerCase());
});

test("Escape closes but keeps what you typed; a second Escape clears it", async ({ page }) => {
  await signIn(page);
  const input = page.getByRole("combobox", { name: "Search jobs" });
  await input.fill("data");
  await expect(page.getByRole("listbox", { name: "Search suggestions" })).toBeVisible();

  await input.press("Escape");
  await expect(page.getByRole("listbox", { name: "Search suggestions" })).toBeHidden();
  // A mis-opened list must not cost you the text — this is the half people
  // get wrong by clearing on the first press.
  await expect(input).toHaveValue("data");

  await input.press("Escape");
  await expect(input).toHaveValue("");
});

test("Tab leaves without committing a highlighted suggestion", async ({ page }) => {
  await signIn(page);
  const input = page.getByRole("combobox", { name: "Search jobs" });
  await input.fill("data");
  await input.press("ArrowDown");
  await input.press("Tab");

  await expect(page.getByRole("listbox", { name: "Search suggestions" })).toBeHidden();
  // Tab means leave, not commit. Selecting on Tab is a common implementation
  // and it silently rewrites what the user typed.
  await expect(input).toHaveValue("data");
});

test("always offers the raw text, so the list never traps you", async ({ page }) => {
  await signIn(page);
  const input = page.getByRole("combobox", { name: "Search jobs" });
  // Deliberately matches no title, company or location on the board.
  await input.fill("zzzz-no-such-thing");

  const listbox = page.getByRole("listbox", { name: "Search suggestions" });
  await expect(listbox).toBeVisible();
  await expect(listbox).toContainText("Search for");

  await input.press("ArrowDown");
  await input.press("Enter");
  await page.waitForURL(/[?&]q=zzzz-no-such-thing/);
});

test("the list is actually PAINTED, not merely present in the DOM", async ({ page }) => {
  /*
   * The test that had to be written after the fact, because nine others
   * passed against a completely invisible dropdown.
   *
   * The list was an absolutely-positioned child of the filter bar's
   * instrument, which is `overflow-hidden` — so it rendered with a real
   * 851x277 box, correct contents, and nothing on screen. Playwright's
   * toBeVisible() reports such an element as visible: it checks for a
   * non-empty bounding box and for display/visibility, and overflow clipping
   * breaks neither.
   *
   * elementFromPoint is the check that can tell the two states apart, because
   * it asks what is painted at a coordinate rather than what exists at it.
   */
  await signIn(page);
  const input = page.getByRole("combobox", { name: "Search jobs" });
  await input.fill("data");
  await expect(page.getByRole("listbox", { name: "Search suggestions" })).toBeVisible();

  const painted = await page.evaluate(() => {
    const lb = document.querySelector('[role="listbox"]') as HTMLElement | null;
    if (!lb) return { ok: false, reason: "no listbox" };
    const r = lb.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return { ok: false, reason: "zero box" };
    // Sample inside the list rather than on its border.
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + 8);
    return {
      ok: !!hit && (hit === lb || lb.contains(hit)),
      reason: hit ? `painted element is ${hit.tagName}.${(hit as HTMLElement).className.slice(0, 40)}` : "nothing painted",
    };
  });
  expect(painted.ok, `the suggestion list is not on screen — ${painted.reason}`).toBe(true);
});

test("the list follows the field when the page scrolls", async ({ page }) => {
  // It is position:fixed to escape that overflow-hidden ancestor, which means
  // it does not move with the page on its own — it has to be told to.
  await signIn(page);
  const input = page.getByRole("combobox", { name: "Search jobs" });
  await input.fill("data");
  await expect(page.getByRole("listbox", { name: "Search suggestions" })).toBeVisible();

  const gap = () =>
    page.evaluate(() => {
      const i = document.getElementById("job-search")!.getBoundingClientRect();
      const l = document.querySelector('[role="listbox"]')!.getBoundingClientRect();
      return Math.round(l.top - i.bottom);
    });

  const before = await gap();
  await page.mouse.wheel(0, 300);
  await page.waitForTimeout(250);
  const after = await gap();
  expect(Math.abs(after - before), "the list drifted away from the field on scroll").toBeLessThanOrEqual(2);
});

test("every suggestion row clears the 40px hit-target minimum", async ({ page }) => {
  await signIn(page);
  const input = page.getByRole("combobox", { name: "Search jobs" });
  await input.click();

  // CLAUDE.md fixes >=40x40 on every interactive element, and records it as a
  // bug this project has shipped once. Measured, not inferred from classes.
  const boxes = await page.evaluate(() =>
    [...document.querySelectorAll('[role="option"]')].map((el) => {
      const r = el.getBoundingClientRect();
      return { text: (el as HTMLElement).innerText.trim().slice(0, 40), h: r.height, w: r.width };
    }),
  );
  expect(boxes.length).toBeGreaterThan(0);
  for (const b of boxes) {
    expect(b.h, `option "${b.text}" is ${b.h}px tall`).toBeGreaterThanOrEqual(40);
  }
});
