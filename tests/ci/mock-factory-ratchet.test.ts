/**
 * TEST-MOCK-1: no NEW hand-written module factory for the shared modules every route and page test leans on.
 *
 * `vi.mock("@/lib/x", () => ({ a, b }))` replaces the module with exactly {a, b}. When the module later gains `c` and code under the test calls it, the test fails with a missing export, and so does every other
 * test that hand-wrote the same factory (0235 turned 26 tests of another PR red that way). A factory that spreads the real module, or comes from a shared helper, carries new exports by itself.
 *
 * This reads every vi.mock under tests/ (with the TypeScript parser) and holds the hand-written ones for the scoped modules EXACTLY equal to tests/support/mock-factory-allowlist.ts, whose total can only fall.
 * The scanner and the rules are proven able to fail (mock-factory-scan.test.ts, mock-factory-ratchet-rules.test.ts) and this file proves it is not vacuous: it must have read the real tree.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findFactoryMocks } from "../support/mock-factory-scan";
import { SCOPED_MODULES, checkFactoryRatchet } from "../support/mock-factory-ratchet";
import { ALLOWLIST, ALLOWLIST_CEILING, INITIAL_FACTORIES } from "../support/mock-factory-allowlist";

const ROOT = path.resolve(__dirname, "../..");

function testFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? testFiles(p) : /\.tsx?$/.test(e.name) ? [p] : [];
  });
}

const all = testFiles(path.join(ROOT, "tests")).flatMap((file) => {
  const rel = path.relative(ROOT, file).split(path.sep).join("/");
  return findFactoryMocks(readFileSync(file, "utf8"), rel).map((m) => ({ ...m, file: rel }));
});
const scoped = all.filter((m) => SCOPED_MODULES.includes(m.module));

describe("hand-written vi.mock factories for the shared modules (the ratchet)", () => {
  it("the allowlist equals what is really in the tree, and only ever shrinks", () => {
    const hits = scoped.filter((m) => m.kind === "hand").map((m) => ({ module: m.module, file: m.file }));
    expect(checkFactoryRatchet({ hits, allowlist: ALLOWLIST, ceiling: ALLOWLIST_CEILING, initial: INITIAL_FACTORIES })).toEqual([]);
  });

  it("is not vacuous: it has read the real tree (hundreds of factory mocks, every kind present, the chat gate and the spend tally among them)", () => {
    expect(all.length).toBeGreaterThan(200);
    expect(new Set(scoped.map((m) => m.kind))).toEqual(new Set(["hand", "shared", "safe"]));
    expect(scoped.some((m) => m.module === "@/lib/farah/chat-gate" && m.kind === "shared")).toBe(true);
    expect(scoped.some((m) => m.module === "@/lib/farah/spend-tally" && m.kind === "shared")).toBe(true);
  });

  it("the ten chat-gate route tests are all on the shared helper: no hand-written chat-gate factory remains", () => {
    expect(scoped.filter((m) => m.module === "@/lib/farah/chat-gate" && m.kind === "hand")).toEqual([]);
    expect(scoped.filter((m) => m.module === "@/lib/farah/chat-gate" && m.kind === "shared").length).toBeGreaterThanOrEqual(10);
  });

  it("every scoped module still appears in the tree (a module renamed away would otherwise drop out of the ratchet unnoticed)", () => {
    for (const mod of SCOPED_MODULES) expect(scoped.some((m) => m.module === mod), mod).toBe(true);
  });
});
