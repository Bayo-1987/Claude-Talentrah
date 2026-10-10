/**
 * Sign-out scopes (S1-44). `supabase.auth.signOut()` with no argument is `scope: "global"`: it deletes EVERY session the user has, on every
 * device and tab. The header's "Sign out" called it bare, so signing out on a laptop signed the phone out too, and the phone's next navigation
 * failed with `refresh_token_not_found`. Production logs, 2026-10-02: 9 sign-outs, every one `/logout?scope=global`, 10 server-side
 * `refresh_token_not_found` in the same hours.
 *
 *   - the header's sign-out signs out THIS device only (`local`);
 *   - Settings has an explicit "Sign out of all devices" (`global`), with a confirm step that says what it does;
 *   - setting a new password through the reset flow signs out the user's OTHER sessions (`others`) and keeps the current one;
 *   - account deletion stays global (ACCT-1, PR #686): that is its job;
 *   - no `signOut(` call anywhere in src leaves the scope implicit.
 * The actions run for real against mocks of the Supabase client; no database.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const auth = vi.hoisted(() => ({
  signOut: vi.fn(async () => ({ error: null })),
  updateUser: vi.fn(),
  getUser: vi.fn(async () => ({ data: { user: { id: "u1" } } })),
}));
const redirect = vi.hoisted(() => vi.fn((to: string) => { throw Object.assign(new Error("NEXT_REDIRECT"), { to }); }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth }) }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({}) }));
vi.mock("@/lib/analytics/posthog", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/analytics/posthog")>()), captureEvent: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("next/headers", () => ({ headers: async () => ({ get: () => null }), cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => {}, delete: () => {} }) }));

const actions = await import("@/lib/auth/actions");

beforeEach(() => { auth.signOut.mockClear(); auth.updateUser.mockReset(); redirect.mockClear(); });

async function toLoginRedirect(run: () => Promise<unknown>) {
  await expect(run()).rejects.toMatchObject({ to: "/login" });
}

describe("the header's Sign out", () => {
  it("signs out this device only", async () => {
    await toLoginRedirect(() => actions.signOutAction());
    expect(auth.signOut).toHaveBeenCalledTimes(1);
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });
});

describe("Settings: Sign out of all devices", () => {
  it("signs out every session, on purpose", async () => {
    await toLoginRedirect(() => actions.signOutEverywhereAction());
    expect(auth.signOut).toHaveBeenCalledTimes(1);
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "global" });
  });
});

describe("setting a new password through the reset flow", () => {
  const form = () => { const fd = new FormData(); fd.set("password", "Password123"); return fd; };

  it("signs out the user's OTHER sessions and keeps this one", async () => {
    auth.updateUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    await actions.updatePasswordAction({ error: null }, form()).catch(() => {});
    expect(auth.updateUser).toHaveBeenCalledTimes(1);
    expect(auth.signOut).toHaveBeenCalledTimes(1);
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "others" });
    // the password change happened first
    expect(auth.updateUser.mock.invocationCallOrder[0]).toBeLessThan(auth.signOut.mock.invocationCallOrder[0]);
  });

  it("does not sign anyone out when the password change itself failed", async () => {
    auth.updateUser.mockResolvedValue({ data: { user: null }, error: { message: "nope" } });
    const r = await actions.updatePasswordAction({ error: null }, form());
    expect(r.error).toBe("nope");
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it("a failure to end the other sessions does not undo or block the password change", async () => {
    auth.updateUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    auth.signOut.mockResolvedValueOnce({ error: { message: "boom" } } as never);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await actions.updatePasswordAction({ error: null }, form()).catch(() => {});
    expect(auth.signOut).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("source: no signOut call leaves its scope implicit", () => {
  const ROOT = path.resolve(__dirname, "../..");
  const walk = (dir: string): string[] =>
    readdirSync(path.join(ROOT, dir)).flatMap((n) => {
      const rel = `${dir}/${n}`;
      return statSync(path.join(ROOT, rel)).isDirectory() ? walk(rel) : /\.tsx?$/.test(n) ? [rel] : [];
    });
  const files = walk("src");
  const strip = (s: string) => s.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

  /** Every `.signOut(` call and its argument text, to the matching parenthesis. */
  function signOutCalls(src: string): string[] {
    const out: string[] = [];
    for (const m of src.matchAll(/\.signOut\(/g)) {
      let depth = 1, i = m.index! + m[0].length;
      while (i < src.length && depth > 0) { if (src[i] === "(") depth++; else if (src[i] === ")") depth--; i++; }
      out.push(src.slice(m.index! + m[0].length, i - 1));
    }
    return out;
  }

  it("the scanner finds the calls (not vacuous), and sees a bare one as bare", () => {
    expect(signOutCalls("await supabase.auth.signOut();")).toEqual([""]);
    expect(signOutCalls("await supabase.auth.signOut({ scope: \"local\" });")).toEqual(['{ scope: "local" }']);
    const all = files.flatMap((f) => signOutCalls(strip(readFileSync(path.join(ROOT, f), "utf8"))));
    expect(all.length).toBeGreaterThanOrEqual(3);
  });

  it("every signOut( in src names a scope", () => {
    const offenders: string[] = [];
    for (const f of files) {
      for (const args of signOutCalls(strip(readFileSync(path.join(ROOT, f), "utf8")))) {
        if (!/\bscope\s*:\s*["'](local|global|others)["']/.test(args)) offenders.push(`${f}: signOut(${args})`);
      }
    }
    expect(offenders, "a bare signOut() is scope: global, which signs out every device").toEqual([]);
  });
});
