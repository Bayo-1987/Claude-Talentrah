/** The ratchet's rules (tests/support/mock-factory-ratchet.ts) proven with synthetic data: a new factory fails, the allowlist cannot grow, a converted file that is still listed fails, the ceiling can only fall. */
import { describe, expect, it } from "vitest";
import { checkFactoryRatchet, keyOf } from "../support/mock-factory-ratchet";

const base = { initial: 10 };
const A = "@/lib/a";

describe("checkFactoryRatchet", () => {
  it("passes when the allowlist equals the hits and the ceiling equals the allowlist", () => {
    expect(checkFactoryRatchet({ ...base, hits: [{ module: A, file: "t1.ts" }, { module: A, file: "t1.ts" }, { module: A, file: "t2.ts" }], allowlist: { [keyOf(A, "t1.ts")]: 2, [keyOf(A, "t2.ts")]: 1 }, ceiling: 3 })).toEqual([]);
  });
  it("passes with nothing left (the finished state)", () => {
    expect(checkFactoryRatchet({ ...base, hits: [], allowlist: {}, ceiling: 0 })).toEqual([]);
  });
  it("a NEW hand-written factory in a file that is not allowlisted fails, and says what to do", () => {
    const p = checkFactoryRatchet({ ...base, hits: [{ module: A, file: "new.ts" }], allowlist: {}, ceiling: 0 }).join("\n");
    expect(p).toMatch(/new\.ts.*not allowlisted/);
    expect(p).toMatch(/safeChatGate|importOriginal/);
  });
  it("the same file allowlisted for another module does not cover a new module: the key is (module, file)", () => {
    expect(checkFactoryRatchet({ ...base, hits: [{ module: "@/lib/b", file: "t1.ts" }], allowlist: { [keyOf(A, "t1.ts")]: 1 }, ceiling: 1 }).length).toBeGreaterThan(0);
  });
  it("an extra factory in an allowlisted file fails: the allowlist cannot grow", () => {
    const hits = [{ module: A, file: "t1.ts" }, { module: A, file: "t1.ts" }, { module: A, file: "t1.ts" }];
    expect(checkFactoryRatchet({ ...base, hits, allowlist: { [keyOf(A, "t1.ts")]: 2 }, ceiling: 2 }).join("\n")).toMatch(/only 2 allowed/);
  });
  it("a converted file that is still counted fails: the allowlist must be lowered to match", () => {
    expect(checkFactoryRatchet({ ...base, hits: [{ module: A, file: "t1.ts" }], allowlist: { [keyOf(A, "t1.ts")]: 2 }, ceiling: 2 }).join("\n")).toMatch(/only 1.*Lower the allowlist/);
  });
  it("an entry with no factory left fails: it must be deleted", () => {
    expect(checkFactoryRatchet({ ...base, hits: [], allowlist: { [keyOf(A, "gone.ts")]: 1 }, ceiling: 1 }).join("\n")).toMatch(/gone\.ts.*Delete the entry/);
  });
  it("a ceiling that disagrees with the allowlist fails, in either direction", () => {
    const hits = [{ module: A, file: "t1.ts" }];
    const allowlist = { [keyOf(A, "t1.ts")]: 1 };
    expect(checkFactoryRatchet({ ...base, hits, allowlist, ceiling: 2 }).join("\n")).toMatch(/totals 1 but ALLOWLIST_CEILING is 2/);
    expect(checkFactoryRatchet({ ...base, hits, allowlist, ceiling: 0 }).join("\n")).toMatch(/totals 1 but ALLOWLIST_CEILING is 0/);
  });
  it("a ceiling above where the ratchet started fails: it may only shrink", () => {
    const hits = [{ module: A, file: "t1.ts" }];
    expect(checkFactoryRatchet({ initial: 0, hits, allowlist: { [keyOf(A, "t1.ts")]: 1 }, ceiling: 1 }).join("\n")).toMatch(/above the 0/);
  });
});
