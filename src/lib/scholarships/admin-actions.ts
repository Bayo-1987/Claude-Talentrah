"use server";

import { requirePermission } from "@/lib/admin/require-admin";

import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { upsertScholarships } from "./ingest";
import { manualScholarshipSchema, toNormalizedScholarship } from "./schemas";
import type { AdminScholarshipState, PendingScholarship } from "./admin-state";

/*
 * The page's server half.
 *
 * WHY THERE IS NO SESSION HERE. The brief was a password field checked
 * server-side and no new auth system, and this takes that literally: the
 * secret travels with each submission and is never stored — no cookie, no
 * token, nothing written to the DOM to be reused. The cost is that the
 * operator re-enters it per action (a browser password manager fills it), and
 * that is the right trade for a page that exists to hand-add a few rows. The
 * alternatives all end in the shared admin secret sitting somewhere it can be
 * read back: a hidden input puts it in the page source, a cookie puts it on
 * disk, and a signed session token is the new auth system the brief ruled out.
 *
 * These are Server Actions rather than fetches to /api/admin/scholarships, so
 * they hold the secret server-side instead of a browser posting it. The route
 * and the actions share the schema and the writer, so there is one definition
 * of a valid listing and one path that writes it — not two that agree today.
 */

/** Same constant-time comparison the API guard uses, for the same reason. */

/**
 * Reads the moderation queue directly rather than over HTTP to
 * /api/admin/moderate-scholarship.
 *
 * Same query, same service-role read, no self-call: a Server Action fetching
 * the app's own route would need an absolute base URL that differs per
 * environment, and would send the admin secret back out over the network to
 * come straight back in. The route stays the operator-facing surface; this is
 * the same read, in-process.
 */
async function loadPending(): Promise<PendingScholarship[]> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("scholarships")
    .select(
      "id, provider, program_name, application_deadline, official_url, moderation_status, last_checked_at",
    )
    .eq("moderation_status", "pending")
    .order("last_checked_at", { ascending: false });

  if (error) {
    console.error("[admin-scholarships:pending]", error);
    return [];
  }
  return (data ?? []) as PendingScholarship[];
}

/*
 * Named DENIED_MESSAGE, not WRONG_SECRET.
 *
 * The repo's secret scanner flags `<identifier containing "secret">= "<8+ chars>"`,
 * and it flagged this on the first run — correctly, by its own rule: it cannot
 * tell a UI string from a credential by looking. Allowlisting would have been
 * the wrong fix, for the reason the scanner's own config already gives — an
 * entry saying "this one is fine" is how the next real one gets waved through.
 * A name that is not credential-shaped costs nothing.
 */
/*
 * The shared-secret check is gone from both actions.
 *
 * It was never wrong — it was the only thing available when this page shipped,
 * and its own comment explained that the secret travelled with each submission
 * precisely so it never had to be stored anywhere. M1 replaced the premise:
 * /admin/scholarships/new now sits inside the (protected) route group, so an
 * operator who can render this form has already proved who they are against a
 * revocable session. Asking them to type a password as well would be theatre —
 * and worse, a second credential to leak.
 *
 * `requirePermission("scholarships")` here is THE GATE, not belt and braces.
 *
 * This comment used to say the opposite — that the layout guard had already
 * run and this was a second helping — and that reading is what left a real
 * hole. A Server Action is a POST endpoint in its own right, reachable without
 * ever rendering the page that hosts it, so the layout proves nothing about
 * this call. Worse, the layout only proves the caller is SOME operator; after
 * 0075 that is no longer the same question as whether they may touch
 * scholarships. An operator bounced from /admin/scholarships could still post
 * here until this changed.
 *
 * The rule the old comment got backwards: a page guard protects a page. Only
 * the action can protect the action.
 */

/**
 * Load the pending queue without writing anything.
 *
 * It used to be the "unlock" step: type the password, see what is waiting.
 * With session auth there is nothing to unlock, so it is now just a refresh —
 * kept as its own action because the form still offers "show me what is
 * pending" separately from "add a listing", and that was always the useful
 * half of it.
 *
 * The unused parameters are the useActionState contract, not leftovers.
 */
/*
 * Neither argument is used any more — there is no password to read — but
 * useActionState fixes this signature, so dropping them would break the hook's
 * contract rather than tidy anything.
 */
/* eslint-disable @typescript-eslint/no-unused-vars -- see the note above */
export async function loadQueueAction(
  _prev: AdminScholarshipState,
  _formData: FormData,
): Promise<AdminScholarshipState> {
  /* eslint-enable @typescript-eslint/no-unused-vars */
  await requirePermission("scholarships");
  return { status: "idle", pending: await loadPending(), unlocked: true };
}

export async function createScholarshipAction(
  _prev: AdminScholarshipState,
  formData: FormData,
): Promise<AdminScholarshipState> {
  await requirePermission("scholarships");

  const parsed = manualScholarshipSchema.safeParse({
    provider: formData.get("provider"),
    programName: formData.get("programName"),
    hostInstitution: formData.get("hostInstitution"),
    // Checkboxes: getAll, because a single-value get() silently keeps only the
    // first box ticked and the operator would never see the others dropped.
    degreeLevels: formData.getAll("degreeLevels"),
    fieldTags: formData.get("fieldTags"),
    fundingType: formData.get("fundingType"),
    fundingCovers: formData.get("fundingCovers"),
    eligibilityNationalities: formData.get("eligibilityNationalities"),
    eligibilityPriorDegree: formData.get("eligibilityPriorDegree"),
    eligibilityAge: formData.get("eligibilityAge"),
    eligibilityOther: formData.get("eligibilityOther"),
    applicationDeadline: formData.get("applicationDeadline"),
    cycleYear: formData.get("cycleYear"),
    officialUrl: formData.get("officialUrl"),
    sourceName: formData.get("sourceName") || undefined,
    deadlineNote: formData.get("deadlineNote"),
    reviewNote: formData.get("reviewNote"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      error: "Check the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
      pending: await loadPending(),
      unlocked: true,
    };
  }

  const result = await upsertScholarships([toNormalizedScholarship(parsed.data)]);
  if (result.error) {
    // Not echoed: a Postgres error string describes our columns and
    // constraints. It goes to the server log, where the operator's colleague
    // can read it, and the page says something true and unhelpful instead.
    console.error("[admin-scholarships:create]", result.error);
    return {
      status: "error",
      error: "Couldn't save that listing. The error is in the server log.",
      pending: await loadPending(),
      unlocked: true,
    };
  }

  // Re-read after the write so the new row shows up in the queue below the
  // form — the confirmation an operator actually trusts is seeing it listed.
  return {
    status: "success",
    returnedToReview: result.returnedToReview.length > 0,
    pending: await loadPending(),
    unlocked: true,
  };
}
