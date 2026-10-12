/**
 * /welcome/country/sync: a Google account that already has a country on its profile gets it copied into its auth metadata (the flag the proxy gate reads) and
 * moves on, without seeing the form. Fakes only: @supabase/ssr is stubbed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const world = vi.hoisted(() => ({
  user: { id: "u1" } as { id: string } | null,
  profileCountry: "Ghana" as string | null,
  updateError: null as { message: string } | null,
  calls: [] as string[],
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: world.user } }),
      updateUser: async (attrs: unknown) => {
        world.calls.push(`updateUser ${JSON.stringify(attrs)}`);
        return { error: world.updateError };
      },
      refreshSession: async () => {
        world.calls.push("refreshSession");
        return { error: null };
      },
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { country: world.profileCountry } }) }) }) }),
  }),
}));

const { GET } = await import("@/app/welcome/country/sync/route");
const get = (qs = "") => GET(new NextRequest(`https://www.talentrah.com/welcome/country/sync${qs}`));

beforeEach(() => {
  world.user = { id: "u1" };
  world.profileCountry = "Ghana";
  world.updateError = null;
  world.calls = [];
});

describe("the sync route", () => {
  it("copies the profile's country into the metadata, refreshes the session, and goes to where the person was heading", async () => {
    const res = await get("?next=%2Fjobs%2Fabc");
    expect(world.calls).toEqual(['updateUser {"data":{"country":"Ghana"}}', "refreshSession"]);
    expect(res.headers.get("location")).toBe("https://www.talentrah.com/jobs/abc");
  });
  it("signed out: to /login, nothing written", async () => {
    world.user = null;
    const res = await get();
    expect(new URL(res.headers.get("location")!).pathname).toBe("/login");
    expect(world.calls).toEqual([]);
  });
  it("the profile has no listed country: back to the step (with the destination), nothing written", async () => {
    world.profileCountry = null;
    const res = await get("?next=%2Fsettings");
    const to = new URL(res.headers.get("location")!);
    expect(to.pathname).toBe("/welcome/country");
    expect(to.searchParams.get("next")).toBe("/settings");
    expect(world.calls).toEqual([]);
    world.profileCountry = "Not a country";
    expect(new URL((await get()).headers.get("location")!).pathname).toBe("/welcome/country");
  });
  it("the metadata write fails: back to the step, so the person is never stranded", async () => {
    world.updateError = { message: "boom" };
    expect(new URL((await get()).headers.get("location")!).pathname).toBe("/welcome/country");
  });
  it("an off-site or looping 'next' is replaced by the default", async () => {
    expect((await get("?next=https%3A%2F%2Fevil.example")).headers.get("location")).toBe("https://www.talentrah.com/jobs");
    expect((await get("?next=%2Fwelcome%2Fcountry")).headers.get("location")).toBe("https://www.talentrah.com/jobs");
  });
});
