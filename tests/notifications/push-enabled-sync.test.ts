/**
 * A successful opt-in on this device also saves the account switch (push_enabled = true), so the toggle and the device agree. Nothing asks for permission on load: the only thing that can is the tap on the opt-in
 * button, whose controller already existed.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PUSH_ENABLED_EVENT, enabledTransition } from "@/components/settings/push-opt-in";

const ROOT = path.resolve(__dirname, "../..");
const code = (p: string) => readFileSync(path.join(ROOT, p), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("recording a successful opt-in", () => {
  it("only a ready state with push on counts", () => {
    expect(enabledTransition({ phase: "ready", push: "on", message: null })).toBe(true);
    for (const push of ["off", "blocked", "needs_install", "unsupported", "stale_worker"] as const) expect(enabledTransition({ phase: "ready", push, message: null }), push).toBe(false);
    expect(enabledTransition({ phase: "loading" })).toBe(false);
    expect(enabledTransition({ phase: "failed" })).toBe(false);
  });
  it("the opt-in calls it after a tap and hands the result to onEnabled", () => {
    const text = code("src/components/settings/push-opt-in.tsx");
    expect(text).toMatch(/enabledTransition\(next\)/);
    expect(text).toMatch(/onEnabled\?\.\(\)/);
  });
  it("the mounted opt-in saves push_enabled = true through the preference action, then tells the page", () => {
    const text = code("src/components/settings/push-opt-in-mount.tsx");
    expect(text).toMatch(/setNotificationPreferenceAction\("push_enabled", true\)/);
    expect(text).toContain("PUSH_ENABLED_EVENT");
    expect(PUSH_ENABLED_EVENT).toBe("talentrah:push-enabled");
  });
  it("the preferences screen listens for it and shows the toggle on", () => {
    const text = code("src/components/settings/notification-preferences.tsx");
    expect(text).toContain("PUSH_ENABLED_EVENT");
    expect(text).toMatch(/addEventListener\(PUSH_ENABLED_EVENT/);
  });
  it("no new file asks for permission by itself: enablePush is not referenced in the mount, and the opt-in only reaches it through its controller's click", () => {
    expect(code("src/components/settings/push-opt-in-mount.tsx")).not.toContain("enablePush");
  });
});
