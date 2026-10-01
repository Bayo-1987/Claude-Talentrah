/**
 * send-484 — JobsPublicLanding: the signed-out visitor's entry point at `/jobs`, replacing a redirect
 * to /login. Same shape as ScholarshipsPublicLanding (send-480): a presentational component with NO
 * database access — the page fetches and passes everything down.
 *
 * What this pins, each from a decision in the approved plan:
 *  - the preview is at most JOB_PREVIEW_MAX rows and appears ONLY when the live total is at least
 *    LANDING_PAGE_MIN_ENTRIES — the same threshold every programmatic SEO page already obeys, so the
 *    landing never advertises a thin board;
 *  - it is hidden outright (not apologised for) when there is nothing to show, because the page logs a
 *    failed query and degrades rather than 500ing;
 *  - an aggregated listing says so, in the same words the signed-in card uses ("sourced externally");
 *  - no match score or tier anywhere: a score needs a resume, and a signed-out visitor has none
 *    (docs/match-confidence-invariant.md);
 *  - "free" is scoped where it is claimed, and the two numbers it quotes come from their owning
 *    constants (stub-swap test), never from a literal.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LANDING_PAGE_MIN_ENTRIES } from "@/lib/seo/landing-pages";
import { JOB_FRESHNESS_WINDOW_DAYS } from "@/lib/jobs/freshness";
import { loadModule } from "../support/load-module";

interface Job {
  id: string;
  title: string;
  company_name: string;
  location: string | null;
  work_type: "remote" | "hybrid" | "onsite" | null;
  source_type: "internal" | "external";
  posted_at: string;
}
interface Facet {
  href: string;
  label: string;
  count: number;
}
interface LandingModule {
  JobsPublicLanding: (props: { total: number; jobs: Job[]; facets: Facet[] }) => React.ReactElement;
  JOB_PREVIEW_MAX: number;
}

const load = () => loadModule<LandingModule>("@/components/jobs/public-landing");

const job = (n: number, over: Partial<Job> = {}): Job => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  title: `Fixture Role ${n}`,
  company_name: `Fixture Co ${n}`,
  location: "Lagos, Nigeria",
  work_type: "remote",
  source_type: "external",
  posted_at: new Date(Date.now() - n * 3_600_000).toISOString(),
  ...over,
});
const FACETS: Facet[] = [
  { href: "/jobs/remote", label: "Remote jobs", count: 41 },
  { href: "/jobs/in/lagos", label: "Jobs in Lagos", count: 17 },
];

async function render(props: Partial<{ total: number; jobs: Job[]; facets: Facet[] }> = {}) {
  const { JobsPublicLanding } = await load();
  return renderToStaticMarkup(
    <JobsPublicLanding total={props.total ?? 378} jobs={props.jobs ?? [job(1), job(2), job(3)]} facets={props.facets ?? FACETS} />,
  );
}

describe("the headline and the lede (send-484 review)", () => {
  it("h1 is exactly 'Open jobs, each labelled by where it came from.' — no score claim, no country", async () => {
    const html = await render();
    const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)![1];
    expect(h1).toBe("Open jobs, each labelled by where it came from.");
  });

  it("the lede's FIRST sentence carries the match-score promise", async () => {
    const html = await render();
    const lede = html.match(/<p class="max-w-\[640px\][^>]*>([\s\S]*?)<\/p>/)![1];
    const first = lede.split(/(?<=[.!?])\s/)[0];
    expect(first).toMatch(/match score once you add your resume/);
    expect(lede).not.toMatch(/nigeria/i);
  });
});

describe("structure", () => {
  it("has exactly one <h1>, a 'Jobs' eyebrow, and no 'Nigeria' in the headline (the audience is global)", async () => {
    const html = await render();
    expect(html.match(/<h1[\s>]/g)?.length).toBe(1);
    expect(html).toContain(">Jobs<");
    const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)![1];
    expect(h1).not.toMatch(/nigeria/i);
  });

  it("offers a real path to create an account and to log in, both returning to /jobs", async () => {
    const html = await render();
    expect(html).toContain('href="/signup?redirectTo=%2Fjobs"');
    expect(html).toContain('href="/login?redirectTo=%2Fjobs"');
    expect(html).toContain("Create a free account");
  });

  it("scopes 'free' where it is claimed, and never says 'sign up' (one term per concept)", async () => {
    const html = await render();
    expect(html).toContain("Reading every listing is free and needs no account.");
    // Visible text only: the hrefs legitimately contain "/signup".
    const text = html.replace(/<[^>]+>/g, " ");
    expect(text).not.toMatch(/\bsign(ing)? ?up\b/i);
    expect(text).not.toMatch(/\bsign(ing)? ?in\b/i);
  });

  it("names what needs an account, so the free claim is not read as covering it", async () => {
    const html = await render();
    expect(html).toMatch(/match score/i);
    expect(html).toMatch(/save/i);
    expect(html).toMatch(/apply/i);
  });
});

describe("the live preview", () => {
  it("links every row to its own public detail page, with the title as the link text", async () => {
    const jobs = [job(1), job(2), job(3)];
    const html = await render({ jobs });
    for (const j of jobs) {
      expect(html).toMatch(new RegExp(`<a [^>]*href="/jobs/${j.id}"[^>]*>${j.title}</a>`));
      expect(html).toContain(`href="/jobs/${j.id}"`);
      expect(html).toContain(j.title);
      expect(html).toContain(j.company_name);
    }
  });

  it("shows at most JOB_PREVIEW_MAX rows, in the order it was given", async () => {
    const { JOB_PREVIEW_MAX } = await load();
    expect(JOB_PREVIEW_MAX).toBe(6);
    const jobs = Array.from({ length: JOB_PREVIEW_MAX + 3 }, (_, i) => job(i + 1));
    const html = await render({ jobs });
    const shown = jobs.filter((j) => html.includes(`href="/jobs/${j.id}"`));
    expect(shown.map((j) => j.id)).toEqual(jobs.slice(0, JOB_PREVIEW_MAX).map((j) => j.id));
  });

  it("appears at exactly LANDING_PAGE_MIN_ENTRIES and is hidden one below it, even when rows were supplied", async () => {
    const jobs = [job(1), job(2)];
    const at = await render({ total: LANDING_PAGE_MIN_ENTRIES, jobs });
    expect(at, "preview must show at the threshold").toContain(`href="/jobs/${jobs[0].id}"`);
    const below = await render({ total: LANDING_PAGE_MIN_ENTRIES - 1, jobs });
    expect(below, "preview must be hidden below the threshold").not.toContain(`href="/jobs/${jobs[0].id}"`);
    expect(below).not.toContain("Fixture Role");
  });

  it("is hidden when there are no rows (a failed query degrades to 'nothing to show', never a 500 or an empty shell)", async () => {
    const html = await render({ total: 0, jobs: [], facets: [] });
    expect(html).not.toContain('href="/jobs/0');
    // The preview's own sentence ("A few of the N open listings from the last D days") is absent.
    expect(html).not.toMatch(/from the last \d+ days/);
    // The rest of the page is intact.
    expect(html.match(/<h1[\s>]/g)?.length).toBe(1);
    expect(html).toContain("Create a free account");
  });

  it("quotes the live total and the freshness window", async () => {
    const html = await render({ total: 378 });
    expect(html).toContain("378");
    expect(html).toContain(`${JOB_FRESHNESS_WINDOW_DAYS} days`);
  });

  describe("the preview heading says 'The N' when every listing is shown and 'A few of the N' when not", () => {
    const heading = (html: string) => html.match(/<h2[^>]*>(A few of the|The) [^<]*listings? from the last[^<]*<\/h2>/)?.[0].replace(/<[^>]+>/g, "") ?? "";

    it("total equals the rows shown (6 of 6): 'The 6 open listings from the last 30 days'", async () => {
      const jobs = Array.from({ length: 6 }, (_, i) => job(i + 1));
      expect(heading(await render({ total: 6, jobs }))).toBe(`The 6 open listings from the last ${JOB_FRESHNESS_WINDOW_DAYS} days`);
    });

    it("total larger than the rows shown (6 of 378): 'A few of the 378 ...'", async () => {
      const jobs = Array.from({ length: 6 }, (_, i) => job(i + 1));
      expect(heading(await render({ total: 378, jobs }))).toBe(`A few of the 378 open listings from the last ${JOB_FRESHNESS_WINDOW_DAYS} days`);
    });

    it("compares with the rows actually SHOWN, not the rows supplied: 8 supplied, 6 shown, total 8 is still 'A few of the 8'", async () => {
      const jobs = Array.from({ length: 8 }, (_, i) => job(i + 1));
      expect(heading(await render({ total: 8, jobs }))).toBe(`A few of the 8 open listings from the last ${JOB_FRESHNESS_WINDOW_DAYS} days`);
    });

    it("fewer than the cap, all of them shown (5 of 5): 'The 5 ...'", async () => {
      const jobs = Array.from({ length: 5 }, (_, i) => job(i + 1));
      expect(heading(await render({ total: 5, jobs }))).toBe(`The 5 open listings from the last ${JOB_FRESHNESS_WINDOW_DAYS} days`);
    });

    it("the singular: with the threshold stubbed to 1, one listing of one reads 'The 1 open listing' (not 'listings')", async () => {
      vi.resetModules();
      const pages = await vi.importActual<typeof import("@/lib/seo/landing-pages")>("@/lib/seo/landing-pages");
      vi.doMock("@/lib/seo/landing-pages", () => ({ ...pages, LANDING_PAGE_MIN_ENTRIES: 1 }));
      try {
        const { JobsPublicLanding } = await loadModule<LandingModule>("@/components/jobs/public-landing");
        const html = renderToStaticMarkup(<JobsPublicLanding total={1} jobs={[job(1)]} facets={[]} />);
        expect(heading(html)).toBe(`The 1 open listing from the last ${JOB_FRESHNESS_WINDOW_DAYS} days`);
      } finally {
        vi.doUnmock("@/lib/seo/landing-pages");
        vi.resetModules();
      }
    });
  });

  it("says where a listing came from, in the signed-in card's own words", async () => {
    const html = await render({
      jobs: [job(1, { source_type: "external", title: "Aggregated Role" }), job(2, { source_type: "internal", title: "Direct Role" })],
    });
    // One <li> per row: split on it so a row's assertions cannot see its neighbour's label.
    const row = (title: string) => html.split("<li").find((chunk) => chunk.includes(title)) ?? "";
    expect(row("Aggregated Role")).toContain("sourced externally");
    expect(row("Aggregated Role")).not.toContain("Posted on Talentrah");
    expect(row("Direct Role")).toContain("Posted on Talentrah");
    expect(row("Direct Role")).not.toContain("sourced externally");
  });

  it("the reported card — 'Customer Success Associate · Zaria Digital · Remote' — does not double 'Remote'", async () => {
    const html = await render({
      jobs: [job(1, { title: "Customer Success Associate", company_name: "Zaria Digital", location: "Remote", work_type: "remote" })],
    });
    expect(html).toContain("Zaria Digital · Remote<");
    expect(html).not.toContain("Remote · Remote");
    // Case-insensitive on the location, so a lower-case source value does not slip through either.
    const lower = await render({ jobs: [job(2, { company_name: "Zaria Digital", location: "remote", work_type: "remote" })] });
    expect(lower).not.toMatch(/remote · Remote/i);
  });

  it("does not repeat the work type when the location already says it (\"Remote · Remote\")", async () => {
    const html = await render({ jobs: [job(1, { location: "Remote", work_type: "remote", title: "Dup Role" })] });
    expect(html).toContain("Fixture Co 1 · Remote<");
    expect(html).not.toContain("Remote · Remote");
    // ...and still shows it when the location does not say it.
    const other = await render({ jobs: [job(2, { location: "Lagos, Nigeria", work_type: "hybrid" })] });
    expect(other).toContain("Fixture Co 2 · Lagos, Nigeria · Hybrid");
  });

  it("shows no match score, percentage or tier anywhere (a signed-out visitor has no resume to score)", async () => {
    const html = await render();
    expect(html).not.toMatch(/\d+\s?%/);
    expect(html).not.toMatch(/\b(Excellent|Good|Fair)\b/);
    expect(html).not.toMatch(/% match/i);
  });
});

describe("Browse by (facet counts)", () => {
  it("renders one linked row per qualifying category with its live count", async () => {
    const html = await render();
    for (const f of FACETS) {
      expect(html).toContain(`href="${f.href}"`);
      expect(html).toContain(f.label);
      expect(html).toContain(`${f.count} open`);
    }
  });

  it("omits the whole card when no category qualifies", async () => {
    const html = await render({ facets: [] });
    expect(html).not.toContain("Browse by");
  });
});

describe("numbers are never hardcoded", () => {
  afterEach(() => {
    vi.doUnmock("@/lib/seo/landing-pages");
    vi.doUnmock("@/lib/jobs/freshness");
    vi.resetModules();
  });

  it("the preview threshold, the category threshold and the freshness window all come from their owning modules", async () => {
    vi.resetModules();
    const pages = await vi.importActual<typeof import("@/lib/seo/landing-pages")>("@/lib/seo/landing-pages");
    const fresh = await vi.importActual<typeof import("@/lib/jobs/freshness")>("@/lib/jobs/freshness");
    vi.doMock("@/lib/seo/landing-pages", () => ({ ...pages, LANDING_PAGE_MIN_ENTRIES: 83 }));
    vi.doMock("@/lib/jobs/freshness", () => ({ ...fresh, JOB_FRESHNESS_WINDOW_DAYS: 11 }));

    const { JobsPublicLanding } = await loadModule<LandingModule>("@/components/jobs/public-landing");
    const jobs = [job(1)];
    const shown = renderToStaticMarkup(<JobsPublicLanding total={83} jobs={jobs} facets={FACETS} />);
    const hidden = renderToStaticMarkup(<JobsPublicLanding total={82} jobs={jobs} facets={FACETS} />);

    expect(shown).toContain(`href="/jobs/${jobs[0].id}"`);
    expect(hidden).not.toContain(`href="/jobs/${jobs[0].id}"`);
    expect(shown).toContain("11 days");
    expect(shown).toContain("at least 83 open listings");
    // ...and today's real values are gone, so nothing is echoing a literal.
    expect(shown).not.toContain(`${JOB_FRESHNESS_WINDOW_DAYS} days`);
    expect(shown).not.toContain(`at least ${LANDING_PAGE_MIN_ENTRIES} open`);
  });
});
