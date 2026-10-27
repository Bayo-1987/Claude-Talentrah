/**
 * The rules of the account menu's side switch (src/lib/auth/switch-side-logic.ts), run with fakes for the session, the membership lookup, the cookie and the redirect:
 * no server, no database, no module mocks. switch-side.ts only wires the real ones in (tests/auth/switch-side-wiring.test.ts).
 */
import { describe, expect, it } from "vitest";
import { switchSide, type SwitchSideDeps } from "@/lib/auth/switch-side-logic";

class Redirected extends Error {
  constructor(readonly path: string) {
    super("NEXT_REDIRECT");
  }
}

function world(over: { user?: string | null; member?: boolean | "throws" } = {}) {
  const log: string[] = [];
  const deps: SwitchSideDeps = {
    userId: async () => {
      log.push("userId");
      return over.user === undefined ? "user-1" : over.user;
    },
    isMember: async (id) => {
      log.push(`isMember:${id}`);
      if (over.member === "throws") throw new Error("lookup failed");
      return over.member ?? true;
    },
    setSide: (side) => {
      log.push(`set:${side}`);
    },
    go: (path) => {
      log.push(`go:${path}`);
      throw new Redirected(path);
    },
  };
  return { log, deps };
}

describe("a value that is not exactly seeker or employer does nothing at all", () => {
  it.each(["", "Employer", "SEEKER", "employer ", "admin", "/employer", "https://evil.example", null, undefined, 5, {}, ["employer"]])("%j", async (raw) => {
    const w = world();
    await expect(switchSide(raw, w.deps)).resolves.toBeUndefined();
    expect(w.log, "not even the session is read").toEqual([]);
  });
});

describe("signed out", () => {
  it("sets nothing and redirects nowhere, for either side", async () => {
    for (const side of ["seeker", "employer"]) {
      const w = world({ user: null });
      await expect(switchSide(side, w.deps)).resolves.toBeUndefined();
      expect(w.log).toEqual(["userId"]);
    }
  });
});

describe("seeker", () => {
  it("is allowed for any signed-in user without asking about membership: set the cookie, then go to /jobs", async () => {
    const w = world({ member: false });
    await expect(switchSide("seeker", w.deps)).rejects.toMatchObject({ path: "/jobs" });
    expect(w.log).toEqual(["userId", "set:seeker", "go:/jobs"]);
  });
});

describe("employer", () => {
  it("a member: membership is checked for THIS user, then the cookie is set, then /employer", async () => {
    const w = world({ user: "user-42", member: true });
    await expect(switchSide("employer", w.deps)).rejects.toMatchObject({ path: "/employer" });
    expect(w.log).toEqual(["userId", "isMember:user-42", "set:employer", "go:/employer"]);
  });

  it("a non-member is refused: no cookie, no redirect", async () => {
    const w = world({ member: false });
    await expect(switchSide("employer", w.deps)).resolves.toBeUndefined();
    expect(w.log).toEqual(["userId", "isMember:user-1"]);
  });

  it("a failed membership lookup is a refusal, not a pass", async () => {
    const w = world({ member: "throws" });
    await expect(switchSide("employer", w.deps)).resolves.toBeUndefined();
    expect(w.log).toEqual(["userId", "isMember:user-1"]);
  });
});

describe("the redirect", () => {
  it("is one of two constants and is not swallowed", async () => {
    const targets = new Set<string>();
    for (const side of ["seeker", "employer"]) {
      const w = world();
      await switchSide(side, w.deps).catch((e: Redirected) => targets.add(e.path));
    }
    expect([...targets].sort()).toEqual(["/employer", "/jobs"]);
  });
});
