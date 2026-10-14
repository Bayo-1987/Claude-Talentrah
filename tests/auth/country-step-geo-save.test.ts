/**
 * COUNTRY-DEFAULT-GEO-1, the save side: a suggestion (from the IP or the browser) is only pre-selected text in a box. What is saved is what the form SUBMITS on Continue: the suggestion if the person left it,
 * a different choice if they changed it, and nothing at all for an empty or unlisted value. Fakes only (same harness as google-country-actions.test.ts, which stays unchanged).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const world = vi.hoisted(() => ({
  log: [] as string[],
  profileError: null as { message: string } | null,
  metaError: null as { message: string } | null,
  redirectedTo: null as string | null,
}));

vi.mock("@/lib/auth/require-user", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/auth/require-user")>()), requireUser: async () => ({ user: { id: "u1" }, profile: {} }) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => ({
      update: (patch: Record<string, unknown>) => ({
        eq: async (col: string, val: string) => {
          world.log.push(`update ${table} ${JSON.stringify(patch)} where ${col}=${val}`);
          return { error: world.profileError };
        },
      }),
    }),
    auth: {
      updateUser: async (attrs: Record<string, unknown>) => {
        world.log.push(`updateUser ${JSON.stringify(attrs)}`);
        return { error: world.metaError };
      },
      refreshSession: async () => {
        world.log.push("refreshSession");
        return { error: null };
      },
    },
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    world.redirectedTo = to;
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
}));

const { saveGoogleCountryAction } = await import("@/lib/auth/google-country-actions");
const { initialCountryStepState } = await import("@/lib/auth/country-step-state");

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
const submit = (fields: Record<string, string>) => saveGoogleCountryAction(initialCountryStepState, form(fields)).catch((e: Error) => e);

beforeEach(() => {
  world.log = [];
  world.profileError = null;
  world.metaError = null;
  world.redirectedTo = null;
});

describe("what is saved is what is submitted on Continue", () => {
  it("the suggestion left as it was (Nigeria): Nigeria is saved, to the profile and the auth user, then on to where they were going", async () => {
    const out = await submit({ country: "Nigeria", next: "/jobs" });
    expect(out).toBeInstanceOf(Error);
    expect(world.log.filter((l) => l.startsWith("update profiles"))).toEqual([expect.stringContaining('"country":"Nigeria"')]);
    expect(world.log.some((l) => l.startsWith("updateUser") && l.includes("Nigeria"))).toBe(true);
    expect(world.redirectedTo).toBe("/jobs");
  });
  it("a different choice wins (suggested Nigeria, submitted Ghana): only Ghana is written", async () => {
    await submit({ country: "Ghana", next: "/jobs" });
    expect(world.log.join("\n")).toContain('"country":"Ghana"');
    expect(world.log.join("\n")).not.toContain("Nigeria");
  });
  it("still validates against the sign-up list: an unlisted value, 'Other' spelled wrongly or a code is refused and writes nothing", async () => {
    for (const bad of ["NG", "nigeria", "Nigeria ", "Narnia", "OTHER"]) {
      world.log = [];
      expect(await submit({ country: bad, next: "/jobs" }), bad).toMatchObject({ status: "error", message: "Select a country to continue." });
      expect(world.log, bad).toEqual([]);
    }
  });
  it("'Other' is a listed choice and saves", async () => {
    await submit({ country: "Other", next: "/jobs" });
    expect(world.log.join("\n")).toContain('"country":"Other"');
  });
});
