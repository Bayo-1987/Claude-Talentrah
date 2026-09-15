/**
 * An employer-posted job used to get NO structured skill set at all —
 * job-posting-form.tsx had no skills field, and postJobAction/updateJobAction
 * never wrote `job_postings.structured_jd`, so every internal posting's own
 * denominator was `[]`. `computeMatchScore` (src/lib/matching/score.ts) reads
 * an empty/missing `structured_jd.skills` as "nothing to compare against" and
 * returns a flat, neutral 50/100 for every candidate — Excellent-eligible
 * included, since Auto-Apply gates on the tier, not on how the score was
 * produced (docs/stage8-match-accuracy.md, docs/auto-apply.md). Checked
 * against real production data before this fix: 0 internal postings are
 * currently `open`, so this is a landmine defused ahead of employer-side
 * volume, not an active incident — no backfill is warranted for 3 historical
 * rows.
 *
 * This proves the actual mechanism end to end, through the real Server
 * Actions job-posting-form.tsx submits to — not readJobForm's parsing in
 * isolation — because the bug lived in the gap between "the form collects a
 * value" and "the write includes it", and only a real insert/update through
 * postJobAction/updateJobAction can catch that gap regressing.
 *
 * ── THE RECIPE ──────────────────────────────────────────────────────────
 *
 * Same direct-Server-Action pattern as tests/resume-builder/create-resume-
 * action.test.ts: createClient() is mocked to a REAL, RLS-honouring session
 * (tests/support/auth.ts's sessionFor()) rather than a bare stub, because
 * these actions read/write `job_postings` and `organization_members` through
 * that same client under RLS (the 0027 policy is what actually authorises the
 * insert). next/cache's revalidatePath is stubbed (it throws outside a real
 * Next request — "Invariant: static generation store missing"). redirect() is
 * left real: outside Next's request context it throws a plain Error with a
 * `NEXT_REDIRECT;<type>;<url>;<status>;` digest, parsed directly below to
 * recover the created job's id.
 *
 * ONE employer identity for the whole file, deliberately. `requireEmployer()`
 * -> `requireUser()` -> `getOptionalUser()` is wrapped in React's `cache()`,
 * which memoizes per real request — outside one (i.e. here) it degrades to an
 * unscoped, never-expiring module-level memo. A second distinct employer in
 * this file would silently keep resolving to the first one's cached identity.
 * The org-boundary case ("B cannot post to A's org") is already covered by
 * tests/employer/employer-flow.test.ts with two real, separately-verified
 * sessions; nothing here needs a second employer, so this file stays
 * single-user rather than fighting that cache with vi.resetModules() churn.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { admin, createTestUser, deleteTestUsers, sessionFor, type DB } from "../support/auth";
import { deleteTestOrgs } from "../support/cleanup";
import { computeMatchScore } from "@/lib/matching/score";
import { EMPTY_RESUME, type StructuredResume } from "@/lib/resume/types";
import { randomUUID } from "node:crypto";

const testClientRef = vi.hoisted(() => ({ current: null as DB | null }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => testClientRef.current,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { postJobAction, updateJobAction } = await import("@/lib/employer/actions");

function redirectDigest(err: unknown): string {
  const digest = (err as { digest?: string } | undefined)?.digest;
  if (!digest || !digest.startsWith("NEXT_REDIRECT")) {
    throw new Error(`expected a redirect, got: ${err instanceof Error ? err.stack : String(err)}`);
  }
  return digest;
}

/** postJobAction redirects to "/employer/jobs?posted=<id>" — the only place
 * the new row's id is observable from outside the action. */
function createdJobId(err: unknown): string {
  const url = redirectDigest(err).split(";")[2];
  const match = url.match(/posted=([^&;]+)/);
  if (!match) throw new Error(`redirect URL had no posted= id: ${url}`);
  return match[1];
}

async function structuredJdSkills(jobId: string): Promise<string[]> {
  const { data, error } = await admin
    .from("job_postings")
    .select("structured_jd")
    .eq("id", jobId)
    .single();
  if (error || !data) throw new Error(`fixture lookup: ${error?.message}`);
  const structuredJd = data.structured_jd as { skills?: string[] } | null;
  return structuredJd?.skills ?? [];
}

/** A real base form every test starts from and overrides via `extra` —
 * mirrors what job-posting-form.tsx actually submits, minus the fields a
 * given test cares about. */
function baseForm(overrides: { title: string; skills?: string[] }): FormData {
  const form = new FormData();
  form.set("title", overrides.title);
  form.set("location", "Lagos, Nigeria");
  form.set(
    "description",
    "A real job description, long enough to pass the form's own 40-character minimum length check.",
  );
  for (const skill of overrides.skills ?? []) form.append("skills", skill);
  return form;
}

let userId: string;
let userEmail: string;
let orgId: string;
const createdJobIds: string[] = [];

beforeAll(async () => {
  const user = await createTestUser("jobskills");
  userId = user.id;
  userEmail = user.email;
  testClientRef.current = await sessionFor(userEmail, userId);

  // Through the user's OWN client, same as createOrganizationAction and
  // employer-flow.test.ts's own fixture — the 0026/0027 policies are what
  // authorise this, not the service role.
  const orgName = `JOBSKILLS-TEST-${randomUUID()}`;
  const { data: org, error: orgError } = await testClientRef.current
    .from("organizations")
    .insert({ name: orgName, domain: "jobskills-test.example", created_by: userId })
    .select("id")
    .single();
  if (orgError || !org) throw new Error(`fixture org: ${orgError?.message}`);
  orgId = org.id;

  const { error: memberError } = await testClientRef.current
    .from("organization_members")
    .insert({ organization_id: orgId, user_id: userId, role: "owner" });
  if (memberError) throw new Error(`fixture membership: ${memberError.message}`);
}, 60_000);

afterAll(async () => {
  if (createdJobIds.length) {
    await admin.from("job_postings").delete().in("id", createdJobIds);
  }
  if (orgId) {
    await admin.from("organization_members").delete().eq("organization_id", orgId);
    await deleteTestOrgs([orgId]);
  }
  if (userId) await deleteTestUsers([userId]);
}, 60_000);

describe("postJobAction writes structured_jd.skills from the form's selected tags", () => {
  it("a real posting with selected skills gets a non-empty, screenable structured_jd.skills", async () => {
    const form = baseForm({
      title: `Backend Engineer ${randomUUID()}`,
      skills: ["javascript", "react", "sql"],
    });

    let jobId = "";
    try {
      await postJobAction(null, form);
      throw new Error("expected a redirect");
    } catch (err) {
      jobId = createdJobId(err);
    }
    createdJobIds.push(jobId);

    const skills = await structuredJdSkills(jobId);
    expect(skills.sort()).toEqual(["javascript", "react", "sql"].sort());
  });

  it("THE ACTUAL FIX: computeMatchScore no longer returns the flat neutral 50 for a posting created this way", async () => {
    const form = baseForm({
      title: `Frontend Engineer ${randomUUID()}`,
      skills: ["javascript", "react", "typescript"],
    });

    let jobId = "";
    try {
      await postJobAction(null, form);
      throw new Error("expected a redirect");
    } catch (err) {
      jobId = createdJobId(err);
    }
    createdJobIds.push(jobId);

    const jobSkills = await structuredJdSkills(jobId);
    expect(jobSkills.length).toBeGreaterThan(0);

    // A resume that genuinely matches two of the three, and is missing one —
    // real partial coverage, not a trivial 100%/0%.
    const resume: StructuredResume = {
      ...EMPTY_RESUME,
      contact: { name: "Ada Candidate", email: "ada@talentrah.test" },
      skills: ["javascript", "react", "css"],
    };

    const result = computeMatchScore(resume, jobSkills, undefined);

    // Before this fix, jobSkills was always [] and this would be exactly 50
    // with an empty matchedSkills/missingSkills — the "nothing to compare
    // against" branch in score.ts. A real denominator produces a real
    // coverage ratio instead: 2 of 3 matched -> round(2/3 * 100) = 67.
    expect(jobSkills.length).toBe(3);
    expect(result.score).not.toBe(50);
    expect(result.score).toBe(67);
    expect(result.explanation.matchedSkills.sort()).toEqual(["javascript", "react"]);
    expect(result.explanation.missingSkills).toEqual(["typescript"]);
  });

  it("a hand-crafted request cannot smuggle a non-canonical tag into structured_jd.skills", async () => {
    const form = baseForm({
      title: `Data Analyst ${randomUUID()}`,
      // "sql" is real vocabulary; the other two are not — SkillsAutocomplete
      // can never produce them client-side, so this simulates a request that
      // didn't go through the real form.
      skills: ["sql", "made-up-nonsense-skill", "rockstar energy"],
    });

    let jobId = "";
    try {
      await postJobAction(null, form);
      throw new Error("expected a redirect");
    } catch (err) {
      jobId = createdJobId(err);
    }
    createdJobIds.push(jobId);

    expect(await structuredJdSkills(jobId)).toEqual(["sql"]);
  });
});

describe("publishing without any selected skill is a hard block, not a warning", () => {
  /*
   * The decision made for this fix: block, don't just nudge. Pre-population
   * from the description (SkillsAutocomplete's own mount/blur seed) should
   * make an empty submission rare in practice, but "rare" is not a guarantee
   * — an employer can still clear every tag by hand. A soft warning relies on
   * that pre-population doing all the work AND on nobody dismissing it; a
   * hard block is the one path that actually keeps a skill-less internal
   * posting out of the feed, the same shape as the description-length check
   * it sits next to.
   */
  it("postJobAction refuses to create a posting with zero selected skills", async () => {
    const form = baseForm({ title: `No Skills Role ${randomUUID()}` });

    const result = await postJobAction(null, form);
    expect(result).toEqual({
      error: "Add at least one skill so seekers can be matched against this posting.",
    });

    // Nothing was created — the dedup fingerprint this title would have used
    // has no matching row.
    const { data } = await admin
      .from("job_postings")
      .select("id")
      .eq("organization_id", orgId)
      .ilike("title", "No Skills Role%");
    expect(data ?? []).toHaveLength(0);
  });

  it("updateJobAction applies the same hard block on an edit that clears every skill", async () => {
    const form = baseForm({
      title: `Ops Coordinator ${randomUUID()}`,
      skills: ["procurement"],
    });
    let jobId = "";
    try {
      await postJobAction(null, form);
      throw new Error("expected a redirect");
    } catch (err) {
      jobId = createdJobId(err);
    }
    createdJobIds.push(jobId);
    expect(await structuredJdSkills(jobId)).toEqual(["procurement"]);

    const clearForm = baseForm({ title: `Ops Coordinator ${randomUUID()}` }); // no skills
    const result = await updateJobAction(jobId, null, clearForm);
    expect(result).toEqual({
      error: "Add at least one skill so seekers can be matched against this posting.",
    });

    // Refused, not partially applied — the original skill set is untouched.
    expect(await structuredJdSkills(jobId)).toEqual(["procurement"]);
  });
});

describe("updateJobAction overwrites structured_jd.skills with the edited selection", () => {
  it("editing a posting's skills replaces the stored set, unconditionally like salary (not a 'keep current' field like expiry)", async () => {
    const form = baseForm({
      title: `Supply Chain Lead ${randomUUID()}`,
      skills: ["logistics", "procurement"],
    });
    let jobId = "";
    try {
      await postJobAction(null, form);
      throw new Error("expected a redirect");
    } catch (err) {
      jobId = createdJobId(err);
    }
    createdJobIds.push(jobId);
    expect((await structuredJdSkills(jobId)).sort()).toEqual(["logistics", "procurement"]);

    const editForm = baseForm({
      title: `Supply Chain Lead ${randomUUID()}`,
      skills: ["fleet management"],
    });
    try {
      await updateJobAction(jobId, null, editForm);
      throw new Error("expected a redirect");
    } catch (err) {
      redirectDigest(err); // just proves it succeeded rather than erroring
    }

    expect(await structuredJdSkills(jobId)).toEqual(["fleet management"]);
  });
});
