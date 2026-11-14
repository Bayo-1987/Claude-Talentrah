/**
 * U7, PR-C regression group: with the push flags OFF, signing out calls no push route and deletes no subscription, and the hook lines are the only edits to existing files.
 * With the flags off the subscribe route is closed, so a browser has no push subscription; the cleanup then finds none and asks for nothing. The edit-footprint checks read the sources.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { cleanupPushForSignOut } from "@/lib/notifications/push/signout-cleanup";

const ROOT = path.resolve(__dirname, "../../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const A1_TIP = "052f35ac10e4c2aab86ee73ac060b4997827473f";

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

describe("the edit footprint on existing files", () => {
  /** Lines added or removed against the A1 tip, as +/- lines without the file headers. */
  function changed(file: string): string[] {
    const out = execFileSync("git", ["diff", "--unified=0", A1_TIP, "--", file], { cwd: ROOT, encoding: "utf8" });
    return out.split("\n").filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l));
  }

  it("account-menu.tsx changes only the import and the sign-out form's opening and closing tag", () => {
    const lines = changed("src/components/app-shell/account-menu.tsx");
    expect(lines.sort()).toEqual(
      [
        '+import { PushCleanupForm } from "@/components/app-shell/push-cleanup-form";',
        "+          <PushCleanupForm action={signOutAction}>",
        "+          </PushCleanupForm>",
        "-          <form action={signOutAction}>",
        "-          </form>",
      ].sort(),
    );
  });

  it("both sign-out forms of the pending-deletion prompt go through the cleanup; the restore form does not", () => {
    const src = read("src/components/account-deletion/scheduled-deletion-prompt.tsx");
    expect(src.match(/<PushCleanupForm action=\{keepDeletionAction\}>/g)).toHaveLength(2);
    expect(src).not.toMatch(/<form action=\{keepDeletionAction\}>/);
    expect(src).toContain("<form action={restoreAccountAction}>");
  });

  it("no migration, package.json or lockfile change, and no service worker change", () => {
    const names = execFileSync("git", ["diff", "--name-only", A1_TIP, "--"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
    expect(names.filter((n) => /^supabase\/|^package(-lock)?\.json$|service-worker/.test(n))).toEqual([]);
  });
});
