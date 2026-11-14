/**
 * FEED-PERF-2 F1: the country_default_events insert (the feed_view log) leaves the awaited response path and runs in after(), with the payload unchanged.
 *
 * The feed page is an async Server Component that cannot be rendered here without module factories the ratchet forbids (see tests/jobs/no-default-country-wiring.test.tsx), so the page is
 * read as a syntax tree, as that test does. Two groups:
 *   1. CHARACTERISATION, green on the code as it was: what logCountryDefaultEvent writes (the real function, with only the network edge faked) and what the page hands it.
 *   2. PLACEMENT, red before the move: the page's call is inside the after() callback and in no awaited Promise.all of the response path.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { logCountryDefaultEvent } from "@/lib/jobs/country-events";

const rel = "src/app/(app)/jobs/(feed)/page.tsx";
const file = ts.createSourceFile(rel, readFileSync(path.resolve(__dirname, "../..", rel), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const all = (pred: (n: ts.Node) => boolean): ts.Node[] => {
  const out: ts.Node[] = [];
  const walk = (n: ts.Node) => {
    if (pred(n)) out.push(n);
    ts.forEachChild(n, walk);
  };
  walk(file);
  return out;
};
const isCall = (n: ts.Node, name: string): n is ts.CallExpression => ts.isCallExpression(n) && n.expression.getText() === name;
const squash = (text: string) => text.replace(/\s+/g, " ");
const ancestors = (n: ts.Node): ts.Node[] => {
  const out: ts.Node[] = [];
  for (let p = n.parent; p; p = p.parent) out.push(p);
  return out;
};

describe("characterisation: what is written", () => {
  const originalEnv = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = originalEnv.url;
    process.env.SUPABASE_SERVICE_ROLE_KEY = originalEnv.key;
  });

  /** Fake only the network: record each request the real client makes, answer with the given status. */
  function network(status: number, body: unknown = {}) {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "x.y.z";
    const seen: Array<{ url: string; method: string; body: unknown }> = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ url: String(input), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    });
    return seen;
  }

  it("the feed_view row: exactly user_id, event_type, country_state, job_posting_id (null) and tab, to country_default_events", async () => {
    const seen = network(201);
    await logCountryDefaultEvent({ userId: "user-1", eventType: "feed_view", countryState: "none" as never, tab: "recommended" });
    expect(seen).toHaveLength(1);
    expect(seen[0].method).toBe("POST");
    expect(new URL(seen[0].url).pathname).toBe("/rest/v1/country_default_events");
    expect(seen[0].body).toEqual({ user_id: "user-1", event_type: "feed_view", country_state: "none", job_posting_id: null, tab: "recommended" });
  });

  it("a missing tab and job posting are written as null, not left out", async () => {
    const seen = network(201);
    await logCountryDefaultEvent({ userId: "user-2", eventType: "feed_view", countryState: "none" as never });
    expect(seen[0].body).toEqual({ user_id: "user-2", event_type: "feed_view", country_state: "none", job_posting_id: null, tab: null });
  });

  it("a rejected insert RESOLVES (it does not throw) and logs the event type, the state and the database's message", async () => {
    const seen = network(400, { message: "check constraint violated", code: "23514" });
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(logCountryDefaultEvent({ userId: "user-3", eventType: "feed_view", countryState: "none" as never, tab: "recent" })).resolves.toBeUndefined();
    expect(seen).toHaveLength(1);
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0][0])).toBe("[country-events] failed to log feed_view/none: check constraint violated");
  });

  it("a network failure also resolves, and logs", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "x.y.z";
    vi.stubGlobal("fetch", async () => {
      throw new Error("socket closed");
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(logCountryDefaultEvent({ userId: "user-4", eventType: "feed_view", countryState: "none" as never })).resolves.toBeUndefined();
    expect(log).toHaveBeenCalled();
  });
});

describe("characterisation: what the page hands it", () => {
  it("one call site, with exactly { userId: user.id, eventType: 'feed_view', countryState, tab }, on every signed-in render (no condition around it)", () => {
    const calls = all((n) => isCall(n, "logCountryDefaultEvent")) as ts.CallExpression[];
    expect(calls).toHaveLength(1);
    expect(squash(calls[0].arguments[0].getText())).toBe('{ userId: user.id, eventType: "feed_view", countryState, tab }');
    const guards = ancestors(calls[0]).filter((a) => ts.isIfStatement(a) || ts.isConditionalExpression(a) || ts.isBinaryExpression(a));
    expect(guards.map((g) => g.getText().slice(0, 40))).toEqual([]);
  });
});

describe("placement: the insert is not on the response path", () => {
  const call = () => (all((n) => isCall(n, "logCountryDefaultEvent")) as ts.CallExpression[])[0];

  it("the call sits inside the after() callback", () => {
    const inAfter = ancestors(call()).some((a) => ts.isCallExpression(a) && a.expression.getText() === "after");
    expect(inAfter).toBe(true);
  });

  it("no awaited Promise.all of the response path contains it", () => {
    const awaitedAll = ancestors(call()).filter(
      (a) => ts.isAwaitExpression(a) && ts.isCallExpression(a.expression) && a.expression.expression.getText() === "Promise.all",
    );
    // The one awaited Promise.all allowed to hold it is the one INSIDE after()'s own callback.
    const afterCallback = ancestors(call()).find((a) => ts.isCallExpression(a) && a.expression.getText() === "after");
    for (const a of awaitedAll) expect(afterCallback && a.pos > afterCallback.pos, "an awaited Promise.all outside after()").toBe(true);
  });

  it("the response-path Promise.all that reads auto_apply_settings no longer lists it", () => {
    const awaited = all((n) => ts.isAwaitExpression(n) && n.getText().includes("auto_apply_settings")) as ts.AwaitExpression[];
    expect(awaited).toHaveLength(1);
    expect(awaited[0].getText()).not.toContain("logCountryDefaultEvent");
  });
});
