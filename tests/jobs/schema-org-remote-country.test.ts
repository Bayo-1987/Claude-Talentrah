/**
 * S12 (g) — Workable's JSON-LD states the country a remote role may be worked from (`applicantLocationRequirements`);
 * `formatLocation` threw it away and stored a bare "Remote", which no JobPosting markup can be built from.
 *
 * The real captured payload (tests/jobs/fixtures/workable-job-posting.json: TELECOMMUTE, no address,
 * applicantLocationRequirements = Country "Nigeria") is the primary case. Rules pinned here:
 *   - a stated Country is kept: "Remote, Nigeria" (the shape parseJobLocation and the Greenhouse rows already use);
 *   - several stated -> "Remote, A; Remote, B";
 *   - nothing stated -> still the bare "Remote", never "Worldwide" or a guess;
 *   - the row's identity (dedup_fingerprint) does NOT move when a location is enriched: a fingerprint change is an
 *     identity change (see dedup.ts), which would close ~50 live rows and re-open them under new ids.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { computeDedupFingerprint } from "@/lib/jobs/dedup";
import { fetchSchemaOrgJobs } from "@/lib/jobs/sources/schema-org";

const REAL: Record<string, unknown> = (() => {
  const raw = JSON.parse(readFileSync(join(__dirname, "fixtures/workable-job-posting.json"), "utf-8"));
  delete raw._fixture_note;
  return raw;
})();

const html = (b: unknown) => `<!doctype html><html><head><script type="application/ld+json">${JSON.stringify(b)}</script></head></html>`;
const LIST = "https://jobs.workable.com/search/south-africa";
const JOB = "https://jobs.workable.com/view/x/remote-role-at-co";
const list = `<script type="application/ld+json">${JSON.stringify({ "@type": "ItemList", itemListElement: [{ "@type": "ListItem", position: 0, url: JOB }] })}</script>`;

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

async function ingest(block: Record<string, unknown>) {
  fetchMock.mockImplementation(async (url: string) => {
    if (url === LIST) return { ok: true, status: 200, text: async () => `<html><head>${list}</head></html>` };
    if (url === JOB) return { ok: true, status: 200, text: async () => html({ ...block, url: JOB }) };
    throw new Error(`unexpected fetch ${url}`);
  });
  const { jobs } = await fetchSchemaOrgJobs(LIST, "workable-south-africa");
  return jobs[0]!;
}

const remote = (extra: Record<string, unknown>) => ({
  "@type": "JobPosting",
  title: "Client Project Manager",
  description: "Run client projects.",
  datePosted: "2026-10-01T11:37:52.297Z",
  hiringOrganization: { "@type": "Organization", name: "Optimal Group" },
  jobLocationType: "TELECOMMUTE",
  ...extra,
});

describe("formatLocation keeps the country a remote posting states", () => {
  it("the real captured Workable payload -> 'Remote, Nigeria', still remote", async () => {
    const j = await ingest(REAL);
    expect(j.location).toBe("Remote, Nigeria");
    expect(j.workType).toBe("remote");
  });

  it("an array of Countries -> one 'Remote, X' entry each, in the source's order", async () => {
    const j = await ingest(
      remote({ applicantLocationRequirements: [{ "@type": "Country", name: "South Africa" }, { "@type": "Country", name: "Kenya" }] }),
    );
    expect(j.location).toBe("Remote, South Africa; Remote, Kenya");
  });

  it("the same country stated twice is kept once", async () => {
    const j = await ingest(
      remote({ applicantLocationRequirements: [{ "@type": "Country", name: "Kenya" }, { "@type": "Country", name: "Kenya" }] }),
    );
    expect(j.location).toBe("Remote, Kenya");
  });

  it("nothing stated -> the bare 'Remote': never Worldwide, never a guessed country", async () => {
    expect((await ingest(remote({}))).location).toBe("Remote");
    expect((await ingest(remote({ applicantLocationRequirements: { "@type": "Country" } }))).location).toBe("Remote");
    expect((await ingest(remote({ applicantLocationRequirements: [] }))).location).toBe("Remote");
  });

  it("only a Country is read: an AdministrativeArea (a state or region) is not claimed to be a country", async () => {
    const j = await ingest(remote({ applicantLocationRequirements: { "@type": "AdministrativeArea", name: "Gauteng" } }));
    expect(j.location).toBe("Remote");
  });

  it("a hybrid posting (a physical address) keeps its physical location string, unchanged", async () => {
    const j = await ingest(
      remote({
        jobLocation: { "@type": "Place", address: { "@type": "PostalAddress", addressLocality: "Cape Town", addressRegion: "Western Cape", addressCountry: "South Africa" } },
        applicantLocationRequirements: { "@type": "Country", name: "South Africa" },
      }),
    );
    expect(j.workType).toBe("hybrid");
    expect(j.location).toBe("Cape Town, Western Cape, South Africa");
  });
});

describe("the row's identity does not move when a location is enriched", () => {
  it("a remote posting's fingerprint is the one a bare 'Remote' produces, with or without the stated country", async () => {
    const withCountry = await ingest(remote({ applicantLocationRequirements: { "@type": "Country", name: "South Africa" } }));
    const without = await ingest(remote({}));
    const bare = computeDedupFingerprint("Optimal Group", "Client Project Manager", "Remote");
    expect(without.dedupFingerprint).toBe(bare);
    expect(withCountry.dedupFingerprint).toBe(bare);
    expect(withCountry.location).toBe("Remote, South Africa");
  });

  it("the real payload keeps the fingerprint it had before enrichment", async () => {
    const j = await ingest(REAL);
    expect(j.dedupFingerprint).toBe(computeDedupFingerprint("Reliance Health", "Associate Product Manager", "Remote"));
  });
});
