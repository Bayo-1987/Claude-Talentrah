import { normaliseApplyEmail } from "@/lib/jobs/apply-email";
import { postingApplyEmail } from "@/lib/jobs/posting-apply-email";
import { checkApplyLink } from "@/lib/jobs/apply-link";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

/**
 * "How should people apply?" on the employer's job form (PR-E2b): the employer's choice between applications inside Talentrah (the default, and the only state of every existing job) and
 * applications by email. The database function set_job_apply_email (0275) is the ONLY writer of the address; this file reads the form, calls the function with the signed-in employer's own
 * client, and turns every refusal into a plain sentence. The database's own message never reaches the person (EMPLOYER-ACTIONS-RAW-DB-ERRORS-1): a refusal is mapped by its code, and the real
 * text goes to the server log with the job and the user.
 */

/**
 * What the form says about how people apply. `unchanged` is a form that does not carry the choice at all (or carries one this code does not know): on an edit it means "leave the method as it is",
 * never "On Talentrah", so a form that omits the field cannot clear a stored address. A new job treats it as On Talentrah (there is nothing stored to keep).
 */
export type ApplyMethod =
  | { kind: "talentrah" }
  | { kind: "email"; address: string }
  /** PR-E4: "On our career site". `unchanged` is true when the form carries the address already stored, which is passed through without being judged again. */
  | { kind: "link"; url: string; linkKind: "company" | "ats"; atsConfirmed: boolean; warning: "name_mismatch" | undefined; unchanged: boolean }
  | { kind: "unchanged" };

/** What readApplyMethod needs to judge a career-site link: the company as it is now, and (on an edit) the link already stored. */
export interface ApplyMethodContext {
  /** The verified company's domain, or null for an unverified company (then only an applicant-tracking page is allowed). */
  companyDomain: string | null;
  companyName?: string | null;
  /** On an edit: the address and kind already stored, so an unchanged address is not re-judged. */
  storedLink?: { url: string; kind: "company" | "ats" } | null;
}

/** The plain sentences. The first four are the function's own, word for word, so a screen and a direct call say the same thing. */
export const APPLY_METHOD_MESSAGES = {
  AE001: "This job already has applications on Talentrah, so it can't be switched to email. Close it and post a new job instead.",
  AE002: "This job's apply method was changed 5 times in the last 24 hours. Try again tomorrow.",
  AE003: "Enter one email address, such as careers@yourcompany.com.",
  AE004: "This job's apply method can't be changed.",
  AE005: "That career-site address can't be used. Use a full https:// address on your company's website or on your applicant tracking page, then try again.",
  AE006: "Your company isn't verified yet, so only an applicant tracking page can be used. Verify your company to use your own website.",
  AE007: "Tick the box to confirm this is your own careers page on the applicant tracking site.",
  "42501": "We couldn't find that job.",
  "28000": "Sign in again to change how people apply.",
} as const;

export const APPLY_EMAIL_CONFIRM_MESSAGE = "Tick the box to confirm this address is yours and may be shown publicly.";
export const APPLY_EMAIL_NO_SCREENING_MESSAGE = "Screening questions and an assessment are not used when applications arrive by email. Remove them, or choose to receive applications on Talentrah.";

export const APPLY_LINK_NO_SCREENING_MESSAGE = "Screening questions and an assessment are not used when applications go to your career site. Remove them, or choose to receive applications on Talentrah.";

/** Reads the form. Only an explicit "talentrah", "email" or "link" is a choice; an absent or unknown value is `unchanged`. */
export function readApplyMethod(form: FormData, context?: ApplyMethodContext): { ok: true; method: ApplyMethod } | { ok: false; error: string } {
  const choice = form.get("applyMethod");
  if (choice === "talentrah") return { ok: true, method: { kind: "talentrah" } };
  if (choice === "link") return readLink(form, context ?? { companyDomain: null });
  if (choice !== "email") return { ok: true, method: { kind: "unchanged" } };
  const raw = form.get("applyEmail");
  const address = normaliseApplyEmail(typeof raw === "string" ? raw : "");
  if (address === null) return { ok: false, error: APPLY_METHOD_MESSAGES.AE003 };
  if (form.get("applyEmailConfirm") !== "on") return { ok: false, error: APPLY_EMAIL_CONFIRM_MESSAGE };
  return { ok: true, method: { kind: "email", address } };
}

function readLink(form: FormData, context: ApplyMethodContext): { ok: true; method: ApplyMethod } | { ok: false; error: string } {
  const raw = form.get("applyLinkUrl");
  const text = typeof raw === "string" ? raw.trim() : "";
  const stored = context.storedLink;
  // The address already stored, sent back unchanged: not judged again, so a company that has been unverified since does not block an unrelated edit. The database function is not called for it either.
  if (stored && text !== "" && text === stored.url) {
    return { ok: true, method: { kind: "link", url: stored.url, linkKind: stored.kind, atsConfirmed: false, warning: undefined, unchanged: true } };
  }
  const verdict = checkApplyLink(text, context.companyDomain, { companyName: context.companyName });
  if (!verdict.ok) return { ok: false, error: verdict.message };
  // A page on an applicant tracking system is accepted only when the employer says it is their own; the tick is recorded in the audit row.
  const atsConfirmed = form.get("applyLinkConfirm") === "on";
  if (verdict.kind === "ats" && !atsConfirmed) return { ok: false, error: APPLY_METHOD_MESSAGES.AE007 };
  return { ok: true, method: { kind: "link", url: verdict.url, linkKind: verdict.kind, atsConfirmed: verdict.kind === "ats", warning: verdict.warning, unchanged: false } };
}

/** The sentence for a refusal code; an unknown code gets the caller's own try-again line. */
export function applyMethodMessage(code: string | undefined, fallback: string): string {
  return code && code in APPLY_METHOD_MESSAGES ? APPLY_METHOD_MESSAGES[code as keyof typeof APPLY_METHOD_MESSAGES] : fallback;
}

/** The text with every occurrence of the address (any letter case) replaced; the text unchanged when there is no address. */
function withoutAddress(text: string, address: string | null): string {
  if (!address) return text;
  return text.replace(new RegExp(address.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "[address removed]");
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
  // The log keeps the code and the message, but not the address the employer typed: it is removed wherever the message quotes it, in any letter case.
  console.error(`[apply-method] set_job_apply_email failed for job ${jobId}, user ${context.userId}: ${error.code ?? "no-code"} ${withoutAddress(error.message, address)}`);
  return { ok: false, error: applyMethodMessage(error.code, `Couldn't change how people apply. ${context.fallback}`) };
}


/** The text with every web address replaced, so a database message that quotes the employer's link never reaches the log. */
function withoutLinks(text: string, url: string | null): string {
  return withoutAddress(text.replace(/https?:\/\/\S+/gi, "[link removed]"), url);
}

/**
 * Sets, changes or (null) clears the career-site link through the 0277 function. That function is executable by the SERVICE ROLE only, so this runs with the service-role client and names the
 * signed-in employer as the actor; the function re-checks membership, the company's domain, the host rules, the lock and the cap itself. Never returns the database's text, and the log never holds the link.
 */
export async function setApplyLink(
  admin: Pick<SupabaseClient<Database>, "rpc">,
  jobId: string,
  link: { url: string; kind: "company" | "ats"; atsConfirmed: boolean } | null,
  context: { userId: string; fallback: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await admin.rpc("set_job_apply_link", {
    p_job_id: jobId,
    p_actor: context.userId,
    p_url: (link ? link.url : null) as never,
    p_kind: (link ? link.kind : null) as never,
    p_ats_confirmed: link ? link.atsConfirmed : false,
  });
  if (!error) return { ok: true };
  console.error(`[apply-method] set_job_apply_link failed for job ${jobId}, user ${context.userId}: ${error.code ?? "no-code"} ${withoutLinks(error.message, link?.url ?? null)}`);
  return { ok: false, error: applyMethodMessage(error.code, `Couldn't change how people apply. ${context.fallback}`) };
}

/** What an edit needs to know about the job's stored method: its address (or null) and its link kind (or null). One read of the employer's own row; the link ITSELF is read separately, only when needed. */
export async function readStoredApplyMethod(
  supabase: Pick<SupabaseClient<Database>, "from">,
  jobId: string,
  organizationId: string,
): Promise<{ email: string | null; linkKind: "company" | "ats" | null }> {
  const { data } = await supabase.from("job_postings").select("apply_email, apply_link_kind").eq("id", jobId).eq("organization_id", organizationId).maybeSingle();
  const kind = data?.apply_link_kind;
  return { email: postingApplyEmail(data), linkKind: kind === "company" || kind === "ats" ? kind : null };
}

/** The stored career-site address for the employer's own job, through get_job_apply_link (members only; the column itself is readable by no API role). Null when none. */
export async function readStoredApplyLink(supabase: Pick<SupabaseClient<Database>, "rpc">, jobId: string): Promise<string | null> {
  const { data } = await supabase.rpc("get_job_apply_link", { p_job_id: jobId });
  return typeof data === "string" && data !== "" ? data : null;
}
