/**
 * The remembered side (src/lib/auth/side-preference.ts): what the cookie may hold, where a switch may go, the cookie's attributes, and how it is removed. Pure functions, no server.
 */
import { describe, expect, it } from "vitest";
import { SIDE_COOKIE, SIDE_COOKIE_MAX_AGE_SECONDS, clearSideCookie, parseSide, sideCookieOptions, sideRoot } from "@/lib/auth/side-preference";

describe("parseSide: exactly two values", () => {
  it("accepts seeker and employer exactly as spelled", () => {
    expect(parseSide("seeker")).toBe("seeker");
    expect(parseSide("employer")).toBe("employer");
  });

  it.each(["", " ", "Seeker", "EMPLOYER", "employer ", " seeker", "employer;seeker", "seekers", "admin", "jobs", "/employer", "null", "undefined", "x".repeat(5000)])("rejects the string %j", (value) => {
    expect(parseSide(value)).toBeNull();
  });

  it.each([null, undefined, 0, 1, true, false, {}, ["employer"], ["seeker"], { toString: () => "employer" }])("rejects a value that is not a string: %j", (value) => {
    expect(parseSide(value)).toBeNull();
  });
});

describe("sideRoot: fixed destinations only", () => {
  it("seeker goes to /jobs and employer goes to /employer", () => {
    expect(sideRoot("seeker")).toBe("/jobs");
    expect(sideRoot("employer")).toBe("/employer");
  });
});

describe("the cookie", () => {
  it("is named tr_side", () => {
    expect(SIDE_COOKIE).toBe("tr_side");
  });

  it("lasts 365 days", () => {
    expect(SIDE_COOKIE_MAX_AGE_SECONDS).toBe(365 * 24 * 60 * 60);
  });

  it("is HttpOnly, SameSite Lax, Path /, 365 days, and Secure only in production", () => {
    expect(sideCookieOptions(false)).toEqual({ httpOnly: true, sameSite: "lax", secure: false, path: "/", maxAge: 31_536_000 });
    expect(sideCookieOptions(true)).toEqual({ httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: 31_536_000 });
  });

  it("is removed with exactly one delete of tr_side on path /", () => {
    const calls: unknown[] = [];
    clearSideCookie({ delete: (options) => calls.push(options) });
    expect(calls).toEqual([{ name: "tr_side", path: "/" }]);
  });
});
