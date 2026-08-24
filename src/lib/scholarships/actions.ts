"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { CREDIT_COSTS } from "@/lib/credits/costs";
import { spendCredits } from "@/lib/credits/spend";
import { EMPTY_RESUME, type StructuredResume } from "@/lib/resume/types";
import { checkEligibility, draftPersonalStatement, type EligibilityCheckResult } from "./farah";
import type { SaveStatus } from "./types";

async function getAuthedUserId() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, userId: user.id };
}

/**
 * Loads a scholarship through the *authenticated* client on purpose, so the
 * §6.15 moderation gate in RLS applies. A `pending` listing is invisible
 * here, which means none of the actions below can be pointed at an
 * unpublished listing even with a guessed id.
 */
async function loadVisibleScholarship(
  supabase: Awaited<ReturnType<typeof createClient>>,
  scholarshipId: string,
) {
  const { data } = await supabase
    .from("scholarships")
    .select("*")
    .eq("id", scholarshipId)
    .maybeSingle();
  return data;
}

/* ---------------------------------------------------------------------- *
 * Free + uncapped (§6.9): saving and tracking touch no LLM, so no credits.
 * ---------------------------------------------------------------------- */

export async function saveScholarshipAction(scholarshipId: string) {
  const { supabase, userId } = await getAuthedUserId();

  const scholarship = await loadVisibleScholarship(supabase, scholarshipId);
  if (!scholarship) throw new Error("Scholarship not found.");

  // Upsert rather than insert so re-saving an already-saved listing is a
  // no-op instead of tripping the (user_id, scholarship_id) unique index.
  const { error } = await supabase
    .from("scholarship_saves")
    .upsert(
      { user_id: userId, scholarship_id: scholarshipId, status: "saved" },
      { onConflict: "user_id,scholarship_id", ignoreDuplicates: true },
    );
  if (error) throw error;

  revalidatePath("/scholarships");
}

export async function unsaveScholarshipAction(scholarshipId: string) {
  const { supabase, userId } = await getAuthedUserId();
  await supabase
    .from("scholarship_saves")
    .delete()
    .eq("user_id", userId)
    .eq("scholarship_id", scholarshipId);
  revalidatePath("/scholarships");
}

export async function updateSaveStatusAction(saveId: string, formData: FormData) {
  const { supabase, userId } = await getAuthedUserId();
  const status = String(formData.get("status") ?? "saved") as SaveStatus;

  await supabase
    .from("scholarship_saves")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", saveId)
    .eq("user_id", userId);

  revalidatePath("/scholarships");
}

/* ---------------------------------------------------------------------- *
 * Credit-gated (§6.9 / §6.15). Both follow the same check-then-commit
 * order as src/lib/tailoring/gate.ts and M9's rewriteBulletAction: verify
 * affordability BEFORE the LLM call so an unaffordable request never costs
 * Talentrah an API call, and only spend AFTER it succeeds so a failed
 * generation never costs the user credits.
 * ---------------------------------------------------------------------- */

async function loadBaseResume(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<StructuredResume> {
  const { data } = await supabase
    .from("resumes")
    .select("structured_content")
    .eq("user_id", userId)
    .eq("is_base", true)
    .maybeSingle();
  return (data?.structured_content as StructuredResume | null) ?? EMPTY_RESUME;
}

async function getBalance(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<number> {
  const { data } = await supabase
    .from("profiles")
    .select("credits_balance")
    .eq("id", userId)
    .single();
  return data?.credits_balance ?? 0;
}

export interface EligibilityActionResult {
  result?: EligibilityCheckResult;
  error?: string;
}

export async function runEligibilityCheckAction(
  scholarshipId: string,
): Promise<EligibilityActionResult> {
  const { supabase, userId } = await getAuthedUserId();
  const cost = CREDIT_COSTS.scholarshipEligibilityCheck;

  const scholarship = await loadVisibleScholarship(supabase, scholarshipId);
  if (!scholarship) return { error: "Scholarship not found." };

  const balance = await getBalance(supabase, userId);
  if (balance < cost) {
    return { error: `Not enough credits — this needs ${cost}, you have ${balance}.` };
  }

  const [resume, { data: profile }] = await Promise.all([
    loadBaseResume(supabase, userId),
    supabase.from("profiles").select("country").eq("id", userId).single(),
  ]);

  let result: EligibilityCheckResult;
  try {
    result = await checkEligibility(scholarship, resume, profile?.country ?? null);
  } catch {
    return { error: "Farah couldn't run that check just now — try again." };
  }

  await spendCredits(userId, cost, "scholarship_eligibility_check", scholarshipId);
  revalidatePath("/scholarships");
  return { result };
}

export interface SopActionResult {
  statement?: string;
  error?: string;
}

export async function draftSopAction(
  scholarshipId: string,
  motivation: string,
): Promise<SopActionResult> {
  const { supabase, userId } = await getAuthedUserId();
  const cost = CREDIT_COSTS.scholarshipSopDraft;

  const scholarship = await loadVisibleScholarship(supabase, scholarshipId);
  if (!scholarship) return { error: "Scholarship not found." };

  const balance = await getBalance(supabase, userId);
  if (balance < cost) {
    return { error: `Not enough credits — this needs ${cost}, you have ${balance}.` };
  }

  const resume = await loadBaseResume(supabase, userId);

  let statement: string;
  try {
    statement = await draftPersonalStatement(scholarship, resume, motivation);
  } catch {
    return { error: "Farah couldn't draft that just now — try again." };
  }
  if (!statement) {
    return { error: "Farah came back empty on that one — try again." };
  }

  await spendCredits(userId, cost, "scholarship_sop_draft", scholarshipId);
  revalidatePath("/scholarships");
  return { statement };
}

/* ---------------------------------------------------------------------- *
 * Deadline reminders (§6.10 / §6.15).
 * ---------------------------------------------------------------------- */

/**
 * §6.15 asks for deadline reminders "riding the same digest/WhatsApp
 * infrastructure already built for job matches". Checked against the repo
 * at build time: that infrastructure does not exist. There is no digest
 * scheduler anywhere, and WhatsApp appears only as static share/community
 * links (src/components/referrals/share-buttons.tsx, marketing-footer.tsx),
 * never as a delivery channel. Resend is wired to the Contact form and the
 * Pass-renewal reminder, nothing else.
 *
 * So rather than inventing a delivery pipeline as a side effect of this
 * milestone, this mirrors the Pass renewal job's honest minimum: the
 * guaranteed surface is in-app (the deadline section on /scholarships), and
 * email is best-effort via the existing client if configured. When a real
 * digest/WhatsApp pipeline is built, this is the call site to route through
 * it.
 */
export async function sendDeadlineReminderEmail(
  userId: string,
  subject: string,
  body: string,
): Promise<boolean> {
  const { getResendClient } = await import("@/lib/resend/client");
  const resend = getResendClient();
  if (!resend) return false;

  const supabase = createServiceRoleClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("email")
    .eq("id", userId)
    .single();
  if (!profile?.email) return false;

  await resend.emails.send({
    from: "Talentrah <scholarships@talentrah.com>",
    to: profile.email,
    subject,
    text: body,
  });
  return true;
}
