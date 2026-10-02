/**
 * The allowlist's rules (tests/format/ratchet-check.ts), proven with synthetic data: a new violation fails, the allowlist
 * cannot grow, a converted site that is still listed fails, and the ceiling can only fall.
 */
import { describe, expect, it } from "vitest";
import { checkRatchet } from "./ratchet-check";

const base = { initial: 10 };

describe("checkRatchet", () => {
  it("passes when the allowlist equals the hits and the ceiling equals the allowlist", () => {
    expect(checkRatchet({ ...base, hits: [{ file: "a.ts" }, { file: "a.ts" }, { file: "b.ts" }], allowlist: { "a.ts": 2, "b.ts": 1 }, ceiling: 3 })).toEqual([]);
  });

  it("passes with no hits and an empty allowlist (the finished state)", () => {
    expect(checkRatchet({ ...base, hits: [], allowlist: {}, ceiling: 0 })).toEqual([]);
  });

  it("a NEW violation in a file that is not allowlisted fails", () => {
    const problems = checkRatchet({ ...base, hits: [{ file: "new.ts" }], allowlist: {}, ceiling: 0 });
    expect(problems.join("\n")).toMatch(/new\.ts.*not allowlisted/);
  });

  it("an extra violation in an allowlisted file fails: the allowlist cannot grow", () => {
    const problems = checkRatchet({ ...base, hits: [{ file: "a.ts" }, { file: "a.ts" }, { file: "a.ts" }], allowlist: { "a.ts": 2 }, ceiling: 2 });
    expect(problems.join("\n")).toMatch(/a\.ts.*only 2 allowed/);
  });

  it("a converted site that is still counted fails: the allowlist must be lowered to match", () => {
    const problems = checkRatchet({ ...base, hits: [{ file: "a.ts" }], allowlist: { "a.ts": 2 }, ceiling: 2 });
    expect(problems.join("\n")).toMatch(/only 1.*Lower the allowlist/);
  });

  it("an entry with no hits left fails: it must be deleted", () => {
    const problems = checkRatchet({ ...base, hits: [], allowlist: { "gone.ts": 1 }, ceiling: 1 });
    expect(problems.join("\n")).toMatch(/gone\.ts.*Delete the entry/);
  });

  it("a ceiling that disagrees with the allowlist fails, in either direction", () => {
    expect(checkRatchet({ ...base, hits: [{ file: "a.ts" }], allowlist: { "a.ts": 1 }, ceiling: 2 }).join("\n")).toMatch(/totals 1 but ALLOWLIST_CEILING is 2/);
    expect(checkRatchet({ ...base, hits: [{ file: "a.ts" }], allowlist: { "a.ts": 1 }, ceiling: 0 }).join("\n")).toMatch(/totals 1 but ALLOWLIST_CEILING is 0/);
  });

  it("raising the allowlist AND the ceiling together, past where the ratchet started, still fails", () => {
    const hits = Array.from({ length: 12 }, () => ({ file: "a.ts" }));
    const problems = checkRatchet({ initial: 10, hits, allowlist: { "a.ts": 12 }, ceiling: 12 });
    expect(problems.join("\n")).toMatch(/above the 10 violations the ratchet started with/);
  });
});
