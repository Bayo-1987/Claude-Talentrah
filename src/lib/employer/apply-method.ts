import { normaliseApplyEmail } from "@/lib/jobs/apply-email";
import { postingApplyEmail } from "@/lib/jobs/posting-apply-email";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

/**
 * "How should people apply?" on the employer's job form (PR-E2b): the employer's choice between applications inside Talentrah (the default, and the only state of every existing job) and
 * applications by email. The database function set_job_apply_email (0275) is the ONLY writer of the address; this file reads the form, calls the function with the signed-in employer's own
 * client, and turns every refusal into a plain sentence. The database's own message never reaches the person (EMPLOYER-ACTIONS-RAW-DB-ERRORS-1): a refusal is mapped by its code, and the real
 * text goes to the server log with the job and the user.
 */

export type ApplyMethod = { kind: "talentrah" } | { kind: "email"; address: string };

/** The plain sentences. The first four are the function's own, word for word, so a screen and a direct call say the same thing. */
export const APPLY_METHOD_MESSAGES = {
  AE001: "This job already has applications on Talentrah, so it can't be switched to email. Close it and post a new job instead.",
  AE002: "This job's apply method was changed 5 times in the last 24 hours. Try again tomorrow.",
  AE003: "Enter one email address, such as careers@yourcompany.com.",
  AE004: "This job's apply method can't be changed.",
  "42501": "We couldn't find that job.",
  "28000": "Sign in again to change how people apply.",
} as const;

export const APPLY_EMAIL_CONFIRM_MESSAGE = "Tick the box to confirm this address is yours and may be shown publicly.";
export const APPLY_EMAIL_NO_SCREENING_MESSAGE = "Screening questions and an assessment are not used when applications arrive by email. Remove them, or choose to receive applications on Talentrah.";

/** Reads the form. Anything but an explicit "email" is the default, so a form that never sends the field behaves exactly as before. */
export function readApplyMethod(form: FormData): { ok: true; method: ApplyMethod } | { ok: false; error: string } {
  if (form.get("applyMethod") !== "email") return { ok: true, method: { kind: "talentrah" } };
  const raw = form.get("applyEmail");
  const address = normaliseApplyEmail(typeof raw === "string" ? raw : "");
  if (address === null) return { ok: false, error: APPLY_METHOD_MESSAGES.AE003 };
  if (form.get("applyEmailConfirm") !== "on") return { ok: false, error: APPLY_EMAIL_CONFIRM_MESSAGE };
  return { ok: true, method: { kind: "email", address } };
}

/** The sentence for a refusal code; an unknown code gets the caller's own try-again line. */
export function applyMethodMessage(code: string | undefined, fallback: string): string {
  return code && code in APPLY_METHOD_MESSAGES ? APPLY_METHOD_MESSAGES[code as keyof typeof APPLY_METHOD_MESSAGES] : fallback;
}

/** Sets, changes or (null) clears the address through the 0275 function, as the signed-in employer. Never returns the database's text. */
export async function setApplyEmail(
  supabase: Pick<SupabaseClient<Database>, "rpc">,
  jobId: string,
  address: string | null,
  context: { userId: string; fallback: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.rpc("set_job_apply_email", { p_job_id: jobId, p_address: address as never });
  if (!error) return { ok: true };
  console.error(`[apply-method] set_job_apply_email failed for job ${jobId}, user ${context.userId}: ${error.code ?? "no-code"} ${error.message}`);
  return { ok: false, error: applyMethodMessage(error.code, `Couldn't change how people apply. ${context.fallback}`) };
}

/** The address stored on the employer's own job (normalised), or null: what an edit compares the form against so the function is called only when the method really changed. */
export async function readStoredApplyEmail(supabase: Pick<SupabaseClient<Database>, "from">, jobId: string, organizationId: string): Promise<string | null> {
  const { data } = await supabase.from("job_postings").select("apply_email").eq("id", jobId).eq("organization_id", organizationId).maybeSingle();
  return postingApplyEmail(data);
}
