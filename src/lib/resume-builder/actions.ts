"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { EMPTY_RESUME, type StructuredResume } from "@/lib/resume/types";
import { rewriteBullet, type BulletInstruction } from "@/lib/farah/rewrite-bullet";
import { CREDIT_COSTS } from "@/lib/credits/costs";
import { spendCredits, InsufficientCreditsError } from "@/lib/credits/spend";
import { logCreditGateEvent } from "@/lib/credits/gate-events";
import { checkPassCoverage, DAILY_CAP_MESSAGE } from "@/lib/passes/entitlement";

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

export async function createResumeAction(templateId: string) {
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

  const { data: resume, error } = await supabase
    .from("resumes")
    .insert({
      user_id: userId,
      is_base: false,
      template_id: template.id,
      title: template.name,
      source: "builder",
      structured_content: JSON.parse(JSON.stringify(EMPTY_RESUME)),
    })
    .select("id")
    .single();

  if (error || !resume) throw error ?? new Error("Couldn't create resume.");

  redirect(`/resume-builder/edit?resumeId=${resume.id}`);
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
  revalidatePath("/resume-builder");
  revalidatePath(`/resume-builder/preview`);
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
