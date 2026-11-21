/**
 * NAV-DROPDOWN-REALIGN-1, owner choice A: the "Ask Farah" bar button shows from 1680 and not before. Below that, Farah's entry point is the docked panel, so the regression to guard is that it is
 * docked (no phone launcher, no sheet) at EVERY width from 760 to 1679 on the main app pages, and that the launcher is still withheld on the four phone pages where it was always withheld.
 *
 * The browser half is e2e/farah-discoverability.spec.ts (the panel is on screen at ten widths in the band) and e2e/masthead-nav-fit.spec.ts (the bar button at 1679 and 1680).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ASK_FARAH_BAR_MIN_PX } from "@/components/app-shell/nav-model";
import { FARAH_LAUNCHER_DENIED_PATHS, FARAH_SHELL_BREAKPOINT_PX, farahLauncherAllowedFor, isPhoneWidth } from "@/lib/farah/launcher-rules";
import { closedSheet, sheetForWidth } from "@/lib/farah/launcher-sheet";

const MAIN_PAGES = ["/jobs", "/jobs/abc", "/tracker", "/auto-apply", "/resume-builder", "/scholarships", "/mentorship", "/talent-directory/verify", "/refer", "/billing", "/settings", "/dashboard"];

describe("Farah's entry point by width", () => {
  it("the bar button starts at 1680 and the docked layout starts at 760: the band between is covered by the docked panel alone", () => {
    expect(ASK_FARAH_BAR_MIN_PX).toBe(1680);
    expect(FARAH_SHELL_BREAKPOINT_PX).toBe(760);
  });

  it("from 760 to 1679 the layout is docked at every width (not a phone width, so no launcher button and no bottom sheet)", () => {
    for (let w = FARAH_SHELL_BREAKPOINT_PX; w < ASK_FARAH_BAR_MIN_PX; w += 1) {
      expect(isPhoneWidth(w), `${w}px`).toBe(false);
    }
    expect(isPhoneWidth(759)).toBe(true);
  });

  it("an open phone sheet is closed the moment the width reaches 760, and stays closed across the whole docked band", () => {
    const open = { ...closedSheet<HTMLElement>(), open: true };
    for (const w of [760, 900, 1024, 1280, 1536, 1679]) {
      expect(sheetForWidth(open, w).open, `${w}px`).toBe(false);
    }
    expect(sheetForWidth(open, 759).open).toBe(true);
  });

  it("on the main app pages the launcher is allowed (it shows below 760; from 760 the panel is docked instead)", () => {
    for (const p of MAIN_PAGES) expect(farahLauncherAllowedFor(p), p).toBe(true);
  });

  it("on the four phone pages the launcher is withheld, as before, and nothing else is", () => {
    expect([...FARAH_LAUNCHER_DENIED_PATHS]).toEqual(["/billing/callback", "/mentorship/book/callback", "/settings/account-deletion", "/settings/delete-account/confirm"]);
    for (const p of FARAH_LAUNCHER_DENIED_PATHS) {
      expect(farahLauncherAllowedFor(p), p).toBe(false);
      expect(farahLauncherAllowedFor(`${p}/`), `${p}/`).toBe(false);
      expect(farahLauncherAllowedFor(`${p}?x=1`), `${p}?x=1`).toBe(false);
    }
  });
});

describe("the first-visit hint names what is on screen", () => {
  const src = readFileSync(path.resolve(__dirname, "../../src/components/app-shell/farah-first-visit-hint.tsx"), "utf8").replace(/\s+/g, " ");
  it("says \"Ask Farah in the menu bar\" only from the width at which the bar button exists (1680), and \"the column on the right\" before it", () => {
    expect(src).toContain(`min-[760px]:inline min-[${ASK_FARAH_BAR_MIN_PX}px]:hidden`);
    expect(src).toContain(`hidden min-[${ASK_FARAH_BAR_MIN_PX}px]:inline`);
    expect(src, "the old 1536 switch would send people to a button that is not there").not.toMatch(/2xl:(hidden|inline)/);
  });
});
