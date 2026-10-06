/**
 * safeChatGate (tests/farah/support/route-mocks.ts) is the fake of the chat gate that ten route tests share. It must carry every export of the real module, or a route change that calls an export
 * it lacks turns those tests red together (the failure that 0235 caused in a test written before its functions existed). This reads the real module's export names from its source and compares.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { safeChatGate } from "./support/route-mocks";

const SRC = readFileSync(join(__dirname, "../../src/lib/farah/chat-gate.ts"), "utf8");

/** The names the real module exports: `export function|async function|const|class X`, `export { A, B }`, and re-exports. Interfaces and types are not values and are skipped. */
function exportedValueNames(source: string): string[] {
  const names = new Set<string>();
  for (const m of source.matchAll(/^export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z0-9_$]+)/gm)) names.add(m[1]);
  for (const m of source.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const part of m[1].split(",")) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (name) names.add(name);
    }
  }
  return [...names].sort();
}

const gate = safeChatGate({ checkFarahChatAllowance: async () => ({}), commitFarahChatAllowance: async () => ({}) });

describe("safeChatGate carries every export of the real chat gate", () => {
  it("the names it carries are exactly the names the real module exports (a new export must be added to the helper)", () => {
    expect(Object.keys(gate).sort()).toEqual(exportedValueNames(SRC));
  });

  it("the export scan sees what it should (it is not an empty comparison)", () => {
    expect(exportedValueNames(SRC).length).toBeGreaterThanOrEqual(7);
    expect(exportedValueNames(SRC)).toEqual(expect.arrayContaining(["checkFarahChatAllowance", "commitFarahChatAllowance", "releaseFarahChatAllowance", "farahChatNextFreeMessageAt"]));
    expect(exportedValueNames("export interface X {}\nexport type Y = 1;\nexport async function a() {}\nexport const B = 1;\nexport { C, D as E };")).toEqual(["B", "C", "E", "a"]);
  });
});

describe("the defaults are harmless and the overrides win", () => {
  it("release is a no-op, the free messages left read 3, the next free date is null", async () => {
    await expect(gate.releaseFarahChatAllowance()).resolves.toBeUndefined();
    await expect(gate.farahChatFreeMessagesRemaining()).resolves.toBe(3);
    await expect(gate.farahChatNextFreeMessageAt()).resolves.toBeNull();
    expect(gate.FARAH_CHAT_FREE_ALLOWANCE).toBe(3);
  });

  it("what the caller passes is what comes back (check, commit, release, remaining, next free, the error class)", async () => {
    class Mine extends Error {
      constructor(public required?: number, public available?: number, public capMessage?: string) {
        super("mine");
      }
    }
    const check = async () => "c";
    const commit = async () => "m";
    const release = async () => "r";
    const left = async () => 1;
    const next = async () => "2026-11-01T00:00:00.000Z";
    const g = safeChatGate({ checkFarahChatAllowance: check, commitFarahChatAllowance: commit, releaseFarahChatAllowance: release, farahChatFreeMessagesRemaining: left, farahChatNextFreeMessageAt: next, InsufficientCreditsError: Mine });
    expect([g.checkFarahChatAllowance, g.commitFarahChatAllowance, g.releaseFarahChatAllowance, g.farahChatFreeMessagesRemaining, g.farahChatNextFreeMessageAt, g.InsufficientCreditsError]).toEqual([check, commit, release, left, next, Mine]);
  });

  it("the default error class is a real Error that carries the three numbers the route reads", () => {
    const e = new gate.InsufficientCreditsError(2, 1, "cap");
    expect(e).toBeInstanceOf(Error);
    expect({ required: e.required, available: e.available, capMessage: e.capMessage }).toEqual({ required: 2, available: 1, capMessage: "cap" });
  });
});
