/**
 * Admin review queues' shared DecisionForm (QA, 9 Oct): DECISION-NOTE-1 and DECISION-SILENT-1.
 *
 * DECISION-NOTE-1: an error ("Already decided by someone else", a refused rejection...) wiped the plain-textarea note the reviewer had typed (React 19 resets a <form action> whatever the action
 * returned). The form now wraps its action once: an error comes back with the typed note (keep-input), so all six plain-textarea callers are covered without touching their eight actions.
 * DECISION-SILENT-1: a decision that removes the row (verify, approve) took its own confirmation with it. When the row is gone a moment after a success, the confirmation is announced in a
 * notice that lives in the admin layout, outside the rows.
 * Browser proof: QA's e2e/admin-employer-verification-form-rule.spec.ts and admin-mentor-review-form-rule.spec.ts.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { wrapDecisionAction } from "@/lib/admin/moderation/decision-action";
import { announceDecision, dismissDecisionNotice, getDecisionNotice, subscribeDecisionNotice } from "@/lib/admin/moderation/decision-notice";
import type { ModerationState } from "@/lib/admin/moderation/state";

const ROOT = path.join(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8").replace(/\s+/g, " ");

const idle: ModerationState = { status: "idle" };
const form = (note: string, extra: Record<string, string> = {}) => {
  const f = new FormData();
  f.set("id", "org-1");
  f.set("note", note);
  for (const [k, v] of Object.entries(extra)) f.set(k, v);
  return f;
};
/** Runs the scheduled "is the row gone?" check at once, so a test can see what was announced. */
const now = (fn: () => void) => fn();

describe("wrapDecisionAction: an error keeps the note (DECISION-NOTE-1)", () => {
  it("an error comes back with the note exactly as typed", async () => {
    const run = wrapDecisionAction(async () => ({ status: "error", message: "Already decided by someone else.", targetId: "org-1" }), { noteName: "note", rowIsGone: () => false });
    const out = await run(idle, form("  they sent two different CAC numbers  "));
    expect(out.status).toBe("error");
    expect(out.values).toEqual({ note: "  they sent two different CAC numbers  " });
  });
  it("an error that already carries its own values is left alone", async () => {
    const own = { status: "error", message: "x", targetId: "org-1", values: { note: "kept by the action" } } as const;
    const out = await wrapDecisionAction(async () => own, { noteName: "note", rowIsGone: () => false })(idle, form("typed"));
    expect(out.values).toEqual({ note: "kept by the action" });
  });
  it("a success hands back no values, so the next note box starts clean", async () => {
    const out = await wrapDecisionAction(async () => ({ status: "success", message: "Verified.", targetId: "org-1" }), { noteName: "note", rowIsGone: () => false })(idle, form("typed"));
    expect(out.values).toBeUndefined();
  });
  it("it follows the caller's note field name", async () => {
    const f = new FormData();
    f.set("reason", "because");
    const out = await wrapDecisionAction(async () => ({ status: "error", message: "x" }), { noteName: "reason", rowIsGone: () => false })(idle, f);
    expect(out.values).toEqual({ reason: "because" });
  });
  it("it passes the previous state and the form data to the real action untouched", async () => {
    const real = vi.fn(async (): Promise<ModerationState> => idle);
    const f = form("n");
    await wrapDecisionAction(real, { noteName: "note", rowIsGone: () => false })(idle, f);
    expect(real).toHaveBeenCalledWith(idle, f);
  });
});

describe("wrapDecisionAction: a decision that removes the row still says so (DECISION-SILENT-1)", () => {
  it("a success whose row is gone is announced once, with the action's own message", async () => {
    const announce = vi.fn();
    await wrapDecisionAction(async () => ({ status: "success", message: "Verified “Acme”.", targetId: "org-1" }), { noteName: "note", rowIsGone: () => true, announce, schedule: now })(idle, form(""));
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith("Verified “Acme”.");
  });
  it("a success whose row is still on the page is NOT announced (the row's own banner says it)", async () => {
    const announce = vi.fn();
    await wrapDecisionAction(async () => ({ status: "success", message: "Saved.", targetId: "org-1" }), { noteName: "note", rowIsGone: () => false, announce, schedule: now })(idle, form(""));
    expect(announce).not.toHaveBeenCalled();
  });
  it("an error is never announced there", async () => {
    const announce = vi.fn();
    await wrapDecisionAction(async () => ({ status: "error", message: "Already decided by someone else." }), { noteName: "note", rowIsGone: () => true, announce, schedule: now })(idle, form(""));
    expect(announce).not.toHaveBeenCalled();
  });
  it("a success with no message announces nothing", async () => {
    const announce = vi.fn();
    await wrapDecisionAction(async () => ({ status: "success" }), { noteName: "note", rowIsGone: () => true, announce, schedule: now })(idle, form(""));
    expect(announce).not.toHaveBeenCalled();
  });
  it("the check waits (the row is removed by the same response), it does not run inside the action", async () => {
    const scheduled: Array<{ fn: () => void; ms: number }> = [];
    const announce = vi.fn();
    await wrapDecisionAction(async () => ({ status: "success", message: "Done." }), { noteName: "note", rowIsGone: () => true, announce, schedule: (fn, ms) => scheduled.push({ fn, ms }) })(idle, form(""));
    expect(announce).not.toHaveBeenCalled();
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].ms).toBeGreaterThan(0);
    scheduled[0].fn();
    expect(announce).toHaveBeenCalledWith("Done.");
  });
});

describe("the notice store", () => {
  it("starts empty, shows the latest message, and is cleared by dismissing", () => {
    dismissDecisionNotice();
    expect(getDecisionNotice()).toBeNull();
    announceDecision("Verified “A”.");
    expect(getDecisionNotice()?.message).toBe("Verified “A”.");
    announceDecision("Approved “B”.");
    expect(getDecisionNotice()?.message).toBe("Approved “B”.");
    dismissDecisionNotice();
    expect(getDecisionNotice()).toBeNull();
  });
  it("the same message twice is a new notice (so it re-announces), and subscribers hear every change", () => {
    const heard = vi.fn();
    const off = subscribeDecisionNotice(heard);
    announceDecision("Same.");
    const first = getDecisionNotice();
    announceDecision("Same.");
    expect(getDecisionNotice()).not.toBe(first);
    dismissDecisionNotice();
    off();
    announceDecision("After unsubscribe.");
    expect(heard).toHaveBeenCalledTimes(3);
    dismissDecisionNotice();
  });
});

describe("wiring", () => {
  const formSrc = read("src/components/admin/decision-form.tsx");
  it("the form runs its action through the wrapper and the plain note takes the returned value; the rich editor is left as it was", () => {
    expect(formSrc).toContain("wrapDecisionAction(");
    expect(formSrc).toContain('inputValue(mine ? state.values : undefined, noteName)');
    expect(formSrc).toContain("defaultValue=");
    expect(formSrc.indexOf("defaultValue=")).toBeGreaterThan(formSrc.indexOf("<TextArea"));
  });
  it("the notice host sits in the protected admin layout, outside every row", () => {
    expect(read("src/app/admin/(protected)/layout.tsx")).toContain("<DecisionNoticeHost />");
  });
  it("the host is a polite status region with a dismiss button", () => {
    const host = read("src/components/admin/decision-notice-host.tsx");
    expect(host).toContain('role="status"');
    expect(host).toContain("Dismiss");
  });
});
