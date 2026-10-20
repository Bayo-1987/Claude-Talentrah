/**
 * The install strip in the EMPLOYER shell (src/app/employer/layout.tsx), next to the seeker shell's (src/components/app-shell/app-shell.tsx).
 *
 * The employer layout is an async Server Component that calls getOptionalUser() and the database; a unit test cannot render it without hand-written module factories for the shared
 * auth modules, which tests/ci/mock-factory-ratchet.test.ts forbids adding. So the decision it makes is split out where it can be tested for real (EmployerInstallStrip: nothing under
 * the kill switch, the shared lazy strip otherwise), and WHERE the layout mounts it is pinned by reading its source. The behaviour in a browser is e2e/pwa-install-strip-employer.spec.ts.
 */
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { isValidElement } from "react";
import { EmployerInstallStrip } from "@/components/employer/employer-install-strip";
import { InstallStripLazy } from "@/components/pwa/install-strip-lazy";

const read = (rel: string) => readFileSync(path.resolve(__dirname, "../..", rel), "utf8");
/** Source with comments removed: the files explain the very things the checks forbid. */
const code = (rel: string) => read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const saved = process.env.PWA_KILL;
afterEach(() => {
  if (saved === undefined) delete process.env.PWA_KILL;
  else process.env.PWA_KILL = saved;
});

describe("EmployerInstallStrip", () => {
  it("is the shared lazy strip (not a copy) when the kill switch is off", () => {
    delete process.env.PWA_KILL;
    const el = EmployerInstallStrip();
    expect(isValidElement(el)).toBe(true);
    expect((el as { type: unknown }).type).toBe(InstallStripLazy);
  });

  it("renders NOTHING when PWA_KILL is exactly '1' (it also covers the iOS hint, which needs no prompt event)", () => {
    process.env.PWA_KILL = "1";
    expect(EmployerInstallStrip()).toBeNull();
  });

  it.each(["", "0", "true", " 1"])("only '1' kills: PWA_KILL=%j still shows it", (v) => {
    process.env.PWA_KILL = v;
    expect((EmployerInstallStrip() as { type: unknown } | null)?.type).toBe(InstallStripLazy);
  });

  it("reads the variable when it is rendered, not when the module loads (the layout is dynamic)", () => {
    delete process.env.PWA_KILL;
    expect(EmployerInstallStrip()).not.toBeNull();
    process.env.PWA_KILL = "1";
    expect(EmployerInstallStrip()).toBeNull();
  });
});

describe("the employer layout mounts it in the signed-in branch only, last", () => {
  const layout = code("src/app/employer/layout.tsx");

  it("imports the employer wrapper and does not import next/dynamic or the strip internals", () => {
    expect(layout).toMatch(/import \{ EmployerInstallStrip \} from "@\/components\/employer\/employer-install-strip"/);
    expect(layout).not.toMatch(/next\/dynamic|install-strip-view|install-state/);
  });

  it("renders it AFTER the signed-out early return, so a signed-out visitor and the public /employer page get none", () => {
    const early = layout.indexOf("if (!session)");
    const mount = layout.indexOf("<EmployerInstallStrip");
    expect(early).toBeGreaterThan(-1);
    expect(mount).toBeGreaterThan(early);
    const signedOutBranch = layout.slice(early, layout.indexOf("}", layout.indexOf("return", early)));
    expect(signedOutBranch).not.toContain("EmployerInstallStrip");
  });

  it("puts it last in the shell, after the content wrapper (a fixed bar, last in DOM order so the skip link stays the first Tab stop)", () => {
    expect(layout.indexOf("<EmployerInstallStrip")).toBeGreaterThan(layout.indexOf("{children}"));
    expect(layout.indexOf("<EmployerInstallStrip")).toBeGreaterThan(layout.indexOf("<EmployerMasthead"));
  });
});

describe("on a phone the bar stands on the bottom edge in the employer shell", () => {
  // The shared bar is raised 58.5px (bottom-[calc(58.5px+env(safe-area-inset-bottom))] below 760px) to stand above the SEEKER shell's Farah tab, whose own reserve covers that
  // slot. The strip's spacer is measured to the bar's height only, so without a tab the last 58.5px of every employer page sat under the bar. The employer layout wraps the strip
  // and puts the bar on the edge instead (a descendant selector beats the bar's own class; the shared strip files are untouched), keeping the safe area as the bar's own bottom
  // padding so the spacer, which is measured from the bar, still matches it.
  const layout = code("src/app/employer/layout.tsx");

  it("wraps the strip in an element that overrides the bar's bottom offset and the safe-area padding", () => {
    const at = layout.indexOf("<EmployerInstallStrip");
    const wrapperStart = layout.lastIndexOf("<div", at);
    const wrapper = layout.slice(wrapperStart, at);
    expect(wrapper).toContain("[&_[data-testid=install-strip]]:bottom-0");
    expect(wrapper).toContain("[&_[data-testid=install-strip]]:pb-[calc(0.25rem+env(safe-area-inset-bottom))]");
    expect(layout.slice(at)).toMatch(/^<EmployerInstallStrip \/>\s*<\/div>/); // the wrapper holds the strip and nothing after it
  });

  it("does not add its own fixed padding next to the strip's spacer", () => {
    expect(layout).not.toMatch(/58\.5px/);
  });

  it("changes nothing in the shared strip or the seeker shell", () => {
    expect(read("src/components/pwa/install-strip-view.tsx")).toContain("bottom-[calc(58.5px+env(safe-area-inset-bottom))]");
    expect(code("src/components/pwa/install-strip-lazy.tsx")).not.toMatch(/employer/i);
  });
});

describe("hidden in print", () => {
  it("the bar and its spacer both carry print:hidden (the employer layout prints the applicant resume through the shell)", () => {
    expect(read("src/components/pwa/install-strip-view.tsx")).toContain("print:hidden");
    expect(read("src/components/pwa/install-strip.tsx")).toMatch(/data-testid="install-strip-spacer"[^>]*className="print:hidden"/);
  });
});
