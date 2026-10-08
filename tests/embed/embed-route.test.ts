/**
 * GET /embed/jobs/<organisation id> (src/app/embed/jobs/[orgId]/route.ts), with the database call faked at its one seam (src/lib/embed/widget-data.ts).
 *
 * Pins what the owner listed for the route: a malformed id is a 404 before any database call; an unknown, disabled, unverified or QA-owned organisation (the function returns null)
 * gets the same neutral 200 page as any other nothing-to-show case; a real payload renders; the response carries no cookie and is HTML; a database failure is NOT turned into a
 * cached neutral page (it throws, so the platform serves the last good copy or an uncached error, never "no jobs" for half an hour); and the route is cached per organisation for
 * 30 minutes (`revalidate = 1800`) with no parameters prebuilt (an organisation's page is built on its first request).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchWidgetPayload = vi.hoisted(() => vi.fn());
vi.mock("@/lib/embed/widget-data", () => ({ fetchWidgetPayload }));

import * as route from "@/app/embed/jobs/[orgId]/route";

const ORG = "6f1c1d52-1111-4222-8333-444455556666";
const JOB = "9a1c1d52-1111-4222-8333-444455556666";
const ctx = (orgId: string) => ({ params: Promise.resolve({ orgId }) });
const get = (orgId: string) => route.GET(new Request(`https://www.talentrah.com/embed/jobs/${orgId}`), ctx(orgId));

const flagBefore = process.env.EMBED_WIDGET_ENABLED;
beforeEach(() => {
  fetchWidgetPayload.mockReset();
  process.env.EMBED_WIDGET_ENABLED = "1";
});
afterEach(() => {
  if (flagBefore === undefined) delete process.env.EMBED_WIDGET_ENABLED;
  else process.env.EMBED_WIDGET_ENABLED = flagBefore;
});

describe("the embed route", () => {
  it("is cached per organisation for 30 minutes and prebuilds nothing", async () => {
    expect(route.revalidate).toBe(1800);
    expect(await route.generateStaticParams()).toEqual([]);
  });

  it("answers a malformed id with a 404 and never touches the database", async () => {
    for (const bad of ["x", "123", "not-a-uuid", "6f1c1d52-1111-4222-8333-44445555666", "6f1c1d52-1111-4222-8333-444455556666-x", "../admin"]) {
      const res = await get(bad);
      expect(res.status, bad).toBe(404);
      expect(await res.text()).toContain("No open jobs right now");
    }
    expect(fetchWidgetPayload).not.toHaveBeenCalled();
  });

  it("renders the payload for a verified organisation with the widget on", async () => {
    fetchWidgetPayload.mockResolvedValue({ org: { name: "Acme Ltd", logo_url: null }, jobs: [{ id: JOB, title: "Engineer", location: "Lagos", work_type: "remote", employment_type: "full_time", posted_at: "2026-10-02T09:30:00.000Z" }] });
    const res = await get(ORG);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/html/);
    const html = await res.text();
    expect(html).toContain("Acme Ltd");
    expect(html).toContain(`/jobs/${JOB}`);
    expect(fetchWidgetPayload).toHaveBeenCalledWith(ORG);
  });

  it("gives every nothing-to-show cause the identical 200 body", async () => {
    fetchWidgetPayload.mockResolvedValue(null);
    const a = await (await get(ORG)).text();
    const b = await (await get("00000000-0000-4000-8000-000000000000")).text();
    expect(a).toBe(b);
    expect((await get(ORG)).status).toBe(200);
  });

  it("sets no cookie, on a hit, a neutral page or a 404", async () => {
    fetchWidgetPayload.mockResolvedValue(null);
    for (const res of [await get(ORG), await get("nope")]) {
      expect(res.headers.get("set-cookie")).toBeNull();
    }
  });

  it("lets a database failure throw instead of caching 'no jobs'", async () => {
    fetchWidgetPayload.mockRejectedValue(new Error("db down"));
    await expect(get(ORG)).rejects.toThrow("db down");
  });
});

describe("the server-side switch (EMBED_WIDGET_ENABLED) is OFF", () => {
  beforeEach(() => {
    delete process.env.EMBED_WIDGET_ENABLED;
  });

  it("every organisation gets the identical neutral page, with no database call", async () => {
    fetchWidgetPayload.mockResolvedValue({ org: { name: "Acme Ltd", logo_url: null }, jobs: [{ id: JOB, title: "Engineer", location: null, work_type: null, employment_type: null, posted_at: null }] });
    const off1 = await get(ORG);
    const off2 = await get("00000000-0000-4000-8000-000000000000");
    expect(off1.status).toBe(200);
    expect(await off1.text()).toBe(await off2.text());
    expect(fetchWidgetPayload).not.toHaveBeenCalled();
  });

  it("is the same body a switched-on route gives an unknown organisation (the page reveals nothing about the switch)", async () => {
    const off = await (await get(ORG)).text();
    process.env.EMBED_WIDGET_ENABLED = "1";
    fetchWidgetPayload.mockResolvedValue(null);
    expect(await (await get(ORG)).text()).toBe(off);
  });

  it("a malformed id is still a 404, and there is still no cookie", async () => {
    const res = await get("nope");
    expect(res.status).toBe(404);
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});
