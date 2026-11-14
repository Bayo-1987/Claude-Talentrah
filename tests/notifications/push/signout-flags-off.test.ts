/**
 * U7, PR-C regression group: with the push flags OFF, signing out calls no push route and deletes no subscription, and the hook lines are the only edits to existing files (read from the sources, with no git call, so a shallow checkout or a squash merge cannot break it).
 * With the flags off the subscribe route is closed, so a browser has no push subscription; the cleanup then finds none and asks for nothing. The edit-footprint checks read the sources.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { cleanupPushForSignOut } from "@/lib/notifications/push/signout-cleanup";

const ROOT = path.resolve(__dirname, "../../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

describe("flags off", () => {
  it("signing out with no push subscription calls no push route, no unsubscribe, and deletes nothing", async () => {
    const seen: string[] = [];
    await cleanupPushForSignOut({
      getSubscription: async () => null,
      fetch: async (url) => { seen.push(`fetch ${url}`); return { ok: true }; },
      warn: (...a) => { seen.push(`warn ${a.join(" ")}`); },
    });
    expect(seen).toEqual([]);
  });

  it("a browser without the service worker or push API behaves the same", async () => {
    const seen: string[] = [];
    await cleanupPushForSignOut({
      getSubscription: async () => { throw new Error("no push"); },
      fetch: async (url) => { seen.push(url); return { ok: true }; },
      warn: () => undefined,
    });
    expect(seen).toEqual([]);
  });
});

describe("the hook lines in existing files", () => {
  it("account-menu.tsx: the sign-out form goes through the cleanup, and the original plain form is gone", () => {
    const src = read("src/components/app-shell/account-menu.tsx");
    expect(src).toContain('import { PushCleanupForm } from "@/components/app-shell/push-cleanup-form";');
    expect(src.match(/<PushCleanupForm action=\{signOutAction\}>/g)).toHaveLength(1);
    expect(src.match(/<\/PushCleanupForm>/g)).toHaveLength(1);
    expect(src).not.toContain("<form action={signOutAction}>");
    // The other form in the menu (switch side) is still a plain form: only sign-out was hooked.
    expect(src).toContain("<form action={switchSideAction}>");
    expect(src.match(/<\/form>/g)).toHaveLength(1);
  });

  it("both sign-out forms of the pending-deletion prompt go through the cleanup; the restore form does not", () => {
    const src = read("src/components/account-deletion/scheduled-deletion-prompt.tsx");
    expect(src.match(/<PushCleanupForm action=\{keepDeletionAction\}>/g)).toHaveLength(2);
    expect(src.match(/<\/PushCleanupForm>/g)).toHaveLength(2);
    expect(src).not.toMatch(/<form action=\{keepDeletionAction\}>/);
    expect(src).toContain("<form action={restoreAccountAction}>");
  });

  it("the hook adds no push work of its own: the cleanup is the injected default and nothing else is imported from the push folder", () => {
    for (const rel of ["src/components/app-shell/account-menu.tsx", "src/components/account-deletion/scheduled-deletion-prompt.tsx"]) {
      expect(read(rel), rel).not.toMatch(/notifications\/push/);
    }
  });
});
