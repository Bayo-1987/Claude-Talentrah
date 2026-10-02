/**
 * send-511 (#591) — the decision "is there a file in the input that nothing has handled yet?", at unit level, so a
 * regression is caught in milliseconds rather than by the e2e loop (e2e/banner-crop-picker.spec.ts is the
 * browser-level proof that holds hydration back).
 *
 * Why it exists: the picker's file input is server-rendered, so a file chosen before hydration fires `change` into
 * a page React is not attached to yet, and React does not replay it. On mount the picker must act on a file that
 * is already in the input, exactly once, and never on one its change handler already took.
 *
 * vitest here runs in plain Node (no DOM), so the effect itself cannot be mounted; the decision is a pure function
 * and the wiring is pinned by a source check below, mutation-proven when this was written.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { loadModule } from "../support/load-module";

interface Mod {
  fileToCatchUp(files: ArrayLike<File> | null | undefined, alreadyHandled: File | null): File | null;
}
const load = () => loadModule<Mod>("@/lib/employer/banner-pick");
const file = (name: string) => new File([new Uint8Array([1])], name, { type: "image/png" });

describe("fileToCatchUp", () => {
  it("returns the file when one is in the input and nothing has handled it (the pre-hydration pick)", async () => {
    const { fileToCatchUp } = await load();
    const f = file("banner.png");
    expect(fileToCatchUp([f], null)).toBe(f);
  });

  it("returns nothing when the input is empty, missing or null (an ordinary mount)", async () => {
    const { fileToCatchUp } = await load();
    expect(fileToCatchUp([], null)).toBeNull();
    expect(fileToCatchUp(null, null)).toBeNull();
    expect(fileToCatchUp(undefined, null)).toBeNull();
  });

  it("returns nothing for a file the change handler already took (no double handling)", async () => {
    const { fileToCatchUp } = await load();
    const f = file("banner.png");
    expect(fileToCatchUp([f], f)).toBeNull();
  });

  it("returns a DIFFERENT file than the one already handled (a replacement picked meanwhile)", async () => {
    const { fileToCatchUp } = await load();
    const old = file("old.png");
    const next = file("new.png");
    expect(fileToCatchUp([next], old)).toBe(next);
  });

  it("takes the first file when more than one is present", async () => {
    const { fileToCatchUp } = await load();
    const a = file("a.png");
    expect(fileToCatchUp([a, file("b.png")], null)).toBe(a);
  });
});

describe("the picker is wired to it on mount", () => {
  const src = readFileSync(path.join(process.cwd(), "src/components/employer/banner-crop-picker.tsx"), "utf8");

  it("calls fileToCatchUp from a mount-only effect (empty dependency array)", () => {
    expect(src).toMatch(/fileToCatchUp\(/);
    // The effect that calls it has [] as its dependency list.
    const effect = src.match(/useEffect\(\(\) => \{[\s\S]*?fileToCatchUp\([\s\S]*?\}, \[\]\)/);
    expect(effect, "no mount-only useEffect calls fileToCatchUp").not.toBeNull();
  });

  it("links the issue, so the next person knows why this effect exists", () => {
    expect(src).toMatch(/#591/);
  });
});
