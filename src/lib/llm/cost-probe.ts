import "server-only";
import { getLLMProvider } from "@/lib/llm";
import type { LLMGenerateOptions, LLMResult, LLMUsage } from "@/lib/llm/types";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { tailorResumeToJob } from "@/lib/tailoring/tailor";
import { rewriteBullet } from "@/lib/farah/rewrite-bullet";
import { checkEligibility, draftPersonalStatement } from "@/lib/scholarships/farah";
import { EMPTY_RESUME, type StructuredResume } from "@/lib/resume/types";

/**
 * Measures what each credit-gated LLM action actually costs in tokens, by
 * running the REAL action functions against REAL seeded fixtures and reading
 * the provider's own usage metadata.
 *
 * Why it works this way:
 *  - It calls the production action functions (tailorResumeToJob,
 *    rewriteBullet, checkEligibility, draftPersonalStatement) rather than
 *    re-building their prompts here. A copy of the prompts would drift from
 *    the real ones and quietly stop measuring the thing being priced.
 *  - It captures usage by wrapping the provider's generateWithUsage for the
 *    duration of the probe. generateText delegates to that same method, so
 *    every call any action makes is counted — including retries, which are
 *    real spend the user never sees. The original method is always restored.
 *  - No second LLM client, no provider-specific code: everything still goes
 *    through the one LLMProvider the app already uses.
 *
 * This lives behind an authenticated admin route because the action modules
 * are "server-only" and won't import in a plain tsx process — the same
 * constraint scripts/seed.ts already works around by driving the ingestion
 * route over HTTP.
 */

export interface ProbeSample {
  action: string;
  /** Which input this sample used, so a range can be traced back to a cause. */
  fixture: string;
  /** LLM calls this action made — >1 means a retry fired. */
  calls: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number | null;
  error?: string;
}

export interface ProbeReport {
  provider: string;
  model: string;
  samples: ProbeSample[];
  fixtureNotes: string[];
}

/** Runs one action with usage capture, tolerating a failure without aborting the probe. */
async function measure(
  action: string,
  fixture: string,
  run: () => Promise<unknown>,
  sink: LLMUsage[],
): Promise<ProbeSample> {
  sink.length = 0;
  let error: string | undefined;
  try {
    await run();
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  const reasoning = sink.reduce<number | null>(
    (acc, u) => (u.reasoningTokens === null ? acc : (acc ?? 0) + u.reasoningTokens),
    null,
  );
  return {
    action,
    fixture,
    calls: sink.length,
    inputTokens: sink.reduce((a, u) => a + u.inputTokens, 0),
    outputTokens: sink.reduce((a, u) => a + u.outputTokens, 0),
    reasoningTokens: reasoning,
    ...(error ? { error } : {}),
  };
}

export type ProbeGroup = "tailoring" | "bullet" | "scholarship";
export const PROBE_GROUPS: ProbeGroup[] = ["tailoring", "bullet", "scholarship"];

/**
 * Runs one group at a time. Split by group because a single request running
 * every sample sequentially outran Node's fetch headers timeout (each LLM
 * call is seconds, and the longest JD fixture is ~21k chars) — the caller
 * loops instead, which also makes a single action re-runnable on its own.
 */
export async function runCostProbe(group: ProbeGroup): Promise<ProbeReport> {
  const supabase = createServiceRoleClient();
  const fixtureNotes: string[] = [];

  // --- Fixtures: reuse what the seed already created, don't invent any ---
  const { data: resumeRow } = await supabase
    .from("resumes")
    .select("structured_content, user_id")
    .eq("is_base", true)
    .limit(1)
    .maybeSingle();
  const baseResume = (resumeRow?.structured_content as StructuredResume | null) ?? EMPTY_RESUME;
  fixtureNotes.push(
    resumeRow ? "resume: seeded base resume" : "resume: EMPTY_RESUME fallback (no seeded resume found)",
  );

  // Input tokens scale with JD length, so sample across the real spread
  // rather than whichever posting happens to be newest: shortest, median and
  // longest of the seeded postings. A single short JD flatters the numbers
  // and hides the worst case.
  const { data: jobRows } = await supabase
    .from("job_postings")
    .select("title, company_name, description")
    .not("description", "is", null);
  const sortedJobs = (jobRows ?? [])
    .filter((j) => (j.description ?? "").length > 0)
    .sort((a, b) => (a.description ?? "").length - (b.description ?? "").length);
  const picked =
    sortedJobs.length >= 3
      ? [sortedJobs[0], sortedJobs[Math.floor(sortedJobs.length / 2)], sortedJobs[sortedJobs.length - 1]]
      : sortedJobs;
  const jdFixtures = picked.map((j, i) => ({
    label: ["shortest", "median", "longest"][i] ?? `jd-${i}`,
    text: `${j.title} at ${j.company_name}\n\n${j.description}`,
  }));
  if (jdFixtures.length === 0) {
    jdFixtures.push({
      label: "fallback",
      text: "Senior Backend Engineer — build and operate payment APIs at scale.",
    });
  }
  fixtureNotes.push(
    `jd: ${jdFixtures.length} seeded posting(s) — ${jdFixtures
      .map((f) => `${f.label} ${f.text.length}ch`)
      .join(", ")} (of ${sortedJobs.length} available)`,
  );

  // Service-role read, so moderation status is irrelevant here — this is a
  // cost probe, not a user-facing surface, and a pending listing costs
  // exactly the same to run an eligibility check against.
  const { data: scholarshipRows } = await supabase.from("scholarships").select("*").limit(3);
  const scholarships = scholarshipRows ?? [];
  fixtureNotes.push(
    scholarships.length
      ? `scholarship: ${scholarships.length} seeded (${scholarships
          .map((s2) => s2.provider.split(" ")[0])
          .join(", ")})`
      : "scholarship: NONE FOUND — scholarship actions skipped",
  );

  // Resume experience entries carry a prose `description`, not a bullet
  // array — take its first sentence as a representative bullet.
  const firstDescription = baseResume.experience?.[0]?.description ?? "";
  const bulletText =
    firstDescription.split(/(?<=[.!?])\s+/)[0]?.trim() ||
    "Worked on the payments team and helped improve the checkout flow.";
  fixtureNotes.push(`bullet: "${bulletText.slice(0, 60)}…"`);

  // --- Usage capture -----------------------------------------------------
  const provider = getLLMProvider();
  const sink: LLMUsage[] = [];
  const original = provider.generateWithUsage.bind(provider);
  (provider as { generateWithUsage: (o: LLMGenerateOptions) => Promise<LLMResult> }).generateWithUsage =
    async (options: LLMGenerateOptions) => {
      const result = await original(options);
      if (result.usage) sink.push(result.usage);
      return result;
    };

  const samples: ProbeSample[] = [];
  try {
    // Tailoring and cover letter are charged separately (5 + 3 credits) but
    // come from ONE call, so the honest attribution is: measure the run
    // without a cover letter, measure it with, and treat the difference as
    // the cover letter's marginal cost.
    if (group === "tailoring") {
      for (const jd of jdFixtures) {
        samples.push(
          await measure(
            "tailoring_run (no cover letter)",
            jd.label,
            () => tailorResumeToJob(baseResume, jd.text, false),
            sink,
          ),
        );
        samples.push(
          await measure(
            "tailoring_run + cover_letter_run (one call)",
            jd.label,
            () => tailorResumeToJob(baseResume, jd.text, true),
            sink,
          ),
        );
      }
    }

    if (group === "bullet") {
      for (const instruction of ["impact", "quantify", "concise"] as const) {
        samples.push(
          await measure("bullet_rewrite", instruction, () => rewriteBullet(bulletText, instruction), sink),
        );
      }
    }

    for (const sch of group === "scholarship" ? scholarships : []) {
      const label = sch.provider.split(" ")[0];
      samples.push(
        await measure(
          "scholarship_eligibility_check",
          label,
          () => checkEligibility(sch, baseResume, "Nigeria"),
          sink,
        ),
      );
      samples.push(
        await measure(
          "scholarship_sop_draft",
          label,
          () =>
            draftPersonalStatement(
              sch,
              baseResume,
              "I want to deepen my engineering work and bring it back to Lagos.",
            ),
          sink,
        ),
      );
    }
  } finally {
    (provider as { generateWithUsage: typeof original }).generateWithUsage = original;
  }

  return { provider: provider.name, model: provider.model, samples, fixtureNotes };
}
