/**
 * PR-E4 gate 2: GET /jobs/{id}/go, the redirect behind "Apply on company site". It takes the job id only (never an address), reads the row with the service role, serves ONLY rows whose apply_link_kind is
 * set, RE-RUNS the validator against the company as it is NOW (a company that was later unverified, or whose domain changed, no longer passes), and answers 302 to the stored address. If anything fails
 * it sends the seeker back to the job page with a plain message, never a bare 404. It counts the click after the response, best-effort, with no user id. HEAD and prefetch requests are ignored.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const h = vi.hoisted(() => ({
  job: null as null | Record<string, unknown>,
  org: null as null | Record<string, unknown>,
  reads: [] as string[],
  clicks: [] as unknown[],
  clickFails: false,
  afterCallbacks: [] as Array<() => Promise<void> | void>,
}));

function chain(table: string): Record<string, unknown> {
  const result = () => {
    h.reads.push(table);
    return { data: table === "job_postings" ? h.job : table === "organizations" ? h.org : null, error: null };
  };
  const c: Record<string, unknown> = new Proxy({}, {
    get: (_t, p) => {
      if (p === "then") return (res: (v: unknown) => unknown) => res(result());
      if (p === "maybeSingle" || p === "single") return async () => result();
      return () => c;
    },
  });
  return c;
}

vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), after: (fn: () => Promise<void> | void) => void h.afterCallbacks.push(fn) }));
vi.mock("@/lib/supabase/service-role", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/service-role")>()),
  createServiceRoleClient: () => ({
    from: (table: string) => chain(table),
    rpc: async (name: string, args: unknown) => {
      h.clicks.push({ name, args });
      if (h.clickFails) throw new Error("click counter down");
      return { data: null, error: null };
    },
  }),
}));

import { GET, HEAD } from "../../src/app/(app)/jobs/[id]/go/route";

const ID = "11111111-1111-4111-8111-111111111111";
const STORED = "https://careers.acme.example/jobs/42";
const call = (init: RequestInit = {}, id = ID, method = "GET") =>
  GET(new Request(`https://talentrah.test/jobs/${id}/go`, { method, ...init }), { params: Promise.resolve({ id }) });
const jobRow = (over: Record<string, unknown> = {}) => ({ id: ID, organization_id: "org-1", status: "open", source_type: "internal", import_feed_id: null, apply_link: STORED, apply_link_kind: "company", removed_at: null, superseded_at: null, ...over });
const orgRow = (over: Record<string, unknown> = {}) => ({ domain: "acme.example", verified: true, name: "Acme", ...over });
const JOB_PAGE = `/jobs/${ID}?applyLink=recheck-failed`;

beforeEach(() => {
  h.job = jobRow();
  h.org = orgRow();
  h.reads = [];
  h.clicks = [];
  h.clickFails = false;
  h.afterCallbacks = [];
});

describe("a valid link", () => {
  it("answers 302 to the stored address with no-store and noindex headers, and counts the click after the response with the job id only", async () => {
    const res = await call();
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(STORED);
    expect(res.headers.get("cache-control")).toMatch(/no-store/);
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(h.clicks).toEqual([]); // nothing was counted before the response left
    for (const cb of h.afterCallbacks) await cb();
    expect(h.clicks).toEqual([{ name: "record_apply_link_click", args: { p_job_id: ID } }]);
  });
  it("an ATS link passes too, whatever the company's own domain", async () => {
    h.job = jobRow({ apply_link: "https://boards.greenhouse.io/acme", apply_link_kind: "ats" });
    h.org = orgRow({ verified: false });
    expect((await call()).status).toBe(302);
  });
  it("a failing click counter never blocks or delays the redirect", async () => {
    h.clickFails = true;
    const res = await call();
    expect(res.status).toBe(302);
    await expect(Promise.all(h.afterCallbacks.map((cb) => cb()))).resolves.toBeDefined();
  });
});

describe("the re-check at click time", () => {
  it.each([
    ["the company was unverified later", { org: orgRow({ verified: false }) }],
    ["the company's domain changed", { org: orgRow({ domain: "elsewhere.example" }) }],
    ["the company has no domain", { org: orgRow({ domain: null }) }],
    ["the stored address is no longer acceptable (http)", { job: jobRow({ apply_link: "http://careers.acme.example/jobs/42" }) }],
    ["the stored address now points to a shortener", { job: jobRow({ apply_link: "https://bit.ly/x" }) }],
    ["an ATS address lost its company page path", { job: jobRow({ apply_link: "https://boards.greenhouse.io/", apply_link_kind: "ats" }) }],
  ])("%s: the seeker lands on the job page with a plain message, nothing is counted, and the address is not in the answer", async (_name, change) => {
    if ("org" in change) h.org = change.org;
    if ("job" in change) h.job = change.job;
    const res = await call();
    expect([302, 303]).toContain(res.status);
    expect(res.headers.get("location")).toBe(JOB_PAGE);
    expect(res.headers.get("location")).not.toContain("acme.example/jobs");
    expect(res.headers.get("cache-control")).toMatch(/no-store/);
    for (const cb of h.afterCallbacks) await cb();
    expect(h.clicks).toEqual([]);
  });
});

describe("only rows with a kind are served", () => {
  it("an imported or ordinary row (no apply_link_kind) is never redirected, even if it has an external address", async () => {
    h.job = jobRow({ apply_link: null, apply_link_kind: null, source_type: "external", organization_id: null, external_url: "https://careers.acme.example/jobs/1" });
    const res = await call();
    expect(res.headers.get("location")).toBe(JOB_PAGE);
    expect(res.headers.get("location")).not.toContain("careers.acme.example");
  });
  it.each([
    ["a closed job", { status: "closed" }],
    ["a draft", { status: "draft" }],
    ["a removed job", { status: "removed", removed_at: "2026-11-01T00:00:00Z" }],
    ["a superseded job (the job page forwards to its successor)", { superseded_at: "2026-11-01T00:00:00Z" }],
    ["an imported job, whatever else is on the row (A2)", { import_feed_id: "feed-1" }],
    ["a job from the aggregator", { source_type: "external" }],
  ])("%s lands on the job page", async (_n, over) => {
    h.job = jobRow(over);
    expect((await call()).headers.get("location")).toBe(JOB_PAGE);
  });
  it("a job that does not exist, or an id that is not an id, never ends in a bare 404", async () => {
    h.job = null;
    expect((await call()).headers.get("location")).toBe(JOB_PAGE);
    const bad = await call({}, "not-a-uuid");
    expect([302, 303]).toContain(bad.status);
    expect(bad.headers.get("location")).toBe("/jobs");
  });
});

describe("HEAD and prefetch are ignored", () => {
  it("HEAD answers without a redirect, a read or a count", async () => {
    // Next calls a handler with (request, context); the handler ignores both.
    const res = await (HEAD as (...args: unknown[]) => Promise<Response>)(new Request(`https://talentrah.test/jobs/${ID}/go`, { method: "HEAD" }), { params: Promise.resolve({ id: ID }) });
    expect(res.status).toBe(204);
    expect(res.headers.get("location")).toBeNull();
    expect(h.reads).toEqual([]);
    expect(h.afterCallbacks).toEqual([]);
  });
  it.each([
    [{ purpose: "prefetch" }],
    [{ "sec-purpose": "prefetch" }],
    [{ "next-router-prefetch": "1" }],
    [{ "x-moz": "prefetch" }],
  ])("a prefetching request (%j) gets 204, no redirect, no read and no count", async (headers) => {
    const res = await call({ headers });
    expect(res.status).toBe(204);
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("cache-control")).toMatch(/no-store/);
    expect(h.reads).toEqual([]);
    expect(h.afterCallbacks).toEqual([]);
  });
});

describe("what the route is not allowed to know (source)", () => {
  const src = readFileSync(path.join(process.cwd(), "src/app/(app)/jobs/[id]/go/route.ts"), "utf8");
  it("takes the job id only, reads no session and no cookie, stores no user id, and never logs the address", () => {
    expect(src).not.toMatch(/supabase\/server|getUser|cookies\(|auth\.uid|searchParams|nextUrl\.search|url\.searchParams/);
    expect(src).not.toMatch(/console\.(log|info|warn|error)\([^)]*(apply_link|url)/);
  });
  it("counts through after() and does not await the counter before answering", () => {
    expect(src).toContain("after(");
  });
});
