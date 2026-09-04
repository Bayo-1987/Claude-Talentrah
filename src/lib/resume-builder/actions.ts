"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { EMPTY_RESUME, type StructuredResume } from "@/lib/resume/types";
import { sanitizeStructuredResume } from "@/lib/resume/sanitize";
import { rewriteBullet, type BulletInstruction } from "@/lib/farah/rewrite-bullet";
import { CREDIT_COSTS } from "@/lib/credits/costs";
import { spendCredits, InsufficientCreditsError } from "@/lib/credits/spend";
import { logCreditGateEvent } from "@/lib/credits/gate-events";
import { checkPassCoverage, DAILY_CAP_MESSAGE } from "@/lib/passes/entitlement";
import { PREVIEW_SAMPLE_RESUME } from "@/lib/resume-builder/preview-sample";
import { logResumeBuilderStartEvent, logResumeBuilderCompletion, type ResumeBuilderStartState } from "@/lib/resume-builder/start-events";

export type { ResumeBuilderStartState } from "@/lib/resume-builder/start-events";

async function getAuthedUserId() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  return { supabase, userId: user.id };
}

/**
 * Spends credits and records the unlock via the service-role client, mirroring
 * credit_ledger's own write pattern (see src/lib/credits/spend.ts) — regular
 * users can only SELECT user_template_unlocks, never INSERT it directly,
 * so an unlock can only ever be the result of a real credit spend.
 */
export async function unlockTemplateAction(
  templateId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { supabase, userId } = await getAuthedUserId();

  const { data: existingUnlock } = await supabase
    .from("user_template_unlocks")
    .select("id")
    .eq("user_id", userId)
    .eq("template_id", templateId)
    .maybeSingle();
  if (existingUnlock) return { ok: true };

  const { data: template } = await supabase
    .from("resume_templates")
    .select("id, is_premium, unlock_cost_credits")
    .eq("id", templateId)
    .single();
  if (!template) return { ok: false, error: "Template not found." };
  if (!template.is_premium) return { ok: true };

  try {
    await spendCredits(userId, template.unlock_cost_credits, "template_unlock", templateId);
    // Logged after the spend rather than before it: unlike the other gates,
    // this one's affordability check lives inside spendCredits, so reaching
    // this line IS the "proceeded" signal. Non-LLM, but still a paywall the
    // funnel needs to see.
    await logCreditGateEvent({
      userId,
      reason: "template_unlock",
      creditsRequired: template.unlock_cost_credits,
      creditsAvailable: template.unlock_cost_credits,
      outcome: "proceeded",
      relatedEntityId: templateId,
    });
  } catch (err) {
    if (err instanceof InsufficientCreditsError) {
      await logCreditGateEvent({
        userId,
        reason: "template_unlock",
        creditsRequired: err.required,
        creditsAvailable: err.available,
        outcome: "blocked_insufficient_credits",
        relatedEntityId: templateId,
      });
      return {
        ok: false,
        error: `Not enough credits — this template needs ${err.required}, you have ${err.available}.`,
      };
    }
    throw err;
  }

  const serviceClient = createServiceRoleClient();
  const { error: insertError } = await serviceClient
    .from("user_template_unlocks")
    .insert({ user_id: userId, template_id: templateId });
  if (insertError) return { ok: false, error: "Couldn't save the unlock — try again." };

  revalidatePath("/resume-builder");
  return { ok: true };
}

/**
 * Creates a new builder resume (`is_base: false`) from one of three start
 * states — the "empty form vs. filled document" fix (Stage 3.1):
 *
 *   - "blank"         — today's behaviour, unchanged: EMPTY_RESUME.
 *   - "example"        — seeds PREVIEW_SAMPLE_RESUME (a complete, realistic
 *                        CV, since Stage 3.1 — see that file's own header).
 *   - "import_base"    — copies the user's EXISTING is_base=true resume's
 *                        structured_content, if they have one. "Use my
 *                        existing resume" in the "Import my CV" panel.
 *   - "import_upload"  — the parsed content of a freshly-uploaded file,
 *                        already produced by /api/resume-builder/import and
 *                        handed in by the caller as a hidden form field
 *                        ("content", a JSON string). This is the ONLY start
 *                        state that carries a payload, because it's the only
 *                        one whose content isn't already sitting in the
 *                        database under this user's id.
 *
 * WHY A FORM FIELD AND NOT A DIRECT JS ARGUMENT: this action is invoked as a
 * real `<form action=...>` submission for every start state, including this
 * one — the StartStateChooser client component renders a hidden input
 * carrying the parsed JSON once the upload finishes, rather than calling this
 * function programmatically. Server Actions that call redirect() (this one
 * does, at the end) are a well-trodden path when triggered by a form submit;
 * calling one directly from a client event handler and relying on the thrown
 * redirect propagating correctly is not something to depend on across Next
 * versions. Routing every start state through the same form-submission
 * mechanism means all four behave identically here, and none needed a special
 * case.
 *
 * CRITICAL, and the whole reason "import_upload" doesn't just call
 * upsertBaseResume itself: importing a CV to style it in the builder must
 * never silently repoint the user's canonical is_base=true resume — that
 * resume is what Auto-Apply submits on the user's behalf. So the parsed
 * content lands ONLY in the new builder row created here, never in the base
 * resume. `/api/resume-builder/import` calls parseResumeFile directly and
 * performs no database write at all; this action is the only place the
 * parsed content is ever persisted, and it always lands in a fresh
 * `is_base: false` row.
 *
 * The premium-template unlock check runs BEFORE branching on start state and
 * before any insert, same as before this feature existed — every start state
 * goes through it, none can bypass it.
 */
export async function createResumeAction(
  templateId: string,
  startState: ResumeBuilderStartState = "blank",
  formData?: FormData,
) {
  const { supabase, userId } = await getAuthedUserId();

  const { data: template } = await supabase
    .from("resume_templates")
    .select("id, is_premium, name")
    .eq("id", templateId)
    .single();

  if (!template) throw new Error("Template not found.");
  if (template.is_premium) {
    const { data: unlock } = await supabase
      .from("user_template_unlocks")
      .select("id")
      .eq("user_id", userId)
      .eq("template_id", templateId)
      .maybeSingle();
    if (!unlock) throw new Error("Unlock this template with credits before using it.");
  }

  let content: StructuredResume;
  switch (startState) {
    case "example":
      content = PREVIEW_SAMPLE_RESUME;
      break;
    case "import_base": {
      const { data: baseResume } = await supabase
        .from("resumes")
        .select("structured_content")
        .eq("user_id", userId)
        .eq("is_base", true)
        .maybeSingle();
      content = (baseResume?.structured_content as StructuredResume | null) ?? EMPTY_RESUME;
      break;
    }
    case "import_upload": {
      const raw = formData?.get("content");
      if (typeof raw !== "string") throw new Error("No imported resume content was provided.");
      let imported: StructuredResume;
      try {
        imported = JSON.parse(raw) as StructuredResume;
      } catch {
        throw new Error("Imported resume content was invalid.");
      }
      // Re-sanitized here, not trusted as-is: this value crossed a client
      // boundary (a hidden form field holding the JSON /api/resume-builder/
      // import returned), so a defensive re-clean costs nothing and means a
      // tampered payload still can't stash a degenerate value.
      content = sanitizeStructuredResume(imported);
      break;
    }
    case "blank":
    default:
      content = EMPTY_RESUME;
      break;
  }

  const { data: resume, error } = await supabase
    .from("resumes")
    .insert({
      user_id: userId,
      is_base: false,
      template_id: template.id,
      title: template.name,
      source: "builder",
      structured_content: JSON.parse(JSON.stringify(content)),
    })
    .select("id")
    .single();

  if (error || !resume) throw error ?? new Error("Couldn't create resume.");

  await logResumeBuilderStartEvent({
    userId,
    resumeId: resume.id,
    startState,
    eventType: "selected",
  });

  redirect(`/resume-builder/edit?resumeId=${resume.id}`);
}

/**
 * Best-effort completion signal for the start-state funnel — called after a
 * successful save or a successful export. See start-events.ts for exactly
 * what "completed" means and why it's logged at most once per resume.
 */
export async function recordResumeBuilderCompletionAction(resumeId: string): Promise<void> {
  const { supabase, userId } = await getAuthedUserId();
  // Ownership check before logging anything against this resume id — a user
  // should not be able to make another user's resume look "completed" by
  // guessing its id.
  const { data: owned } = await supabase
    .from("resumes")
    .select("id")
    .eq("id", resumeId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!owned) return;
  await logResumeBuilderCompletion({ userId, resumeId });
}

export async function saveResumeAction(
  resumeId: string,
  content: StructuredResume,
  title: string,
) {
  const { supabase, userId } = await getAuthedUserId();

  const { error } = await supabase
    .from("resumes")
    .update({
      title,
      structured_content: JSON.parse(JSON.stringify(content)),
      updated_at: new Date().toISOString(),
    })
    .eq("id", resumeId)
    .eq("user_id", userId);

  if (error) throw error;
  await logResumeBuilderCompletion({ userId, resumeId });
  revalidatePath("/resume-builder");
}

/**
 * Check-then-commit, same order as src/lib/tailoring/gate.ts: verify
 * affordability before the LLM call, only spend the credit after it
 * actually succeeds, so a failed rewrite never costs the user anything.
 */
export async function rewriteBulletAction(
  text: string,
  instruction: BulletInstruction,
): Promise<{ text: string; error?: string }> {
  if (!text.trim()) return { text };
  const { supabase, userId } = await getAuthedUserId();

  const { data: profile } = await supabase
    .from("profiles")
    .select("credits_balance")
    .eq("id", userId)
    .single();
  const balance = profile?.credits_balance ?? 0;

  const coverage = await checkPassCoverage(userId);
  if (coverage.covered) {
    let rewritten: string;
    try {
      rewritten = await rewriteBullet(text, instruction);
    } catch {
      return { text, error: "Farah couldn't rewrite that just now — try again." };
    }
    // Logged only now, after the rewrite actually succeeded — this event
    // counts against the Pass's daily fair-use cap, and logging it before
    // the LLM call above would burn a cap slot on a rewrite that never
    // happened the moment that call fails.
    await logCreditGateEvent({
      userId,
      reason: "bullet_rewrite",
      creditsRequired: 0,
      creditsAvailable: balance,
      outcome: "covered_by_pass",
    });
    return { text: rewritten };
  }

  if (balance < CREDIT_COSTS.bulletRewrite) {
    await logCreditGateEvent({
      userId,
      reason: "bullet_rewrite",
      creditsRequired: CREDIT_COSTS.bulletRewrite,
      creditsAvailable: balance,
      outcome: "blocked_insufficient_credits",
    });
    return {
      text,
      error:
        coverage.reason === "daily_cap_reached"
          ? DAILY_CAP_MESSAGE
          : `Not enough credits — this needs ${CREDIT_COSTS.bulletRewrite}, you have ${balance}.`,
    };
  }
  await logCreditGateEvent({
    userId,
    reason: "bullet_rewrite",
    creditsRequired: CREDIT_COSTS.bulletRewrite,
    creditsAvailable: balance,
    outcome: "proceeded",
  });

  let rewritten: string;
  try {
    rewritten = await rewriteBullet(text, instruction);
  } catch {
    return { text, error: "Farah couldn't rewrite that just now — try again." };
  }

  await spendCredits(userId, CREDIT_COSTS.bulletRewrite, "bullet_rewrite");
  return { text: rewritten };
}

export async function deleteResumeAction(resumeId: string) {
  const { supabase, userId } = await getAuthedUserId();
  await supabase.from("resumes").delete().eq("id", resumeId).eq("user_id", userId).eq("is_base", false);
  revalidatePath("/resume-builder");
}
