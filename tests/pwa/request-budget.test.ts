/**
 * The request budget names the worker's two extra requests, per route, and gives headroom ONLY for those two and ONLY where they actually happen
 * (e2e/support/request-budget.ts, used by e2e/route-payload-budget.spec.ts).
 *
 * The first fix added +2 to every route's number, which also let two UNRELATED new requests through on a route and gave a route with no worker the same headroom.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { allowedRequests, requestProblems } from "../../e2e/support/request-budget";

const own = (n: number) => Array.from({ length: n }, (_, i) => `/_next/static/chunks/c${i}.js`);
const withWorker = { requests: 10, workerRequests: ["/sw.js", "/offline"] };
const without = { requests: 10 };

describe("a route where the worker registers", () => {
  it("allows its base budget plus exactly the two named requests, when they happen", () => {
    expect(allowedRequests(withWorker, [...own(10), "/sw.js", "/offline"])).toBe(12);
    expect(requestProblems(withWorker, [...own(10), "/sw.js", "/offline"])).toEqual([]);
  });

  it("fails on ONE unexpected request on top of the two named ones", () => {
    const problems = requestProblems(withWorker, [...own(11), "/sw.js", "/offline"]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/requests: 13 \(budget 12/);
  });

  it("gives no headroom for a named request that did not happen (a missing /sw.js is not a free slot)", () => {
    expect(allowedRequests(withWorker, [...own(10), "/offline"])).toBe(11);
    expect(requestProblems(withWorker, [...own(11), "/offline"])).toHaveLength(1);
  });

  it("counts a named request once even if it is fetched twice", () => {
    expect(allowedRequests(withWorker, [...own(10), "/sw.js", "/sw.js", "/offline"])).toBe(12);
  });
});

describe("a route without the worker keeps its old budget", () => {
  it("allows exactly its base number, even if /sw.js shows up", () => {
    expect(allowedRequests(without, own(10))).toBe(10);
    expect(requestProblems(without, own(10))).toEqual([]);
    expect(requestProblems(without, [...own(10), "/sw.js"])).toHaveLength(1);
  });
});

describe("the committed budget file", () => {
  const file = JSON.parse(readFileSync(path.resolve(__dirname, "../../e2e/support/payload-budgets.json"), "utf8")) as { routes: Record<string, { requests: number; workerRequests?: string[] }> };

  it("keeps every route's ORIGINAL request number (7 Oct 2026) and names the worker's two requests separately", () => {
    const original: Record<string, number> = { "/": 38, "/jobs": 42, "job-detail": 39, "/scholarships": 41, "/blog": 36, "/mentorship": 32 };
    for (const [route, n] of Object.entries(original)) {
      expect(file.routes[route].requests, route).toBe(n);
      expect(file.routes[route].workerRequests, route).toEqual(["/sw.js", "/offline"]);
    }
  });
});
