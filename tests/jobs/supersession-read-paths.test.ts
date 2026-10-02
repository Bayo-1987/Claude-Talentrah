/**
 * S12 (b) — every service-role reader of job_postings either excludes superseded rows or says why it need not.
 *
 * RLS hides a superseded row from every user-scoped client, but the service role BYPASSES RLS, so a reader on a public or
 * emailing path that uses it must exclude the row itself (CLAUDE.md, 0109: a definer/bypass reader does not inherit the
 * policy). This is the standing check, the same shape as tests/rls/column-privileges.test.ts: a NEW service-role reader
 * of job_postings fails here until it either filters `superseded_at` or is added to ALLOWED with its reason.
 *
 * Source-level on purpose: it needs no database, so it runs everywhere. The behavioural half (what the policy and the
 * definer functions actually hide) is tests/jobs/supersession.test.ts.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const MUST_FILTER = [
  "src/lib/auto-apply/queue.ts",
  "src/lib/digest/send.ts",
  "src/lib/jobs/enrich-thin.ts",
  "src/lib/matching/refresh-job.ts",
  "src/lib/notifications/proactive-match-alert/send.ts",
  "src/lib/notifications/win-back/send.ts",
];

/** Service-role readers that legitimately see superseded rows, each with the reason. */
const ALLOWED: Record<string, string> = {
  "src/lib/jobs/ingest.ts": "writes and sweeps the table; the hook that sets supersession lives here",
  "src/lib/jobs/expiry.ts": "closes by age whatever the visibility; a superseded row still expires",
  "src/lib/jobs/posting-deletion.ts": "deletes long-closed rows whatever the visibility",
  "src/lib/matching/compute-and-store.ts": "scores one job by id for one user; a superseded id is simply never requested by a visible surface",
  "src/lib/llm/cost-probe.ts": "an operator probe of the LLM path, not a public read",
  "src/lib/auto-apply/actions.ts": "the confirm path: auto_apply_claim_submission (0202) refuses a superseded job as job_closed",
  "src/lib/auto-apply-digest/send.ts": "summarises the user's own queue activity, which may name a job that was later superseded; it lists, it does not recommend",
  "src/lib/notifications/hired-moment/send.ts": "reads the user's own application; falls back to the snapshot when the embed is empty",
  "src/lib/employer/actions.ts": "the employer's own postings (internal; supersession is external-only)",
  "src/lib/employer/mint-unlisted-link.ts": "the employer's own postings",
  "src/lib/employer-verification-reminders/send.ts": "the employer's own postings",
  "src/lib/jobs/expiry-reminders/extend.ts": "reads one posting by the id on its own Extend link; internal only (supersession is external-only), and it refuses anything else",
  "src/app/api/employer/job-banner/route.ts": "the employer's own postings",
  "src/lib/admin/moderation/queues.ts": "admins must see every row, hidden or not",
  "src/lib/admin/moderation/search.ts": "admins must see every row, hidden or not",
  "src/lib/admin/moderation/actions.ts": "admins must see every row, hidden or not",
  "src/lib/admin/ops/queries.ts": "operator counts over the whole table",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const root = process.cwd();
const sources = walk(join(root, "src")).map((f) => ({ file: relative(root, f), text: readFileSync(f, "utf8") }));
const readsJobPostings = (t: string) => /from\("job_postings"\)|job_postings(!inner)?\(/.test(t);
const usesBypassClient = (t: string) => /createServiceRoleClient|createAdminClient/.test(t);

describe("service-role readers of job_postings and supersession", () => {
  it.each(MUST_FILTER)("%s excludes superseded rows", (file) => {
    const src = sources.find((s) => s.file === file);
    expect(src, `${file} not found`).toBeDefined();
    expect(src!.text).toMatch(/superseded_at/);
  });

  it("every other service-role reader is on the allowlist, with a reason", () => {
    const readers = sources.filter((s) => readsJobPostings(s.text) && usesBypassClient(s.text)).map((s) => s.file);
    const unaccounted = readers.filter((f) => !MUST_FILTER.includes(f) && !(f in ALLOWED));
    expect(unaccounted, "a new service-role reader of job_postings: filter superseded_at or add it to ALLOWED with a reason").toEqual([]);
  });

  it("no allowlist entry is stale", () => {
    for (const f of Object.keys(ALLOWED)) {
      const src = sources.find((s) => s.file === f);
      expect(src, `${f} no longer exists`).toBeDefined();
      expect(readsJobPostings(src!.text) && usesBypassClient(src!.text), `${f} no longer reads job_postings with a bypass client`).toBe(true);
    }
  });
});
