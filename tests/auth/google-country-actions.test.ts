/**
 * Continue on the Google country step (owner, 9 Oct). Fakes only: the Supabase client records what is written and in what order; nothing touches a database.
 *
 * Pinned: an empty or unlisted submit saves NOTHING and says "Select a country to continue."; a listed country is saved to the profile AND to the auth user's metadata
 * (the flag the proxy gate reads), then the session is refreshed, in that order, then the person goes to where they were heading (this site only, never the step itself);
 * a failure at either write is reported and does not redirect.
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
const { destinationAfterStep } = await import("@/lib/auth/country-step-destination");

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

describe("nothing is saved without a listed country", () => {
  it("empty submit: the error from the spec, nothing written", async () => {
    const out = await submit({ country: "", next: "/dashboard" });
    expect(out).toMatchObject({ status: "error", message: "Select a country to continue." });
    expect(world.log).toEqual([]);
    expect(world.redirectedTo).toBeNull();
  });
  it("no country field at all (an untouched placeholder is not submitted): the same", async () => {
    expect(await submit({ next: "/dashboard" })).toMatchObject({ status: "error", message: "Select a country to continue." });
    expect(world.log).toEqual([]);
  });
  it("a value that is not on the sign-up list: refused, nothing written", async () => {
    expect(await submit({ country: "Atlantis" })).toMatchObject({ status: "error" });
    expect(await submit({ country: "nigeria" })).toMatchObject({ status: "error" });
    expect(world.log).toEqual([]);
  });
});

describe("a listed country is saved in both places, in order, then the person moves on", () => {
  it("profile, then auth metadata, then a session refresh, then the redirect to where they were going", async () => {
    const out = await submit({ country: "Nigeria", next: "/jobs/abc?utm=x" });
    expect(out).toBeInstanceOf(Error);
    expect(world.log).toEqual([
      'update profiles {"country":"Nigeria"} where id=u1',
      'updateUser {"data":{"country":"Nigeria"}}',
      "refreshSession",
    ]);
    expect(world.redirectedTo).toBe("/jobs/abc?utm=x");
  });
  it("'Other' is a listed choice, as on the sign-up form", async () => {
    await submit({ country: "Other", next: "/dashboard" });
    expect(world.log[0]).toContain('"country":"Other"');
  });
});

describe("failures are reported and do not redirect", () => {
  it("the profile write fails: a retryable message, the auth metadata is NOT touched", async () => {
    world.profileError = { message: "boom" };
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const out = await submit({ country: "Kenya", next: "/dashboard" });
    expect(out).toMatchObject({ status: "error", values: { country: "Kenya" } });
    expect(world.log.some((l) => l.startsWith("updateUser"))).toBe(false);
    expect(world.redirectedTo).toBeNull();
  });
  it("the metadata write fails: reported, no redirect (the person stays on the step and retries)", async () => {
    world.metaError = { message: "boom" };
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await submit({ country: "Kenya", next: "/dashboard" })).toMatchObject({ status: "error", message: expect.stringMatching(/try again/i) });
    expect(world.redirectedTo).toBeNull();
  });
});

describe("where the person goes afterwards", () => {
  it.each([
    ["/jobs/abc", "/jobs/abc"],
    ["/settings?tab=profile", "/settings?tab=profile"],
    [undefined, "/jobs"],
    ["", "/jobs"],
    ["https://evil.example/", "/jobs"],
    ["//evil.example/x", "/jobs"],
    ["/welcome/country", "/jobs"],
    ["/welcome/country?next=/x", "/jobs"],
    ["/welcome/country/sync", "/jobs"],
  ])("%j -> %s", (raw, expected) => expect(destinationAfterStep(raw)).toBe(expected));
});

describe("the saved country shows where the owner expects it", () => {
  // The step writes profiles.country: the column Settings edits and /admin/people/signups lists. Pinned by reading those two readers, so a rename on either side fails here.
  it("Settings and the admin sign-ups list both read profiles.country", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const root = path.join(__dirname, "../..");
    const signups = readFileSync(path.join(root, "src/lib/admin/people/signups.ts"), "utf8");
    expect(signups).toMatch(/"id, email, first_name, last_name, country,/);
    const settings = readFileSync(path.join(root, "src/lib/profile/settings-actions.ts"), "utf8");
    expect(settings).toContain("country: parsed.data.country");
    const step = readFileSync(path.join(root, "src/lib/auth/google-country-actions.ts"), "utf8");
    expect(step).toContain('.from("profiles").update({ country })');
  });
});
