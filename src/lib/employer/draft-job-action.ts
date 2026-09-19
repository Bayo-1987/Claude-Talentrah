"use server";

import { requireEmployer } from "@/lib/employer/membership";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { FARAH_JD_DRAFT_NGN } from "@/lib/billing/catalog";
import { draftJobDescription } from "@/lib/employer/draft-job";
import { inferSeniority, inferWorkType, extractStructuredJd } from "@/lib/jobs/extract-jd";
import type { SeniorityLevel, WorkType } from "@/lib/jobs/types";

export interface DraftJobWithFarahInput {
  title: string;
  location: string;
}

export interface DraftJobWithFarahSuccess {
  ok: true;
  description: string;
  skills: string[];
  seniority: SeniorityLevel | null;
  workType: WorkType | null;
  employmentType: string | null;
  yearsExperienceMin: number | null;
}

export interface DraftJobWithFarahFailure {
  ok: false;
  /** Two distinct, user-facing outcomes — never one generic error message for both. */
  kind: "insufficient_balance" | "generation_error";
  error: string;
}

export type DraftJobWithFarahResult = DraftJobWithFarahSuccess | DraftJobWithFarahFailure;

/**
 * send-368 — "Draft with Farah." Charge-before-generate, reverse-on-failure,
 * the same shape 0176's record_farah_screening_review established, adapted
 * for a feature with no downstream row to write atomically alongside the
 * charge (see 0181's own migration header): debit_ad_wallet and
 * credit_ad_wallet are called DIRECTLY here rather than through a dedicated
 * SQL wrapper function.
 *
 * ── NEVER GATES THE PLAIN MANUAL PATH ───────────────────────────────────────
 *
 * This function is called ONLY when an employer clicks "Let Farah scope this
 * job" — postJobAction/updateJobAction never call it, are never aware of it,
 * and publish a posting identically whether or not this was ever touched. An
 * org with a zero (or entirely absent — see below) ad wallet balance gets
 * `kind: "insufficient_balance"` back from THIS function alone; nothing about
 * the rest of the form degrades, and nothing here can block, delay, or
 * gate the actual "Publish job" submit action.
 *
 * ── SERVICE ROLE, ONLY AFTER MEMBERSHIP IS PROVEN THROUGH THE CALLER'S OWN
 *    CLIENT ──────────────────────────────────────────────────────────────
 *
 * debit_ad_wallet/credit_ad_wallet are service_role-only (0046: their
 * organization_id argument would otherwise be a forgeable authorisation).
 * `requireEmployer()` resolves the caller's own organisation through their
 * OWN RLS-scoped session first — the same "fails closed if 0026 ever
 * regresses" discipline every other employer Server Action already follows
 * — and only THAT organisation id, never one taken from client input, is
 * what gets passed to the service-role calls below.
 *
 * ── debit_ad_wallet's OWN "no row" CASE IS ALREADY THE RIGHT ANSWER FOR A
 *    FRESH ORG THAT HAS NEVER TOPPED UP ───────────────────────────────────
 *
 * A brand-new organisation has no `ad_wallets` row at all until its first
 * top-up. debit_ad_wallet's own UPDATE matches zero rows in exactly that
 * case and returns `ok: false, balance_after_ngn: 0` — the same
 * "affordability answer, never a separate check" contract 0046's own header
 * describes. No special-casing needed here for "wallet doesn't exist yet"
 * versus "wallet exists but is empty" — both look identical to this
 * function, which is the correct behaviour for both.
 */
export async function draftJobWithFarahAction(
  input: DraftJobWithFarahInput,
): Promise<DraftJobWithFarahResult> {
  const title = input.title.trim();
  const location = input.location.trim();
  if (!title) {
    return { ok: false, kind: "generation_error", error: "Add a job title first." };
  }

  const { organization, userId } = await requireEmployer();
  const admin = createServiceRoleClient();

  const { data: debitRows, error: debitError } = await admin.rpc("debit_ad_wallet", {
    p_organization_id: organization.id,
    p_amount_ngn: FARAH_JD_DRAFT_NGN,
    p_reason: "farah_jd_draft_charge",
    p_actor_user_id: userId,
  });
  if (debitError) {
    console.error("[draft-job] debit_ad_wallet failed:", debitError.message);
    return { ok: false, kind: "generation_error", error: "Couldn't check your ad wallet balance — try again." };
  }
  const debit = debitRows?.[0];
  if (!debit?.ok) {
    return {
      ok: false,
      kind: "insufficient_balance",
      error: "Not enough ad wallet balance — top up to use this.",
    };
  }

  try {
    const draft = await draftJobDescription(title, location || null);

    // Reused, not reimplemented — the exact functions the aggregation
    // pipeline already runs for scraped postings missing these fields.
    const seniority = inferSeniority(title) ?? null;
    const workType = inferWorkType(title, location || undefined) ?? null;
    const skills = extractStructuredJd(draft.description).skills;

    return {
      ok: true,
      description: draft.description,
      skills,
      seniority,
      workType,
      employmentType: draft.suggestedEmploymentType,
      yearsExperienceMin: draft.suggestedYearsExperienceMin,
    };
  } catch (err) {
    console.error("[draft-job] generation failed, reversing charge:", err);
    const { error: creditError } = await admin.rpc("credit_ad_wallet", {
      p_organization_id: organization.id,
      p_amount_ngn: FARAH_JD_DRAFT_NGN,
      p_reason: "reversal",
      p_actor_user_id: userId,
    });
    if (creditError) {
      // The employer must not be told this failed silently in a way that
      // could look like a double charge — surfaced loudly server-side, same
      // "an operational alert, not a swallowed error" stance
      // campaign-charges.ts takes for its own thrown-error case.
      console.error("[draft-job] reversal FAILED after a generation failure:", creditError.message);
    }
    return {
      ok: false,
      kind: "generation_error",
      error: "Farah couldn't draft that just now — try again.",
    };
  }
}
