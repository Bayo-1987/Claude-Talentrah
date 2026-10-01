/**
 * S12 (b) — ingestion and supersession, through the real `ingestAllSources()` against the live test database.
 *
 * What this proves that tests/jobs/supersession.test.ts (the SQL) cannot: that the hook runs only while the
 * `job_supersession` flag is on, that a source listing the same role twice lands BOTH rows and then hides one, and that a
 * later ingest run which upserts the superseded row again does not bring it back.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { ingestAllSources } from "@/lib/jobs/ingest";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
  if (!process.env[key]) throw new Error(`supersession ingest test cannot run: ${key} is not set.`);
}
const admin: SupabaseClient<Database> = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { RUN_ID, COMPANY, LISTING_URL, URL_A, URL_B } = vi.hoisted(() => {
  const runId = Math.random().toString(36).slice(2, 10);
  return {
    RUN_ID: runId,
    COMPANY: `Supersession Ingest Co ${runId}`,
    LISTING_URL: `https://jobs.workable.test/${runId}/search/south-africa`,
    URL_A: `https://jobs.workable.test/${runId}/view/a-in-johannesburg`,
    URL_B: `https://jobs.workable.test/${runId}/view/b-in-johannesburg-south`,
  };
});
/* The flag is mocked, not flipped in the database: this file runs beside others against one DB, and a real flag row set
 * to true would apply supersession to whatever they have inserted in the meantime. Only the key under test is ever on. */
const flag = vi.hoisted(() => ({ on: false }));
vi.mock("@/lib/flags/read", () => ({
  isFeatureEnabled: async (key: string) => key === "job_supersession" && flag.on,
}));
vi.mock("@/lib/jobs/sources.config", () => ({
  JOB_SOURCES: [{ source: "schema-org", url: LISTING_URL, label: `test-${RUN_ID}` }],
}));

const DESCRIPTION = "Own the client relationship and run refurbishment and maintenance projects from brief to handover, reporting weekly. ".repeat(2);
const posting = (datePosted: string) => ({
  "@type": "JobPosting",
  title: "Client Project Manager",
  description: DESCRIPTION,
  datePosted,
  hiringOrganization: { "@type": "Organization", name: COMPANY },
  jobLocationType: "TELECOMMUTE",
  applicantLocationRequirements: { "@type": "Country", name: "South Africa" },
});

const realFetch = globalThis.fetch;
function mockListing() {
  const posts: Record<string, unknown> = {
    [URL_A]: posting(new Date(Date.now() - 7_200_000).toISOString()),
    [URL_B]: posting(new Date(Date.now() - 3_600_000).toISOString()),
  };
  const html = (b: unknown) => `<!doctype html><html><head><script type="application/ld+json">${JSON.stringify(b)}</script></head></html>`;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: unknown) => {
      const url = typeof input === "string" ? input : String((input as { url?: string })?.url ?? input);
      if (url === LISTING_URL) {
        const list = { "@type": "ItemList", itemListElement: [URL_A, URL_B].map((u, i) => ({ "@type": "ListItem", position: i, url: u })) };
        return { ok: true, status: 200, text: async () => html(list) };
      }
      if (posts[url]) return { ok: true, status: 200, text: async () => html({ ...(posts[url] as object), url }) };
      if (url.startsWith(`https://jobs.workable.test/${RUN_ID}/`)) throw new Error(`unexpected fetch ${url}`);
      return realFetch(input as Parameters<typeof fetch>[0], init as Parameters<typeof fetch>[1]);
    }),
  );
}

const rows = async () =>
  (await admin.from("job_postings").select("id, external_url, status, superseded_by, superseded_at, location, dedup_fingerprint").eq("company_name", COMPANY)).data ?? [];

afterAll(async () => {
  await admin.from("job_postings").delete().eq("company_name", COMPANY);
  vi.unstubAllGlobals();
});

describe("ingest + supersession", () => {
  it("with the flag OFF (as migrated), both rows land and nothing is hidden", async () => {
    flag.on = false;
    mockListing();
    await ingestAllSources();
    const r = await rows();
    expect(r).toHaveLength(2);
    expect(r.every((x) => x.superseded_at === null && x.status === "open")).toBe(true);
  });

  it("with the flag ON, the next run hides the older of the two and keeps the fresher; nothing is deleted", async () => {
    flag.on = true;
    mockListing();
    await ingestAllSources();
    const r = await rows();
    expect(r).toHaveLength(2);
    const hidden = r.filter((x) => x.superseded_at !== null);
    expect(hidden).toHaveLength(1);
    expect(hidden[0]!.external_url).toBe(URL_A); // posted two hours ago, the other one hour ago
    expect(r.find((x) => x.external_url === URL_B)!.superseded_at).toBeNull();
    expect(hidden[0]!.superseded_by).toBe(r.find((x) => x.external_url === URL_B)!.id);
    expect(hidden[0]!.status).toBe("open");
  });

  it("a later run that upserts the superseded row again does not bring it back", async () => {
    mockListing();
    await ingestAllSources();
    await ingestAllSources();
    const hidden = (await rows()).filter((x) => x.superseded_at !== null);
    expect(hidden).toHaveLength(1);
    expect(hidden[0]!.external_url).toBe(URL_A);
  });
});
