/**
 * The CI-only seed fixtures (scripts/seed-fixtures.ts, switched on by SEED_FIXTURES=1 in ci.yml's seed steps) replace the live job-board ingestion the
 * CI seed used to do, which put a different ~675 external postings into every CI database. Replacing live data with a small fixed set is only safe if
 * every e2e spec that quietly relied on the live data still finds what it needs. This file states each such spec's assumption by name and checks the
 * fixtures against it; if a fixture or a threshold drifts, it fails here first, in the unit job, not as a landing page that silently 404s in e2e.
 *
 * The thresholds have a margin of at least 2 on each side (LANDING_PAGE_MIN_ENTRIES is 5): remote, Lagos, fully-funded and msc at 7 or more, phd at 3 or fewer.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { computeDedupFingerprint } from "../../src/lib/jobs/dedup";
import { JOB_FRESHNESS_WINDOW_DAYS } from "../../src/lib/jobs/freshness";
import { LANDING_PAGE_MIN_ENTRIES } from "../../src/lib/seo/landing-pages";
import { isScholarshipOpen } from "../../src/lib/scholarships/close-instant";
import { SEED_SCHOLARSHIPS } from "../../src/lib/scholarships/sources.config";
import { describeDbTarget } from "../../scripts/db-target";
import { ALWAYS_CLOSED_PROGRAMS, DAY_MS, FIXTURE_JOBS, buildFixtureJobRows, fixtureDescription, relativeDeadline } from "../../scripts/seed-fixtures";

const ROOT = path.resolve(__dirname, "../..");
const NOW = new Date();
const rows = buildFixtureJobRows(NOW);
const MARGIN_MIN = LANDING_PAGE_MIN_ENTRIES + 2;
const asText = (v: unknown) => String(v ?? "");

/** The internal demo jobs and company that other specs look up by exact text (scripts/seed.ts INTERNAL_JOBS). */
const INTERNAL_TITLES = ["Senior Product Manager", "Customer Success Associate", "Backend Engineer", "QA Engineer"];

describe("fixture jobs: shape and safety", () => {
  it("are 12 external postings with valid sources, invented companies and reserved-TLD urls (nothing real, nothing reachable)", () => {
    expect(rows).toHaveLength(12);
    for (const r of rows) {
      expect(r.source_type).toBe("external");
      expect(["greenhouse", "lever", "workable"]).toContain(r.external_source);
      expect(r.status).toBe("open");
      expect(new URL(asText(r.external_url)).hostname.endsWith(".invalid")).toBe(true);
    }
  });

  it("have unique fingerprints that equal the real computeDedupFingerprint (so a later live ingest would upsert onto them, not duplicate)", () => {
    const fps = rows.map((r) => r.dedup_fingerprint);
    expect(new Set(fps).size).toBe(rows.length);
    for (const r of rows) expect(r.dedup_fingerprint).toBe(computeDedupFingerprint(asText(r.company_name), asText(r.title), asText(r.location)));
  });

  it("never collide with the internal demo jobs other specs find by title (golden-path, feed-chrome, public-job-page), and none is the demo company", () => {
    for (const r of rows) {
      for (const internal of INTERNAL_TITLES) expect(asText(r.title).toLowerCase(), `${r.title} contains ${internal}`).not.toContain(internal.toLowerCase());
      expect(asText(r.company_name)).not.toBe("Zaria Digital");
    }
  });
});

describe("e2e/seo-landing-pages-sitemap.spec.ts, og-tags.spec.ts: /jobs/remote and /jobs/in/lagos above the landing threshold, from the fixtures alone", () => {
  it(`remote >= ${MARGIN_MIN} (threshold ${LANDING_PAGE_MIN_ENTRIES} plus a margin of 2), without counting the internal demo jobs`, () => {
    expect(rows.filter((r) => r.work_type === "remote").length).toBeGreaterThanOrEqual(MARGIN_MIN);
  });
  it(`Lagos >= ${MARGIN_MIN}: the page counts location ILIKE %lagos%`, () => {
    expect(rows.filter((r) => asText(r.location).toLowerCase().includes("lagos")).length).toBeGreaterThanOrEqual(MARGIN_MIN);
  });
});

describe("e2e/feed-chrome.spec.ts: the default feed (country Nigeria) is tall enough to scroll, and has an external card", () => {
  it("at least 10 external jobs are Nigeria-located or remote (the Recommended tab is unpaginated)", () => {
    expect(rows.filter((r) => asText(r.location).toLowerCase().includes("nigeria") || r.work_type === "remote").length).toBeGreaterThanOrEqual(10);
  });
  it("fewer than 24 fixtures, so 'Customer Success Associate' stays on page 1 of the recent tab (24 per page); and every fixture is older than the internal jobs (posted 'now')", () => {
    expect(rows.length).toBeLessThan(24);
    for (const offset of [0, 400 * DAY_MS, 1200 * DAY_MS]) {
      const now = new Date(NOW.getTime() + offset);
      for (const r of buildFixtureJobRows(now)) expect(new Date(asText(r.posted_at)).getTime()).toBeLessThan(now.getTime());
    }
  });
});

describe("posted_at stays inside the 30-day freshness window whatever day CI runs (it is computed from now, never a committed date)", () => {
  it(`every fixture is 1 to ${JOB_FRESHNESS_WINDOW_DAYS - 5} days old, for a seed run today, next year and in three years`, () => {
    for (const offset of [0, 365 * DAY_MS, 3 * 365 * DAY_MS]) {
      const now = new Date(NOW.getTime() + offset);
      for (const r of buildFixtureJobRows(now)) {
        const ageDays = (now.getTime() - new Date(asText(r.posted_at)).getTime()) / DAY_MS;
        expect(ageDays).toBeGreaterThanOrEqual(1);
        expect(ageDays).toBeLessThanOrEqual(JOB_FRESHNESS_WINDOW_DAYS - 5);
      }
    }
  });
});

describe("e2e/job-detail.spec.ts: the first feed card may be any job; its description must outrun the card text and a match percentage must render", () => {
  it("every description is at least 400 characters (the card slices at 280) and is the generator's own text", () => {
    FIXTURE_JOBS.forEach((job, i) => {
      expect(asText(rows[i].description).length).toBeGreaterThanOrEqual(400);
      expect(rows[i].description).toBe(fixtureDescription(job));
    });
  });
  it("every structured_jd names at least 3 skills (an empty one would rank first with no percentage)", () => {
    for (const r of rows) expect((r.structured_jd as { skills: string[] }).skills.length).toBeGreaterThanOrEqual(3);
  });
});

describe("e2e/golden-path.spec.ts, apply-requires-resume.spec.ts: external fixtures never carry an Apply button of their own", () => {
  it("all are external (no organization), so the feed shows 'Apply on company site' and no bare Apply; the demo's single internal 'Senior Product Manager' stays unique", () => {
    for (const r of rows) expect(r.organization_id).toBeNull();
  });
});

describe("scholarships: seo-landing-pages-sitemap, scholarships-public-landing, og-tags, public-scholarship-page, referral-capture, scholarship-sitemap", () => {
  // The committed catalog is upserted offline by scripts/seed-catalog.ts; in fixture mode its future deadlines become relative (relativeDeadline).
  const catalog = SEED_SCHOLARSHIPS.map((s) => ({
    name: s.programName,
    verified: s.deadlineVerifiedAt !== null,
    levels: s.degreeLevels as string[],
    funding: s.fundingType as string,
    open: (now: Date) =>
      isScholarshipOpen({ application_deadline: relativeDeadline(s.applicationDeadline ?? null, now, s.programName), close_time: null, close_tz: null }, now),
  }));
  const openVerified = (now: Date) => catalog.filter((c) => c.verified && c.open(now));

  for (const [label, offset] of [["today", 0], ["in a year", 365 * DAY_MS], ["in three years", 3 * 365 * DAY_MS]] as const) {
    const now = new Date(NOW.getTime() + offset);
    it(`${label}: fully-funded >= ${MARGIN_MIN}, msc >= ${MARGIN_MIN}, phd <= 3 (the phd page must start below the threshold; at ${LANDING_PAGE_MIN_ENTRIES} the sitemap spec fails)`, () => {
      const open = openVerified(now);
      expect(open.filter((c) => c.funding === "full").length).toBeGreaterThanOrEqual(MARGIN_MIN);
      expect(open.filter((c) => c.levels.includes("msc")).length).toBeGreaterThanOrEqual(MARGIN_MIN);
      expect(open.filter((c) => c.levels.includes("phd")).length).toBeLessThanOrEqual(3);
    });
  }

  it("the named record 'Gates Cambridge Scholarship' exists, is verified and stays open (og-tags, public-scholarship-page, referral-capture, scholarship-sitemap use it)", () => {
    const gates = catalog.find((c) => c.name === "Gates Cambridge Scholarship");
    expect(gates?.verified).toBe(true);
    for (const offset of [0, 365 * DAY_MS, 3 * 365 * DAY_MS]) expect(gates?.open(new Date(NOW.getTime() + offset))).toBe(true);
  });

  it("the three rows already closed when the fixtures were written stay closed on any run date (and are the only ones: every other dated row is open)", () => {
    const closed = catalog.filter((c) => ALWAYS_CLOSED_PROGRAMS.has(c.name));
    expect(closed.map((c) => c.name).sort()).toEqual(["Chevening Scholarships", "Knight-Hennessy Scholars", "Schwarzman Scholars"]);
    for (const offset of [0, 365 * DAY_MS, 3 * 365 * DAY_MS]) {
      const now = new Date(NOW.getTime() + offset);
      for (const c of closed) expect(c.open(now), `${c.name} must stay closed`).toBe(false);
      for (const s of SEED_SCHOLARSHIPS.filter((x) => x.applicationDeadline && !ALWAYS_CLOSED_PROGRAMS.has(x.programName))) {
        expect(isScholarshipOpen({ application_deadline: relativeDeadline(s.applicationDeadline ?? null, now, s.programName), close_time: null, close_tz: null }, now)).toBe(true);
      }
    }
  });

  it("relativeDeadline: empty stays empty; a closed program keeps its date; any other dated row moves a year out", () => {
    const now = new Date("2026-10-07T12:00:00Z");
    expect(relativeDeadline(null, now, "Gates Cambridge Scholarship")).toBeNull();
    expect(relativeDeadline("2026-10-06", now, "Chevening Scholarships")).toBe("2026-10-06");
    expect(relativeDeadline("2026-12-08", now, "Gates Cambridge Scholarship")).toBe("2027-10-07");
    expect(relativeDeadline("2026-10-20", now, "Commonwealth Master's Scholarships")).toBe("2027-10-07");
  });
});

describe("the flag is CI-only: read nowhere in production code, set only on the seed steps, refused off a local stack", () => {
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(dir, e.name);
      return e.isDirectory() ? files(p) : /\.(tsx?|mjs|js|json)$/.test(e.name) ? [p] : [];
    });

  it("nothing under src/ mentions SEED_FIXTURES", () => {
    const hits = files(path.join(ROOT, "src")).filter((f) => readFileSync(f, "utf8").includes("SEED_FIXTURES"));
    expect(hits).toEqual([]);
  });

  it("in .github/workflows only ci.yml mentions it, and only as the env of a step whose command is `npm run seed`", () => {
    const dir = path.join(ROOT, ".github/workflows");
    const mentioning = readdirSync(dir).filter((f) => readFileSync(path.join(dir, f), "utf8").includes("SEED_FIXTURES"));
    expect(mentioning).toEqual(["ci.yml"]);
    const jobs = (parse(readFileSync(path.join(dir, "ci.yml"), "utf8")) as { jobs: Record<string, { steps?: { run?: string; env?: Record<string, string> }[] }> }).jobs;
    const withFlag = Object.values(jobs).flatMap((j) => (j.steps ?? []).filter((s) => s.env && "SEED_FIXTURES" in s.env));
    expect(withFlag.length).toBe(2);
    for (const step of withFlag) {
      expect(step.run).toBe("npm run seed");
      expect(step.env?.SEED_FIXTURES).toBe("1");
    }
  });

  it("scripts/seed.ts refuses SEED_FIXTURES=1 unless the target is a local stack, and describeDbTarget calls only loopback 'local'", () => {
    expect(readFileSync(path.join(ROOT, "scripts/seed.ts"), "utf8")).toMatch(/USE_FIXTURES && describeDbTarget\(url\)\.kind !== "local"/);
    expect(describeDbTarget("http://127.0.0.1:54321").kind).toBe("local");
    expect(describeDbTarget("https://nytwbbzfpytctjsoczzq.supabase.co").kind).not.toBe("local");
    expect(describeDbTarget("https://gtiksnbhnqmwpeckfqwk.supabase.co").kind).not.toBe("local");
    expect(describeDbTarget("https://example.supabase.co").kind).not.toBe("local");
  });

  it("the live ingestion calls are still there for every run without the flag (local development keeps the live seed)", () => {
    const seed = readFileSync(path.join(ROOT, "scripts/seed.ts"), "utf8");
    expect(seed).toContain("/api/admin/ingest-jobs");
    expect(seed).toContain("/api/admin/ingest-scholarships");
  });
});
