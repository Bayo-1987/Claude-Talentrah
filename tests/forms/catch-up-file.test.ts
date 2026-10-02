/**
 * send-5xx (draft) — one shared fix for the pre-hydration file race, covering all six file inputs (issue #591 follow-up).
 *
 * THE RACE. A file input in a client component is server-rendered markup. A file chosen before the page hydrates
 * fires `change` into a page React is not attached to yet, and React does not replay it: the file sits in the input
 * and nothing happens. Measured on a production build with hydration held back (10 trials each): the new-job and
 * edit-job assessment pickers and the exercise-upload widget lose the file on an ordinary label click (the label
 * opens the native chooser with no JS); the resume and banner inputs lose it to a programmatic or keyboard pick.
 *
 * THE FIX, ONCE. `useCatchUpFile` hands the component `inputRef` and `onChange`, and on mount acts on any file already
 * in the input. This file pins (1) the pure decision for every input's shape (single vs multiple), (2) that each of
 * the six inputs is wired through the hook, and (3) that the hook's catch-up is a mount-only effect. vitest here is
 * plain Node (no DOM), so the effect itself runs in the Playwright spec (e2e/file-input-pre-hydration.spec.ts).
 */
import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { loadModule } from "../support/load-module";

interface Mod {
  filesToCatchUp(files: ArrayLike<File> | null | undefined, handled: ReadonlySet<File>, opts: { multiple: boolean }): File[];
}
const load = () => loadModule<Mod>("@/lib/forms/catch-up-file");
const file = (name: string) => new File([new Uint8Array([1])], name);

/** The six file inputs in the app, and whether each takes several files. Adding a seventh must add a row here. */
const INPUTS: Array<{ name: string; file: string; multiple: boolean }> = [
  { name: "banner crop picker", file: "src/components/employer/banner-crop-picker.tsx", multiple: false },
  { name: "new-job assessment files picker", file: "src/components/employer/new-job-assessment-files-picker.tsx", multiple: true },
  { name: "edit-job assessment files picker", file: "src/components/employer/edit-job-assessment-files-picker.tsx", multiple: true },
  { name: "assessment exercise upload", file: "src/components/employer/assessment-exercise-upload.tsx", multiple: false },
  { name: "screening-gate apply (seeker)", file: "src/components/jobs/screening-gate-apply.tsx", multiple: true },
  { name: "onboarding resume upload", file: "src/components/onboarding/resume-upload.tsx", multiple: false },
];

describe("filesToCatchUp, for every input's shape", () => {
  for (const input of INPUTS) {
    describe(input.name, () => {
      const opts = { multiple: input.multiple };

      it("returns the pre-hydration pick", async () => {
        const { filesToCatchUp } = await load();
        const a = file("a.pdf");
        expect(filesToCatchUp([a], new Set(), opts)).toEqual([a]);
      });

      it("returns nothing for an empty or missing input", async () => {
        const { filesToCatchUp } = await load();
        expect(filesToCatchUp([], new Set(), opts)).toEqual([]);
        expect(filesToCatchUp(null, new Set(), opts)).toEqual([]);
        expect(filesToCatchUp(undefined, new Set(), opts)).toEqual([]);
      });

      it("never returns a file the change handler already took", async () => {
        const { filesToCatchUp } = await load();
        const a = file("a.pdf");
        expect(filesToCatchUp([a], new Set([a]), opts)).toEqual([]);
      });

      it(input.multiple ? "returns every unhandled file, in order" : "returns only the first file (the input takes one)", async () => {
        const { filesToCatchUp } = await load();
        const [a, b] = [file("a.pdf"), file("b.pdf")];
        expect(filesToCatchUp([a, b], new Set(), opts)).toEqual(input.multiple ? [a, b] : [a]);
      });
    });
  }
});

describe("every file input in src/ is one of the six, and each is wired through the hook", () => {
  it("the table lists every `type=\"file\"` input in src (a seventh input cannot slip in unguarded)", () => {
    const found = execSync(`grep -rl 'type="file"' src --include=*.tsx`, { cwd: process.cwd(), encoding: "utf8" })
      .split("\n")
      .filter(Boolean)
      .sort();
    expect(found).toEqual(INPUTS.map((i) => i.file).sort());
  });

  for (const input of INPUTS) {
    describe(input.name, () => {
      const read = () => readFileSync(path.join(process.cwd(), input.file), "utf8");

      it("calls useCatchUpFile, with `multiple` matching the input", () => {
        const src = read();
        expect(src).toMatch(/useCatchUpFile\(/);
        expect(src).toMatch(new RegExp(`multiple:\\s*${input.multiple}`));
      });

      it("takes its ref and its onChange from the hook (no hand-written handler left on the input)", () => {
        const tag = read().match(/<input[^>]*type="file"[\s\S]*?\/>/)?.[0] ?? "";
        expect(tag, "could not find the file input").not.toBe("");
        expect(tag).toMatch(/ref=\{inputRef\}/);
        expect(tag).toMatch(/onChange=\{onChange\}/);
      });
    });
  }
});

describe("the hook itself", () => {
  const read = () => readFileSync(path.join(process.cwd(), "src/lib/forms/use-catch-up-file.ts"), "utf8");

  it("catches up from a mount-only effect (empty dependency array)", () => {
    expect(read()).toMatch(/useEffect\(\(\) => \{[\s\S]*?filesToCatchUp\([\s\S]*?\}, \[\]\)/);
  });

  it("links the issue so the next reader knows why it exists", () => {
    expect(read()).toMatch(/#591/);
  });
});
