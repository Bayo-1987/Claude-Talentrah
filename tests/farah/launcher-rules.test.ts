/**
 * The Farah launcher's pure rules, part 1 (PR-1 of the mobile launcher plan): which pages may show it, and how the expanded pill and the collapsed round launcher follow each other.
 *
 * Nothing imports these modules yet. The tests pin the contract the components will rely on:
 *  - the deny-list is EXACT: four routes, matched whole after the router's own spellings are reduced (a query, a fragment, any trailing slashes, one level of percent-encoding), never by prefix;
 *    everything else, /billing included, is allowed; an unknown or missing path is allowed;
 *  - the pill (Option A of the plan): the server render and the first client render are collapsed; the pill expands after mount only when the launcher has not been seen; it collapses once
 *    the user has opened Farah and never comes back that page load; there is no view counter.
 */
import { describe, expect, it } from "vitest";
import {
  FARAH_LAUNCHER_DENIED_PATHS,
  FARAH_SHELL_BREAKPOINT_PX,
  INITIAL_LAUNCHER_STATE,
  farahLauncherAllowedFor,
  isPhoneWidth,
  launcherReducer,
  type LauncherEvent,
  type LauncherState,
} from "@/lib/farah/launcher-rules";

const DENIED = ["/billing/callback", "/mentorship/book/callback", "/settings/account-deletion", "/settings/delete-account/confirm"];

describe("the deny-list is exactly the four approved routes", () => {
  it("lists them and nothing else", () => {
    expect([...FARAH_LAUNCHER_DENIED_PATHS].sort()).toEqual([...DENIED].sort());
    expect(new Set(FARAH_LAUNCHER_DENIED_PATHS).size).toBe(FARAH_LAUNCHER_DENIED_PATHS.length);
  });
  it.each(DENIED)("%s is denied", (path) => {
    expect(farahLauncherAllowedFor(path)).toBe(false);
  });
});

describe("/billing itself and every other page is allowed", () => {
  it.each([
    "/billing",
    "/billing/",
    "/jobs",
    "/jobs/123e4567-e89b-42d3-a456-426614174000",
    "/tracker",
    "/tailor",
    "/resume-builder/edit",
    "/scholarships",
    "/mentorship",
    "/mentorship/book",
    "/refer",
    "/settings",
    "/settings/delete-account",
    "/auto-apply",
    "/feedback",
  ])("%s is allowed", (path) => {
    expect(farahLauncherAllowedFor(path)).toBe(true);
  });
});

describe("matching is exact: no prefix, no suffix, no look-alike", () => {
  it.each([
    "/billing/callbacks",
    "/billing/callback-x",
    "/billing/callbackx",
    "/billing/callback/extra",
    "/billing/callback/extra/deeper",
    "/xbilling/callback",
    "/mentorship/book/callback/extra",
    "/mentorship/book/callbacks",
    "/mentorship/callback",
    "/settings/account-deletion/more",
    "/settings/account-deletions",
    "/settings/delete-account/confirmation",
    "/settings/delete-account/confirm/extra",
    "/settings/delete-account-confirm",
    "/billing/callback.json",
  ])("%s is allowed (it is not one of the four)", (path) => {
    expect(farahLauncherAllowedFor(path)).toBe(true);
  });
});

describe("the router's spellings of the same page are reduced before matching", () => {
  it.each([
    ["a trailing slash", "/billing/callback/"],
    ["two trailing slashes", "/billing/callback//"],
    ["a query string", "/billing/callback?reference=abc"],
    ["a query and a trailing slash before it", "/billing/callback/?reference=abc"],
    ["a fragment", "/billing/callback#top"],
    ["a query and a fragment", "/mentorship/book/callback?x=1#y"],
    ["a trailing slash on a deletion page", "/settings/account-deletion/"],
    ["a trailing slash on the confirm page", "/settings/delete-account/confirm/"],
    ["a percent-encoded letter", "/billing/%63allback"],
    ["a percent-encoded slash at the end", "/billing/callback%2F"],
    ["a percent-encoded letter in the second segment", "/settings/delete-account/c%6Fnfirm"],
  ])("%s is still denied: %s", (_name, path) => {
    expect(farahLauncherAllowedFor(path)).toBe(false);
  });
  it("decodes ONE level only: a double-encoded spelling is a different string and is allowed", () => {
    expect(farahLauncherAllowedFor("/billing/%2563allback")).toBe(true);
  });
  it("a malformed percent sequence does not throw and is judged as written", () => {
    expect(() => farahLauncherAllowedFor("/billing/%E0%A4%A")).not.toThrow();
    expect(farahLauncherAllowedFor("/billing/%E0%A4%A")).toBe(true);
    expect(farahLauncherAllowedFor("/billing/callback%")).toBe(true);
  });
});

describe("matching is case-sensitive, because the routes are", () => {
  it.each(["/Billing/Callback", "/BILLING/CALLBACK", "/billing/Callback", "/Mentorship/book/callback", "/settings/Account-Deletion"])("%s is not one of the four routes and is allowed", (path) => {
    expect(farahLauncherAllowedFor(path)).toBe(true);
  });
});

describe("an unknown or missing path is allowed (the deny-list is the exception, not the rule)", () => {
  it.each([null, undefined, "", "/", "?", "#", "//", "not-a-path"])("%j is allowed", (path) => {
    expect(farahLauncherAllowedFor(path as string | null | undefined)).toBe(true);
  });
  it("a value that is not a string does not throw and is allowed", () => {
    for (const odd of [5, {}, [], true, Symbol.iterator] as unknown[]) {
      expect(() => farahLauncherAllowedFor(odd as string)).not.toThrow();
      expect(farahLauncherAllowedFor(odd as string)).toBe(true);
    }
  });
});

describe("the shell breakpoint", () => {
  it("is 760 and a phone is strictly below it", () => {
    expect(FARAH_SHELL_BREAKPOINT_PX).toBe(760);
    expect(isPhoneWidth(759)).toBe(true);
    expect(isPhoneWidth(760)).toBe(false);
    expect(isPhoneWidth(1280)).toBe(false);
    expect(isPhoneWidth(320)).toBe(true);
  });
  it("is false for a width that is not a positive number", () => {
    for (const w of [Number.NaN, 0, -1, Number.POSITIVE_INFINITY, undefined as unknown as number]) expect(isPhoneWidth(w)).toBe(false);
  });
});

describe("the pill and the round launcher", () => {
  const run = (events: LauncherEvent[], from: LauncherState = INITIAL_LAUNCHER_STATE) => events.reduce(launcherReducer, from);

  it("the server render and the first client render are collapsed", () => {
    expect(INITIAL_LAUNCHER_STATE).toEqual({ expanded: false, opened: false });
  });
  it("after mount it expands only when the launcher has not been seen", () => {
    expect(run([{ type: "mounted", seen: false }]).expanded).toBe(true);
    expect(run([{ type: "mounted", seen: true }]).expanded).toBe(false);
  });
  it("it collapses once the user has opened Farah, and stays collapsed", () => {
    const opened = run([{ type: "mounted", seen: false }, { type: "opened" }]);
    expect(opened).toEqual({ expanded: false, opened: true });
    expect(run([{ type: "opened" }], opened)).toEqual(opened);
  });
  it("a late 'mounted, not seen' after the user opened Farah does not bring the pill back", () => {
    expect(run([{ type: "opened" }, { type: "mounted", seen: false }])).toEqual({ expanded: false, opened: true });
  });
  it("Option A: no view counter. Ten mounts without opening leave the pill expanded; the state has no count", () => {
    const state = run(Array.from({ length: 10 }, () => ({ type: "mounted", seen: false }) as LauncherEvent));
    expect(state.expanded).toBe(true);
    expect(Object.keys(state).sort()).toEqual(["expanded", "opened"]);
  });
  it("an event it does not know changes nothing and does not throw", () => {
    const before = run([{ type: "mounted", seen: false }]);
    expect(launcherReducer(before, { type: "nonsense" } as unknown as LauncherEvent)).toEqual(before);
  });
  it("the reducer does not mutate the state it is given", () => {
    const frozen = Object.freeze({ expanded: true, opened: false });
    expect(() => launcherReducer(frozen, { type: "opened" })).not.toThrow();
    expect(frozen).toEqual({ expanded: true, opened: false });
  });
});
