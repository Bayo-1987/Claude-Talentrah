/**
 * CI-only seed fixtures: a small, committed, deterministic stand-in for what `npm run seed` otherwise ingests from live public job boards.
 *
 * Read ONLY by scripts/seed.ts, and only when SEED_FIXTURES=1 (set in .github/workflows/ci.yml's seed steps) against a local ephemeral stack.
 * Nothing under src/ reads SEED_FIXTURES (tests/ci/seed-fixtures.test.ts greps for it), so production behaviour cannot depend on it.
 *
 * Nothing here is a real company, a real posting or a real URL: companies are invented, URLs sit on the reserved `.invalid` TLD, and every date is
 * computed from `now` at seed time (a committed absolute date would fall out of the 30-day freshness window, or out of an "open" scholarship window,
 * and silently remove the row from every landing page, count and sitemap).
 *
 * What the numbers are for (each is asserted by name in tests/ci/seed-fixtures.test.ts; the dependent e2e specs are listed there):
 *   - 8 jobs are both "Lagos, Nigeria" and remote: with the 2 internal Lagos rows and 2 internal remote rows that puts /jobs/in/lagos and /jobs/remote
 *     at 10 each, well over LANDING_PAGE_MIN_ENTRIES (5), so the programmatic landing pages and the sitemap include them.
 *   - 12 external jobs in all, all Nigeria-located or remote: enough cards on the default feed (country Nigeria) for the scroll tests.
 *   - every description is at least 400 characters and names several skills, so the card slice (280) is shorter than the description and a match
 *     percentage always renders.
 *   - posted_at is 2 to 20 days before `now`: inside the freshness window, and older than the internal demo jobs (which are posted "now").
 */
import type { Database } from "../src/lib/supabase/types";
import { computeDedupFingerprint } from "../src/lib/jobs/dedup";
import { extractStructuredJd } from "../src/lib/jobs/extract-jd";

type JobInsert = Database["public"]["Tables"]["job_postings"]["Insert"];
type WorkType = "remote" | "hybrid" | "onsite";
type Seniority = "entry" | "mid" | "senior" | "lead" | "executive";
type ExternalSource = "greenhouse" | "lever" | "workable";

export const DAY_MS = 86_400_000;

interface FixtureJob {
  company: string;
  title: string;
  location: string;
  workType: WorkType;
  seniority: Seniority;
  source: ExternalSource;
  ageDays: number;
  focus: string;
}

export const FIXTURE_JOBS: FixtureJob[] = [
  { company: "Ikoyi Works", title: "Platform Engineer", location: "Lagos, Nigeria", workType: "remote", seniority: "senior", source: "greenhouse", ageDays: 2, focus: "Node.js, TypeScript, PostgreSQL and AWS" },
  { company: "Lekki Payments Lab", title: "Frontend Engineer", location: "Lagos, Nigeria", workType: "remote", seniority: "mid", source: "greenhouse", ageDays: 3, focus: "React, TypeScript and CSS" },
  { company: "Yaba Data Studio", title: "Data Analyst", location: "Lagos, Nigeria", workType: "remote", seniority: "mid", source: "workable", ageDays: 4, focus: "SQL, Python, Excel and data analysis" },
  { company: "Surulere Logistics Tech", title: "Product Manager", location: "Lagos, Nigeria", workType: "remote", seniority: "senior", source: "lever", ageDays: 5, focus: "product management, agile and stakeholder communication" },
  { company: "Victoria Island Health", title: "Customer Support Lead", location: "Lagos, Nigeria", workType: "remote", seniority: "lead", source: "workable", ageDays: 6, focus: "customer support, Zendesk and team leadership" },
  { company: "Ajah Cloud Services", title: "DevOps Engineer", location: "Lagos, Nigeria", workType: "remote", seniority: "mid", source: "greenhouse", ageDays: 8, focus: "Docker, Kubernetes, AWS and CI/CD" },
  { company: "Ikeja Learning", title: "Content Marketing Manager", location: "Lagos, Nigeria", workType: "remote", seniority: "mid", source: "workable", ageDays: 10, focus: "SEO, content marketing and analytics" },
  { company: "Oshodi Fintech Group", title: "Test Automation Engineer", location: "Lagos, Nigeria", workType: "remote", seniority: "mid", source: "greenhouse", ageDays: 12, focus: "test automation, Playwright and JavaScript" },
  { company: "Wuse Energy Analytics", title: "Business Analyst", location: "Abuja, Nigeria", workType: "hybrid", seniority: "mid", source: "workable", ageDays: 7, focus: "SQL, Excel, requirements gathering and reporting" },
  { company: "Garki Agro Network", title: "Operations Coordinator", location: "Abuja, Nigeria", workType: "onsite", seniority: "entry", source: "workable", ageDays: 9, focus: "project management, Excel and procurement" },
  { company: "Maitama Impact Fund", title: "Programme Officer", location: "Abuja, Nigeria", workType: "hybrid", seniority: "senior", source: "lever", ageDays: 14, focus: "monitoring and evaluation, budgeting and reporting" },
  { company: "Port Harcourt Marine Tech", title: "Software Engineer", location: "Port Harcourt, Nigeria", workType: "hybrid", seniority: "mid", source: "greenhouse", ageDays: 20, focus: "Python, Django, PostgreSQL and REST APIs" },
];

/** A description of at least 400 characters that names the role's skills, deterministic per fixture. */
export function fixtureDescription(job: FixtureJob): string {
  return (
    `${job.company} is hiring a ${job.title} in ${job.location} (${job.workType}). ` +
    `You will work with ${job.focus} in a small team that ships every week, and you will own your work from the first idea to the day it is used. ` +
    `Responsibilities: plan and deliver features with the people who use them, review the work of teammates, write clear documentation, ` +
    `and talk to customers and partners about what is and is not working. ` +
    `Requirements: a track record with ${job.focus}; strong written and spoken communication; the habit of measuring what you ship; ` +
    `and day-to-day comfort with SQL, Excel and agile ways of working. ` +
    `This is a fixture posting used only to test the Talentrah job board in CI; it is not a real vacancy.`
  );
}

/** The job_postings rows for the fixture set, in the same column shape the ingestion route writes. Dates are relative to `now`. */
export function buildFixtureJobRows(now: Date): JobInsert[] {
  return FIXTURE_JOBS.map((job) => {
    const description = fixtureDescription(job);
    const slug = `${job.company}-${job.title}`.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    return {
      source_type: "external",
      organization_id: null,
      title: job.title,
      company_name: job.company,
      company_logo_url: null,
      location: job.location,
      work_type: job.workType,
      employment_type: "full_time",
      seniority: job.seniority,
      description,
      structured_jd: JSON.parse(JSON.stringify(extractStructuredJd(description))),
      external_url: `https://jobs.fixture.invalid/${slug}`,
      external_source: job.source,
      status: "open",
      posted_at: new Date(now.getTime() - job.ageDays * DAY_MS).toISOString(),
      last_checked_at: now.toISOString(),
      dedup_fingerprint: computeDedupFingerprint(job.company, job.title, job.location),
      expires_at: null,
      salary_min: null,
      salary_max: null,
      salary_currency: null,
      salary_unit: null,
    } satisfies JobInsert;
  });
}

const FAR_FUTURE_DAYS = 365;

/**
 * Catalog rows whose committed deadline was already past when this fixture set was written (checked 7 Oct 2026). They stay closed in fixture mode,
 * whatever day CI runs: which rows count as open must not depend on the calendar. Every other dated row is made relative.
 */
export const ALWAYS_CLOSED_PROGRAMS: ReadonlySet<string> = new Set([
  "Chevening Scholarships",
  "Knight-Hennessy Scholars",
  "Schwarzman Scholars",
]);

/**
 * The deadline a catalog scholarship gets in fixture mode. The committed catalog carries real dated deadlines that expire, which would remove rows
 * from the fully-funded and degree landing pages as the calendar moves: a still-dated row that is meant to be open (Gates Cambridge, Commonwealth, ...)
 * becomes `now` plus a year, so it is open for the life of the run whenever CI runs; an empty deadline stays empty (open); and the rows listed in
 * ALWAYS_CLOSED_PROGRAMS keep their past date, so they stay closed.
 */
export function relativeDeadline(current: string | null, now: Date, programName: string): string | null {
  if (!current) return null;
  if (ALWAYS_CLOSED_PROGRAMS.has(programName)) return current;
  return new Date(now.getTime() + FAR_FUTURE_DAYS * DAY_MS).toISOString().slice(0, 10);
}
