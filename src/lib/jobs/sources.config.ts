import type { JobSourceConfig } from "./types";

/**
 * Curated starter list, per build-prompt §6.12/§9 — a small focused set for
 * Phase 1, not broad crawling.
 *
 * Moniepoint's Greenhouse board is real, live, and Nigerian (~127 open roles
 * at time of writing) — verified against the live API while building this
 * pipeline and used as the actual seed source for external jobs.
 *
 * The Lever fetcher (src/lib/jobs/sources/lever.ts) is fully implemented and
 * was verified field-for-field against Lever's real public API shape via
 * direct curl against their "leverdemo" sandbox board — but that fetch is
 * unreliable from inside this dev environment's Next.js runtime specifically
 * (works fine via plain curl, fails via Next's server-side fetch — looks
 * environment-specific, not a bug in the mapping logic). Rather than ship a
 * flaky demo-only source with no real data behind it, it's left out of the
 * default list. Add a real African/Nigerian employer's Lever token here once
 * one is confirmed live.
 *
 * schema.org/JSON-LD source — Workable's public job search
 * (`jobs.workable.com/search/<country>`), per schema-org-job-ingestion-prompt.md.
 * Three other candidates were checked and disqualified first — recorded here
 * so the search isn't silently repeated:
 *   - hotnigerianjobs.com — robots.txt names ClaudeBot/GPTBot/CCBot and
 *     other AI crawlers explicitly, `ai-train=no, use=reference`.
 *   - jobberman.com — robots.txt disallows `/job/`, the individual-posting path.
 *   - myjobmag.com — not blocked by robots.txt, but a real listing page has
 *     no `<script type="application/ld+json">` JobPosting block at all.
 *   - fuzu.com — passed *both* the robots.txt check (no AI-crawler block) and
 *     the JobPosting JSON-LD check (verified live: real title/hiringOrganization/
 *     datePosted on `/nigeria/jobs/<slug>`) — disqualified anyway on a check
 *     the brief's checklist didn't name but that matters more: its Terms of
 *     Service (`fuzu.com/legal/terms`) explicitly prohibit "automated tools
 *     to scrape... platform data" and "redistributing, or aggregating
 *     [Candidate or Employer data] without authorisation". robots.txt governs
 *     bot *access*; it doesn't grant a license to republish. Don't reopen
 *     this source without a real authorisation conversation with Fuzu.
 * Workable qualifies on all three: `jobs.workable.com/robots.txt` carries
 * `Content-Signal: search=yes, ai-input=yes, ai-train=no` (explicit AI-input
 * permission, only model-*training* withheld — a materially different,
 * better signal than either the named-bot blocks above or Fuzu's silence),
 * no path disallow covering `/search/*` or `/view/*`, and `jobs.workable.com/terms`
 * has no scraping/redistribution prohibition anywhere in it (checked directly,
 * not assumed). Verified live on two real Nigeria-market postings (Reliance
 * Health's "Associate Product Manager", Green.Earth's "Finance Manager" via
 * the Kenya search) with real populated title/hiringOrganization/datePosted —
 * see tests/jobs/fixtures/workable-job-posting.json for the captured fixture.
 *
 * This is still a single-source pilot, not a green light to add every
 * schema.org-emitting board found this way — CLAUDE.md's open-decisions list
 * flags schema.org data redistribution as needing real legal review "before
 * this scales" (§10). One well-vetted source, reviewed the same way Moniepoint
 * was, is the Phase 1 bar; broader reliance on this mechanism is a founder
 * decision, not a build-agent one.
 */
export const JOB_SOURCES: JobSourceConfig[] = [
  { source: "greenhouse", token: "moniepoint", companyName: "Moniepoint" },
  {
    source: "schema-org",
    url: "https://jobs.workable.com/search/nigeria",
    label: "workable-nigeria",
  },
];
