/**
 * A job page id that is not a UUID is a 404 with ZERO database calls, and the "more from this company" read fails soft.
 *
 * Production, 20 Nov 17:01-17:02Z: four loads of /jobs/446ead8d-88e5-420a-a828-7cfe04c21243&quot made 16 database calls (8 reads of job_postings, 8 superseded_job_target
 * lookups), every one refused by Postgres with 22P02 "invalid input syntax for type uuid" and answered 400. The page showed a 404 either way; the cost was the wasted calls and the log noise.
 *
 * The real supabase-js client builds the requests; only the network is fake and counts them. The cookie client and React's request cache are replaced
 * (cache() only exists in the server build of React).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const requests: string[] = [];
let clientFails: Error | null = null;
let answer: (url: URL) => Response = () => new Response("[]", { status: 200, headers: { "content-type": "application/json" } });

vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(f: T) => f }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    if (clientFails) throw clientFails;
    return createClient("http://gateway.test", "anon-key", {
      auth: { persistSession: false },
      global: { fetch: (async (input: RequestInfo | URL) => {
        const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
        requests.push(`${url.pathname}${url.search}`);
        return answer(url);
      }) as typeof fetch },
    });
  },
}));

import { isJobId } from "@/lib/jobs/job-id";
import { jobForRequest, siblingPostingsFor, supersededTargetFor } from "@/app/(app)/jobs/[id]/job-for-request";

const GOOD = "446ead8d-88e5-420a-a828-7cfe04c21243";
const BAD = [`${GOOD}&quot`, `${GOOD}%26quot`, `${GOOD}%2526quot`, `${GOOD}"`, `${GOOD}\n`, " " + GOOD, "", "abc", "undefined", "446ead8d88e5420aa8287cfe04c21243", `{${GOOD}}`, GOOD.slice(0, 35), `${GOOD}0`, "../jobs", "00000000-0000-0000-0000-00000000000g"];

beforeEach(() => { clientFails = null; requests.length = 0; answer = () => new Response("[]", { status: 200, headers: { "content-type": "application/json" } }); });
afterEach(() => vi.restoreAllMocks());

describe("isJobId", () => {
  it.each([GOOD, GOOD.toUpperCase(), "11111111-1111-4111-8111-111111111111", "00000000-0000-0000-0000-000000000000", "ffffffff-ffff-ffff-ffff-ffffffffffff"])("accepts %s", (id) => expect(isJobId(id)).toBe(true));
  it.each(BAD)("rejects %j", (id) => expect(isJobId(id)).toBe(false));
});

describe("a bad id makes no database call", () => {
  it.each(BAD)("jobForRequest(%j): no request, no row", async (id) => {
    const { data } = await jobForRequest(id);
    expect(data).toBeNull();
    expect(requests).toEqual([]);
  });
  it.each(BAD)("supersededTargetFor(%j): no request, no target", async (id) => {
    await expect(supersededTargetFor(id)).resolves.toBeNull();
    expect(requests).toEqual([]);
  });
});

describe("a valid id behaves exactly as before", () => {
  it("an unknown valid id: one read, no row (the page's notFound), and one lookup, no target", async () => {
    const { data } = await jobForRequest(GOOD);
    expect(data).toBeNull();
    expect(requests).toHaveLength(1);
    expect(requests[0]).toContain(`id=eq.${GOOD}`);
    answer = () => new Response("null", { status: 200, headers: { "content-type": "application/json" } });
    await expect(supersededTargetFor(GOOD)).resolves.toBeNull();
    expect(requests).toHaveLength(2);
  });
  it("an upper-case valid id still reaches the database", async () => {
    await jobForRequest(GOOD.toUpperCase());
    expect(requests).toHaveLength(1);
  });
  it("a superseded id still returns its replacement's id (the redirect is unchanged)", async () => {
    const target = "22222222-2222-4222-8222-222222222222";
    answer = () => new Response(JSON.stringify(target), { status: 200, headers: { "content-type": "application/json" } });
    await expect(supersededTargetFor(GOOD)).resolves.toBe(target);
    expect(requests[0]).toContain("/rest/v1/rpc/superseded_job_target");
  });
});

describe("siblingPostingsFor fails soft", () => {
  const SIBLINGS = [{ title: "Support Lead", company_name: "Acme", location: "Lagos", work_type: null }];
  it("POSITIVE CONTROL: returns the rows, one request, no log", async () => {
    answer = () => new Response(JSON.stringify(SIBLINGS), { status: 200, headers: { "content-type": "application/json" } });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(siblingPostingsFor(GOOD, "Acme")).resolves.toEqual(SIBLINGS);
    expect(requests).toHaveLength(1);
    expect(log).not.toHaveBeenCalled();
  });
  it("a statement-timeout answer gives [] and ONE log line (it used to be silent: nine such timeouts left no trace)", async () => {
    answer = () => new Response(JSON.stringify({ code: "57014", details: null, hint: null, message: "canceling statement due to statement timeout" }), { status: 500, headers: { "content-type": "application/json" } });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(siblingPostingsFor(GOOD, "Acme")).resolves.toEqual([]);
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0][0])).toBe("[jobs] could not read the company's other postings: canceling statement due to statement timeout");
  });
  it("a plain-text 400 gives [] and one log line", async () => {
    answer = () => new Response("Bad Request", { status: 400, statusText: "Bad Request", headers: { "content-type": "text/plain" } });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(siblingPostingsFor(GOOD, "Acme")).resolves.toEqual([]);
    expect(log).toHaveBeenCalledTimes(1);
  });
  it("a network failure (fetch throws; supabase-js turns it into an error answer) gives [] and one log line", async () => {
    answer = () => { throw new TypeError("fetch failed"); };
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(siblingPostingsFor(GOOD, "Acme")).resolves.toEqual([]);
    expect(log).toHaveBeenCalledTimes(1);
  });
  it("a REJECTED call (the client factory itself throws, e.g. the cookie store) gives [] and one log line, not a thrown error", async () => {
    clientFails = new Error("cookies() was called outside a request scope");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(siblingPostingsFor(GOOD, "Acme")).resolves.toEqual([]);
    expect(requests).toEqual([]);
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0][0])).toBe("[jobs] could not read the company's other postings: cookies() was called outside a request scope");
  });
});

describe("the three entry points reach the guard before any query (source, in order)", () => {
  const read = (f: string) => readFileSync(f, "utf8");
  const body = (src: string, from: string, to: string | null) => src.slice(src.indexOf(from), to ? src.indexOf(to) : undefined);
  const page = read("src/app/(app)/jobs/[id]/page.tsx");

  it("generateMetadata: isJobId, then notFound, before jobForRequest", () => {
    const meta = body(page, "export async function generateMetadata", "export default async function JobDetailPage");
    expect(meta).toMatch(/isJobId\(id\)/);
    expect(meta.indexOf("isJobId(")).toBeLessThan(meta.indexOf("jobForRequest("));
    expect(meta.slice(meta.indexOf("isJobId("), meta.indexOf("jobForRequest("))).toContain("notFound()");
  });
  it("the page body: isJobId and notFound before jobForRequest, supersededTargetFor, the session read and the country log", () => {
    const main = body(page, "export default async function JobDetailPage", null);
    const guard = main.indexOf("isJobId(");
    expect(guard).toBeGreaterThan(-1);
    for (const later of ["getOptionalUser(", "jobForRequest(", "supersededTargetFor("]) expect(guard, later).toBeLessThan(main.indexOf(later));
    expect(main.slice(guard, main.indexOf("getOptionalUser("))).toContain("notFound()");
  });
  it("the share image: isJobId, then notFound, before jobForRequest", () => {
    const img = read("src/app/(app)/jobs/[id]/opengraph-image.tsx");
    expect(img.indexOf("isJobId(")).toBeGreaterThan(-1);
    expect(img.indexOf("isJobId(")).toBeLessThan(img.indexOf("jobForRequest(id)"));
    expect(img.slice(img.indexOf("isJobId("), img.indexOf("jobForRequest(id)"))).toContain("notFound()");
  });
});
