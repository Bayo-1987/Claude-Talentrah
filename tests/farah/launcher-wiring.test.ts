/**
 * Where the launcher is wired, read from the source (the unit environment has no DOM): it replaces the bottom bar in the signed-in shell and nowhere else, the install strip and the
 * first-visit hint no longer point at a bar that is gone, and every entry to Farah goes through the one reveal function.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}
const SRC = walk(path.join(ROOT, "src")).map((f) => ({ file: path.relative(ROOT, f), text: readFileSync(f, "utf8") }));

describe("the signed-in shell", () => {
  const shell = read("src/components/app-shell/app-shell.tsx");

  it("renders the sheet host around the one FarahPanel, and the bottom bar is gone", () => {
    expect(shell).toContain("FarahSheetHost");
    expect(shell).not.toContain("FarahMobileTab");
    expect(shell).not.toContain("farah-tab-spacer");
    expect(existsSync(path.join(ROOT, "src/components/app-shell/farah-mobile-tab.tsx"))).toBe(false);
  });

  it("mounts the host once, in the signed-in branch only (after the signed-out early return)", () => {
    expect(shell.match(/<FarahSheetHost/g)).toHaveLength(1);
    expect(shell.match(/<FarahPanel/g)).toHaveLength(1);
    const signedOutReturn = shell.indexOf("return (", shell.indexOf("if (!session)"));
    expect(shell.indexOf("<FarahSheetHost")).toBeGreaterThan(signedOutReturn);
  });

  it("passes the unread dot to the host, which gives it to the launcher", () => {
    expect(shell).toMatch(/<FarahSheetHost[^>]*hasUnreadNotification=\{hasUnread\}/);
  });
});

describe("nothing else mounts the launcher", () => {
  it("only the sheet host imports the launcher view, and only the shell imports the host", () => {
    const launcherImporters = SRC.filter((f) => /farah-launcher-view/.test(f.text) && !f.file.endsWith("farah-launcher-view.tsx")).map((f) => f.file);
    expect(launcherImporters).toEqual(["src/components/app-shell/farah-sheet-host.tsx"]);
    const hostImporters = SRC.filter((f) => /from "@\/components\/app-shell\/farah-sheet-host"/.test(f.text)).map((f) => f.file);
    expect(hostImporters).toEqual(["src/components/app-shell/app-shell.tsx"]);
  });

  it("the employer, admin and auth layouts do not use the shell or the host", () => {
    for (const rel of ["src/app/employer/layout.tsx", "src/app/admin/layout.tsx", "src/app/admin/(protected)/layout.tsx", "src/app/(auth)/layout.tsx"]) {
      if (!existsSync(path.join(ROOT, rel))) continue;
      const text = read(rel);
      expect(text, rel).not.toMatch(/AppShell|FarahSheetHost|FarahLauncher/);
    }
  });

  it("the layers are ordered: launcher (18) under the masthead (20) under the sheet (40), scrim (39) between", () => {
    const view = read("src/components/app-shell/farah-launcher-view.tsx");
    const frame = read("src/components/app-shell/farah-sheet-frame.tsx");
    expect(view).toContain("z-[18]");
    expect(frame).toContain("z-[40]");
    expect(frame).toContain("z-[39]");
    expect(read("src/components/app-shell/app-shell.tsx")).toContain("z-20");
  });
});

describe("one way into Farah", () => {
  it("the masthead, the hint and the job link all call scrollToFarahPanel, and nothing else scrolls the panel into view", () => {
    for (const rel of ["src/components/app-shell/masthead.tsx", "src/components/app-shell/farah-first-visit-hint.tsx", "src/components/jobs/farah-job-menu.tsx"]) {
      expect(read(rel), rel).toContain("scrollToFarahPanel");
    }
    const scrollers = SRC.filter((f) => /FARAH_PANEL_SELECTOR|farah-panel"\]/.test(f.text) && /scrollIntoView/.test(f.text)).map((f) => f.file);
    expect(scrollers).toEqual(["src/lib/farah/scroll-to-panel.ts"]);
  });

  it("the job link seeds Farah AFTER the reveal, through the follow-up, not before it", () => {
    const menu = read("src/components/jobs/farah-job-menu.tsx");
    expect(menu).toMatch(/scrollToFarahPanel\(\s*\(\)\s*=>\s*seedFarahForJob\(/);
    expect(menu).not.toMatch(/seedFarahForJob\([^)]*\);\s*scrollToFarahPanel\(\)/);
  });
});

describe("the install strip and the first-visit hint no longer point at a bar", () => {
  it("the strip stands on the bottom edge at every width, publishes its height for the launcher, and keeps the home-indicator inset", () => {
    const view = read("src/components/pwa/install-strip-view.tsx");
    expect(view).not.toContain("58.5px");
    expect(view).toContain("bottom-0");
    expect(view).toContain("env(safe-area-inset-bottom)");
    expect(read("src/components/pwa/install-strip.tsx")).toContain("--farah-strip-h");
  });

  it("the hint has no phone variant and steps out of the page below 760px (so the install strip is not held back by a hint nobody can see)", () => {
    const hint = read("src/components/app-shell/farah-first-visit-hint.tsx");
    expect(hint).not.toContain("at the bottom of the");
    expect(hint).not.toContain("bottom-[76px]");
    expect(hint).toContain("max-[759px]:hidden");
    expect(hint).toMatch(/matchMedia\("\(max-width: 759px\)"\)/);
    expect(hint).toMatch(/if \(gone \|\| phone\) return null/);
  });
});

describe("the written exceptions", () => {
  it("CLAUDE.md records the round launcher, the phone sheet and the 'AI assistant' disclosure (Reviewer decision Q6)", () => {
    const doc = read("CLAUDE.md");
    expect(doc).toMatch(/launcher/i);
    expect(doc).toMatch(/AI assistant/);
  });
});

describe("Apply is never under the launcher", () => {
  it("the job card's action row and the detail page's action row reserve the launcher's column below 760px and say so", () => {
    for (const rel of ["src/components/jobs/job-card.tsx", "src/app/(app)/jobs/[id]/page.tsx"]) {
      const text = read(rel);
      expect(text, rel).toContain("data-farah-avoid");
      expect(text, rel).toContain("max-[759px]:pr-[72px]");
    }
  });
});
