/**
 * MENU-360 (found by the NAV-1 360px test): the main menu was `absolute left-0 w-[240px]` inside the nav wrapper, which starts after the logo (about 143px in at 360px),
 * so its right edge sat at 383px on a 360px phone, 23px outside the viewport, with every item label ("Resume review" before NAV-1 renamed it) overflowing identically.
 * Below 400px the panel is pinned to the viewport instead (16px margins either side, under the 68px header); from 400px up the 240px panel fits where it always did.
 * Read from source because the menu needs a signed-in session to render; the browser measurement is the 360px case in e2e/masthead-nav-fit.spec.ts.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.join(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8").replace(/\s+/g, " ");

describe("the main menu stays inside a phone viewport", () => {
  const source = read("src/components/app-shell/masthead.tsx");
  /** The class list of the FIRST role="menu" panel, which is the main menu (the account menu comes later in the file and is right-anchored). */
  const mainMenu = /role="menu" className="([^"]*)"/.exec(source)?.[1] ?? "";
  it("finds the main menu panel", () => {
    expect(mainMenu).toContain("w-[240px]");
  });
  it("below 400px it is fixed to the viewport with 16px side margins, under the header", () => {
    for (const c of ["max-[400px]:fixed", "max-[400px]:inset-x-4", "max-[400px]:top-[62px]", "max-[400px]:w-auto"]) expect(mainMenu, c).toContain(c);
  });
  it("from 400px up it keeps its anchored 240px panel (a 143px-in nav plus 240px is 383px, which fits)", () => {
    expect(mainMenu).toContain("left-0");
    expect(mainMenu).toContain("top-[calc(100%+8px)]");
  });
  it("the browser spec measures it at 360px", () => {
    const spec = read("e2e/masthead-nav-fit.spec.ts");
    expect(spec).toContain("width: 360, height: 800");
    expect(spec).toContain("runs past the right edge at 360px");
  });
});
