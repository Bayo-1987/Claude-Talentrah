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
import { ANNOUNCE_WINDOW_MS, announcementDueAtUnmount, wrapDecisionAction } from "@/lib/admin/moderation/decision-action";
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

describe("wrapDecisionAction: an error keeps the note (DECISION-NOTE-1)", () => {
  it("an error comes back with the note exactly as typed", async () => {
    const run = wrapDecisionAction(async () => ({ status: "error", message: "Already decided by someone else.", targetId: "org-1" }), { noteName: "note" });
    const out = await run(idle, form("  they sent two different CAC numbers  "));
    expect(out.status).toBe("error");
    expect(out.values).toEqual({ note: "  they sent two different CAC numbers  " });
  });
  it("an error that already carries its own values is left alone", async () => {
    const own = { status: "error", message: "x", targetId: "org-1", values: { note: "kept by the action" } } as const;
    const out = await wrapDecisionAction(async () => own, { noteName: "note" })(idle, form("typed"));
    expect(out.values).toEqual({ note: "kept by the action" });
  });
  it("a success hands back no values, so the next note box starts clean", async () => {
    const out = await wrapDecisionAction(async () => ({ status: "success", message: "Verified.", targetId: "org-1" }), { noteName: "note" })(idle, form("typed"));
    expect(out.values).toBeUndefined();
  });
  it("it follows the caller's note field name", async () => {
    const f = new FormData();
    f.set("reason", "because");
    const out = await wrapDecisionAction(async () => ({ status: "error", message: "x" }), { noteName: "reason" })(idle, f);
    expect(out.values).toEqual({ reason: "because" });
  });
  it("it passes the previous state and the form data to the real action untouched", async () => {
    const real = vi.fn(async (): Promise<ModerationState> => idle);
    const f = form("n");
    await wrapDecisionAction(real, { noteName: "note" })(idle, f);
    expect(real).toHaveBeenCalledWith(idle, f);
  });
});

describe("wrapDecisionAction: a success is remembered for the row, to be announced if the row goes (DECISION-SILENT-1/2)", () => {
  it("a success with a message is handed to onSuccess once, with the time it happened", async () => {
    const onSuccess = vi.fn();
    await wrapDecisionAction(async () => ({ status: "success", message: "Verified “Acme”.", targetId: "org-1" }), { noteName: "note", onSuccess, now: () => 1234 })(idle, form(""));
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledWith("Verified “Acme”.", 1234);
  });
  it("an error is never remembered", async () => {
    const onSuccess = vi.fn();
    await wrapDecisionAction(async () => ({ status: "error", message: "Already decided by someone else." }), { noteName: "note", onSuccess })(idle, form(""));
    expect(onSuccess).not.toHaveBeenCalled();
  });
  it("a success with no message is not remembered", async () => {
    const onSuccess = vi.fn();
    await wrapDecisionAction(async () => ({ status: "success" }), { noteName: "note", onSuccess })(idle, form(""));
    expect(onSuccess).not.toHaveBeenCalled();
  });
});

describe("announcementDueAtUnmount: the row going away is the signal, however late it goes (DECISION-SILENT-2)", () => {
  // The first version looked once, 600 ms after the success, and announced only if the row was already gone. A slow revalidation (a busy server, a slow phone) removes the row later than that, so
  // the check found it still there, announced nothing, and the confirmation was lost: QA saw it missing in 1 run of 12, even after 10 s. Now the form tells on its own unmount.
  const at = 1_000_000;
  it("the row is removed 0.1 s, 2 s, 8 s or 25 s after the success: the message is due each time", () => {
    for (const later of [100, 2_000, 8_000, 25_000]) expect(announcementDueAtUnmount({ message: "Verified.", at }, at + later), `${later} ms`).toBe("Verified.");
  });
  it("a row that goes long after (the person left the page minutes later) announces nothing stale", () => {
    expect(announcementDueAtUnmount({ message: "Verified.", at }, at + ANNOUNCE_WINDOW_MS + 1)).toBeNull();
  });
  it("nothing remembered: nothing due (a row that was never decided, or an error)", () => expect(announcementDueAtUnmount(null, at)).toBeNull());
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
  it("the form remembers its success and announces it from its OWN unmount cleanup, not from a timed look at the page", () => {
    expect(formSrc).toContain("announcementDueAtUnmount(");
    expect(formSrc).toMatch(/useEffect\(\s*\(\) => \(\) => \{[^}]*announceDecision\(/);
    expect(formSrc).not.toContain("setTimeout");
    expect(formSrc).not.toContain("rowIsGone");
    expect(formSrc).not.toContain("isConnected");
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
