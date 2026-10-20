import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { test, expect, admin } from "./fixtures/authed";
import type { Page } from "@playwright/test";
import { ATS_TEST_RESUME } from "@/lib/resume-builder/ats-test-fixture";
import { deleteOrgsCascade } from "../tests/support/delete-orgs";
import { waitForWorkerControl } from "./support/pwa";

/**
 * The install strip in the EMPLOYER shell (src/app/employer/layout.tsx): the same shared strip as the seeker shell's, in the signed-in branch only, hidden under PWA_KILL=1, hidden in
 * print, and never on top of a page's primary action. Local stack or CI only (./fixtures/authed refuses production).
 *
 * Chromium never offers an install prompt in automation, so the specs dispatch a `beforeinstallprompt`-shaped event; what is real is everything the strip does with it.
 * Screenshots of the four primary-action cases are written to $S4_SHOT_DIR when it is set (and always attached to the test report).
 */

const CONSENTED = () => localStorage.setItem("talentrah-cookie-consent", "accepted");
const strip = (page: Page) => page.getByTestId("install-strip");

async function firePrompt(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __promptCalls?: number };
    w.__promptCalls = 0;
    const ev = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
      prompt: () => {
        w.__promptCalls = (w.__promptCalls ?? 0) + 1;
        return Promise.resolve();
      },
      userChoice: Promise.resolve({ outcome: "accepted" as const }),
    });
    window.dispatchEvent(ev);
  });
}

const IPHONE_SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";

/** A verified organisation owned by the test user, with an open posting and `applicants` applications (the first one with a resume). */
async function employerFixture(ownerId: string, applicants = 0) {
  const tag = randomUUID().slice(0, 8);
  const { data: org, error } = await admin.from("organizations").insert({ name: `E2E Employer Co strip ${tag}`, created_by: ownerId, verified: true }).select("id, name").single();
  if (error || !org) throw new Error(`org: ${error?.message}`);
  await admin.from("organization_members").insert({ organization_id: org.id, user_id: ownerId, role: "owner" });
  const { data: job, error: jobError } = await admin
    .from("job_postings")
    .insert({ source_type: "internal", organization_id: org.id, company_name: org.name, title: `E2E strip role ${tag}`, description: "Fixture posting for the employer install strip spec.", structured_jd: {}, status: "open", posted_at: new Date().toISOString(), dedup_fingerprint: randomUUID() })
    .select("id")
    .single();
  if (jobError || !job) throw new Error(`job: ${jobError?.message}`);
  const applicantIds: string[] = [];
  const applicationIds: string[] = [];
  const { data: template } = await admin.from("resume_templates").select("id").eq("slug", "blueprint").single();
  for (let i = 0; i < applicants; i += 1) {
    const { data: u, error: ue } = await admin.auth.admin.createUser({ email: `e2e-strip-${randomUUID()}@${tag}.talentrah.test`, email_confirm: true });
    if (ue || !u.user) throw new Error(`applicant: ${ue?.message}`);
    applicantIds.push(u.user.id);
    await admin.from("profiles").update({ first_name: `Applicant${i + 1}`, last_name: "Strip" }).eq("id", u.user.id);
    let resumeId: string | null = null;
    if (i === 0 && template) {
      const { data: r } = await admin
        .from("resumes")
        .insert({ user_id: u.user.id, title: "Employer strip fixture", is_base: false, source: "builder", template_id: template.id, structured_content: JSON.parse(JSON.stringify(ATS_TEST_RESUME)) })
        .select("id")
        .single();
      resumeId = r?.id ?? null;
    }
    const { data: app, error: ae } = await admin
      .from("applications")
      .insert({ user_id: u.user.id, job_posting_id: job.id, resume_id: resumeId, stage: "applied", source: "internal_apply", applied_at: new Date().toISOString() })
      .select("id")
      .single();
    if (ae || !app) throw new Error(`application: ${ae?.message}`);
    applicationIds.push(app.id);
  }
  return {
    orgId: org.id,
    jobId: job.id,
    applicationIds,
    cleanup: async () => {
      await deleteOrgsCascade(admin, [org.id]);
      for (const id of applicantIds) await admin.auth.admin.deleteUser(id);
    },
  };
}

test.describe("the strip in the signed-in employer shell", () => {
  test("a signed-in employer on /employer/jobs sees it once a prompt was captured; Install calls prompt() once and it goes", async ({ authedPage: page, testUser }) => {
    const f = await employerFixture(testUser.id);
    try {
      await page.addInitScript(CONSENTED);
      await page.goto("/employer/jobs");
      await waitForWorkerControl(page);
      await expect(page.getByRole("link", { name: "Jobs Posted" }).first()).toBeVisible(); // the employer masthead
      await expect(strip(page)).toHaveCount(0); // nothing to offer yet
      await firePrompt(page);
      await expect(strip(page)).toBeVisible();
      await expect(strip(page)).toContainText("Add Talentrah to your home screen.");
      await page.getByRole("button", { name: "Install" }).click();
      await expect(strip(page)).toHaveCount(0);
      expect(await page.evaluate(() => (window as unknown as { __promptCalls: number }).__promptCalls)).toBe(1);
    } finally {
      await f.cleanup();
    }
  });

  test("an iPhone Safari employer gets the Add to Home Screen hint and no Install button", async ({ browser, baseURL, authedPage, testUser }) => {
    const f = await employerFixture(testUser.id);
    const ctx = await browser.newContext({ baseURL, userAgent: IPHONE_SAFARI, viewport: { width: 390, height: 844 } });
    try {
      await ctx.addCookies(await authedPage.context().cookies());
      const p = await ctx.newPage();
      await p.addInitScript(CONSENTED);
      await p.goto("/employer/jobs");
      await expect(strip(p)).toBeVisible();
      await expect(strip(p)).toContainText("To install: tap Share, then Add to Home Screen.");
      await expect(p.getByRole("button", { name: "Install" })).toHaveCount(0);
    } finally {
      await ctx.close();
      await f.cleanup();
    }
  });

  test("not when the app is already installed (standalone)", async ({ authedPage: page, testUser }) => {
    const f = await employerFixture(testUser.id);
    try {
      await page.addInitScript(() => {
        localStorage.setItem("talentrah-cookie-consent", "accepted");
        const real = window.matchMedia.bind(window);
        window.matchMedia = (q: string) => (q === "(display-mode: standalone)" ? ({ matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} } as unknown as MediaQueryList) : real(q));
      });
      await page.goto("/employer/jobs");
      await waitForWorkerControl(page);
      await firePrompt(page);
      await page.waitForTimeout(800);
      await expect(strip(page)).toHaveCount(0);
    } finally {
      await f.cleanup();
    }
  });

  test("not within 30 days of Not now; and Not now persists across the employer pages", async ({ authedPage: page, testUser }) => {
    const f = await employerFixture(testUser.id);
    try {
      await page.addInitScript(CONSENTED);
      await page.goto("/employer/jobs");
      await waitForWorkerControl(page);
      await firePrompt(page);
      await expect(strip(page)).toBeVisible();
      await page.getByRole("button", { name: "Not now" }).click();
      await expect(strip(page)).toHaveCount(0);
      for (const route of ["/employer/profile", "/employer/campaigns", "/employer/analytics", "/employer/jobs"]) {
        await page.goto(route);
        await firePrompt(page);
        await page.waitForTimeout(500);
        await expect(strip(page), `still dismissed on ${route}`).toHaveCount(0);
      }
      // The dismissal is the one the seeker shell uses (same key): a stored timestamp inside 30 days keeps it away, one 31 days old does not.
      await page.evaluate(() => localStorage.setItem("talentrah-install-dismissed", String(Date.now() - 31 * 24 * 60 * 60 * 1000)));
      await page.reload();
      await firePrompt(page);
      await expect(strip(page)).toBeVisible();
    } finally {
      await f.cleanup();
    }
  });
});

test.describe("where it must not show", () => {
  test("a signed-out visitor on the public /employer marketing page, and on an employer route that sends them to login, gets none", async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ baseURL });
    const p = await ctx.newPage();
    try {
      await p.addInitScript(CONSENTED);
      await p.goto("/employer");
      await waitForWorkerControl(p);
      await firePrompt(p);
      await p.waitForTimeout(800);
      await expect(strip(p), "the public /employer page").toHaveCount(0);
      await p.goto("/employer/jobs"); // signed out: the page's own check redirects to /login
      await firePrompt(p);
      await p.waitForTimeout(500);
      await expect(strip(p), "an employer route, signed out").toHaveCount(0);
    } finally {
      await ctx.close();
    }
  });
});

test.describe("hidden in print", () => {
  test("neither the bar nor its spacer is visible under print media, on the employer pages including the applicant resume", async ({ authedPage: page, testUser }) => {
    test.setTimeout(120_000);
    const f = await employerFixture(testUser.id, 1);
    try {
      await page.addInitScript(CONSENTED);
      for (const route of ["/employer/jobs", `/employer/jobs/${f.jobId}/applicants/${f.applicationIds[0]}/resume`]) {
        await page.goto(route);
        await waitForWorkerControl(page);
        await firePrompt(page);
        await expect(strip(page), `screen: the strip shows on ${route}`).toBeVisible();
        await expect(page.getByTestId("install-strip-spacer")).toBeAttached();
        await page.emulateMedia({ media: "print" });
        await expect(strip(page), `print: the bar on ${route}`).toBeHidden();
        const spacer = await page.getByTestId("install-strip-spacer").evaluate((el) => ({ display: getComputedStyle(el).display, height: el.getBoundingClientRect().height }));
        expect(spacer, `print: the spacer on ${route}`).toEqual({ display: "none", height: 0 });
        await page.emulateMedia({ media: "screen" });
      }
    } finally {
      await f.cleanup();
    }
  });
});

test.describe("never on top of a page's primary action", () => {
  const SHOT_DIR = process.env.S4_SHOT_DIR;

  /** The bottom-most interactive control in the page content, scrolled to the end: its rectangle must not meet the bar, and a real click must reach it. */
  async function checkBottomControl(page: Page, label: string, info: import("@playwright/test").TestInfo) {
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(400);
    const probe = await page.evaluate(() => {
      const bar = document.querySelector('[data-testid="install-strip"]')!.getBoundingClientRect();
      const nodes = Array.from(document.querySelectorAll<HTMLElement>("main button, main select, main a[href], main input:not([type=hidden]), #main-content button, #main-content select, #main-content a[href], #main-content input:not([type=hidden]), body > div button, body > div select, body > div a[href]")).filter((el) => {
        if (el.closest('[data-testid="install-strip"]')) return false;
        if (el.closest("header, nav, [data-testid=masthead-band], [data-testid=masthead]")) return false;
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return cs.display !== "none" && cs.visibility !== "hidden" && r.width > 0 && r.height > 0 && r.top < window.innerHeight;
      });
      nodes.sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom);
      const el = nodes[0];
      el.setAttribute("data-s4-bottom-control", "1");
      const r = el.getBoundingClientRect();
      (window as unknown as { __s4Hit?: boolean }).__s4Hit = false;
      el.addEventListener(
        "pointerdown",
        () => {
          (window as unknown as { __s4Hit?: boolean }).__s4Hit = true;
        },
        true,
      );
      el.addEventListener("click", (e) => e.preventDefault(), true); // a click must reach it, but must not submit or leave the page
      return { label: (el.textContent || el.getAttribute("aria-label") || el.tagName).trim().slice(0, 40), tag: el.tagName, x: r.left + r.width / 2, y: r.top + r.height / 2, top: r.top, bottom: r.bottom, left: r.left, right: r.right, bar: { top: bar.top, bottom: bar.bottom, left: bar.left, right: bar.right }, vh: window.innerHeight };
    });
    // The lowest piece of real CONTENT on the page (text, media, controls; wrappers and spacers are not content), page scrolled to its end: it must end above the bar's top edge too,
    // not only the bottom control, so a card or paragraph running under the bar is caught as well.
    const lastContentBottom = await page.evaluate(() => {
      const MEDIA = new Set(["IMG", "SVG", "CANVAS", "VIDEO", "INPUT", "TEXTAREA", "SELECT", "BUTTON", "HR"]);
      let max = 0;
      for (const el of document.querySelectorAll<HTMLElement>("body *")) {
        const cs = getComputedStyle(el);
        if (cs.position === "fixed" || cs.display === "none" || cs.visibility === "hidden") continue;
        if (el.closest('[data-testid="install-strip"], [data-testid="install-strip-spacer"], [aria-hidden="true"], script, style')) continue;
        const ownText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent ?? "").trim() !== "");
        if (!ownText && !MEDIA.has(el.tagName.toUpperCase())) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        max = Math.max(max, r.bottom);
      }
      return max;
    });
    const overlap = probe.left < probe.bar.right && probe.right > probe.bar.left && probe.top < probe.bar.bottom && probe.bottom > probe.bar.top;
    await page.mouse.click(probe.x, probe.y);
    const reached = await page.evaluate(() => (window as unknown as { __s4Hit?: boolean }).__s4Hit === true);
    const shot = await page.screenshot();
    await info.attach(label, { body: shot, contentType: "image/png" });
    if (SHOT_DIR) {
      mkdirSync(SHOT_DIR, { recursive: true });
      await page.screenshot({ path: path.join(SHOT_DIR, `${label}.png`) });
    }
    console.log(`S4_PRIMARY ${label} ${JSON.stringify({ control: probe.label, tag: probe.tag, controlTop: Math.round(probe.top), controlBottom: Math.round(probe.bottom), barTop: Math.round(probe.bar.top), barBottom: Math.round(probe.bar.bottom), viewport: probe.vh, overlap, lastContentBottom: Math.round(lastContentBottom), clickReached: reached })}`);
    expect(probe.bottom, `${label}: the control ('${probe.label}') is inside the viewport`).toBeLessThanOrEqual(probe.vh + 0.5);
    expect(overlap, `${label}: the bar (${Math.round(probe.bar.top)}-${Math.round(probe.bar.bottom)}) covers the bottom control '${probe.label}' (${Math.round(probe.top)}-${Math.round(probe.bottom)})`).toBe(false);
    expect(lastContentBottom, `${label}: the lowest content (${Math.round(lastContentBottom)}) must end above the bar's top edge (${Math.round(probe.bar.top)})`).toBeLessThanOrEqual(probe.bar.top + 0.5);
    expect(reached, `${label}: a real click at the control's centre reaches it`).toBe(true);
  }

  for (const [width, height] of [[390, 844], [1280, 800]] as const) {
    test(`${width}px: the wallet top-up on /employer/campaigns is not covered and stays clickable`, async ({ authedPage: page, testUser }, info) => {
      const f = await employerFixture(testUser.id);
      try {
        await page.setViewportSize({ width, height });
        await page.addInitScript(CONSENTED);
        await page.goto("/employer/campaigns");
        await expect(page.getByRole("button", { name: "Continue to Paystack" })).toBeVisible();
        await waitForWorkerControl(page);
        await firePrompt(page);
        await expect(strip(page)).toBeVisible();
        await page.waitForTimeout(300);
        // The named primary action, by itself, first: its whole box above the bar when scrolled to the end, and a real click reaches it.
        await checkBottomControl(page, `wallet-topup-${width}`, info);
        const topUp = page.getByRole("button", { name: "Continue to Paystack" });
        await topUp.scrollIntoViewIfNeeded();
        const [t, bar] = [await topUp.boundingBox(), await strip(page).boundingBox()];
        // scrolled to the end: the top-up button must be fully visible and not under the bar
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        const t2 = (await topUp.boundingBox())!;
        const bar2 = (await strip(page).boundingBox())!;
        expect(t2.y + t2.height <= bar2.y + 0.5 || t2.y >= bar2.y + bar2.height - 0.5, `${width}px: 'Continue to Paystack' (${Math.round(t2.y)}-${Math.round(t2.y + t2.height)}) vs bar (${Math.round(bar2.y)}-${Math.round(bar2.y + bar2.height)})`).toBe(true);
        void t;
        void bar;
      } finally {
        await f.cleanup();
      }
    });

    test(`${width}px: the applicants page's last controls are not covered and stay clickable`, async ({ authedPage: page, testUser }, info) => {
      test.setTimeout(300_000);
      const f = await employerFixture(testUser.id, 12);
      try {
        await page.setViewportSize({ width, height });
        await page.addInitScript(CONSENTED);
        await page.goto(`/employer/jobs/${f.jobId}/applicants`);
        await expect(page.getByText("Applicant1 Strip")).toBeVisible();
        await waitForWorkerControl(page);
        await firePrompt(page);
        await expect(strip(page)).toBeVisible();
        await page.waitForTimeout(300);
        expect(await page.evaluate(() => document.documentElement.scrollHeight), "the applicants page must be long enough to scroll").toBeGreaterThan(height);
        await checkBottomControl(page, `applicants-${width}`, info);
      } finally {
        await f.cleanup();
      }
    });
  }
});

/**
 * Kill switch: needs a build made and started with PWA_KILL=1 (the layout reads it at request time for the employer shell and the bootstrap at build time), so it runs only when
 * PWA_KILL_PHASE=killed says which server is up (docs/pwa.md has the commands; CI's one normal build skips it).
 */
test.describe("PWA_KILL=1", () => {
  test.skip(process.env.PWA_KILL_PHASE !== "killed", "set PWA_KILL_PHASE=killed against a server built and started with PWA_KILL=1");

  test("the employer shell shows NO strip of any kind: not the Android bar, and not the iOS hint", async ({ browser, baseURL, authedPage, testUser }) => {
    const f = await employerFixture(testUser.id);
    try {
      // Desktop Chromium with a prompt fired anyway (the bootstrap is disabled, so nothing captures it).
      const p = authedPage;
      await p.addInitScript(CONSENTED);
      await p.goto("/employer/jobs");
      await firePrompt(p);
      await p.waitForTimeout(1000);
      await expect(strip(p), "desktop, prompt fired").toHaveCount(0);
      // iPhone Safari, where the hint needs no prompt event.
      const ctx = await browser.newContext({ baseURL, userAgent: IPHONE_SAFARI, viewport: { width: 390, height: 844 } });
      await ctx.addCookies(await authedPage.context().cookies());
      const ios = await ctx.newPage();
      await ios.addInitScript(CONSENTED);
      await ios.goto("/employer/jobs");
      await ios.waitForTimeout(1000);
      await expect(strip(ios), "iPhone Safari").toHaveCount(0);
      await ctx.close();
    } finally {
      await f.cleanup();
    }
  });

  test("REPORT-ONLY PROBE (PWA-KILL-IOS-HINT-1): does the SEEKER shell still show the iOS hint under the kill switch? (records, asserts nothing)", async ({ browser, baseURL, authedPage, testUser }) => {
    const f = await employerFixture(testUser.id);
    try {
      const ctx = await browser.newContext({ baseURL, userAgent: IPHONE_SAFARI, viewport: { width: 390, height: 844 } });
      await ctx.addCookies(await authedPage.context().cookies());
      await admin.from("profiles").update({ farah_hint_dismissed_at: new Date().toISOString() }).eq("id", testUser.id); // the phone-width Farah hint would make the strip wait
      const p = await ctx.newPage();
      await p.addInitScript(CONSENTED);
      await p.goto("/jobs");
      await p.waitForTimeout(1500);
      const shown = (await strip(p).count()) > 0;
      const text = shown ? await strip(p).innerText() : "";
      console.log(`S4_KILL_SEEKER_IOS_HINT shown=${shown} text=${JSON.stringify(text)}`);
      test.info().annotations.push({ type: "PWA-KILL-IOS-HINT-1", description: `seeker shell, iPhone Safari, PWA_KILL=1: strip shown=${shown} ${text}` });
      await ctx.close();
    } finally {
      await f.cleanup();
    }
  });
});
