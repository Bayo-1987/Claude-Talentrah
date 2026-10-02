/**
 * send-504 / S7 — the panel actually uses the 24-hour rule, and the "Continue" path for older threads is still there.
 *
 * Effects do not run in this project's Node test environment (see farah-panel-transcript.test.tsx's header), so the fetch → decide
 * → show round trip is pinned by e2e/farah-history-restore.spec.ts. What can be pinned statically is the wiring: that the history
 * effect asks shouldAutoRestoreHistory BEFORE holding the thread back, restores into `messages` when it says yes, and that the
 * held-back + "Continue" path is untouched for the no case. Both halves are asserted, so "always restore" and "never restore"
 * each fail.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(join(__dirname, "../../src/components/app-shell/farah-panel.tsx"), "utf8");
const flat = src.replace(/\s+/g, " ");

describe("FarahPanel history effect", () => {
  it("imports and calls the 24-hour rule", () => {
    expect(src).toMatch(/from "@\/lib\/farah\/history-restore"/);
    expect(flat).toMatch(/shouldAutoRestoreHistory\(/);
  });

  it("restores a recent thread straight into the messages and marks the history revealed", () => {
    expect(flat).toMatch(/if \(shouldAutoRestoreHistory\([^{}]*\)\s*\{[^}]*setMessages\([^}]*setHistoryRevealed\(true\)/);
  });

  it("an older thread is still HELD (setPendingHistory) behind the Continue line", () => {
    expect(flat).toMatch(/setPendingHistory\(/);
    expect(flat).toContain("Continue where you left off with Farah?");
    expect(flat).toMatch(/function continueConversation\(/);
  });

  it("the decision happens before the thread is held back, so a recent one is never offered behind Continue", () => {
    const decide = flat.indexOf("shouldAutoRestoreHistory(");
    const hold = flat.indexOf("setPendingHistory(history)");
    expect(decide).toBeGreaterThan(-1);
    expect(hold).toBeGreaterThan(-1);
    expect(decide).toBeLessThan(hold);
  });

  it("nothing is deleted and no retention period is claimed in the panel", () => {
    expect(flat).not.toMatch(/\.delete\(|DELETE/);
    expect(flat).not.toMatch(/30 days of (history|messages|conversation)/i);
  });
});
