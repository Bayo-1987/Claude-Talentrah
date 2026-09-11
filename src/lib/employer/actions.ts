"use server";

import { createHash } from "node:crypto";
import { readExpiry } from "./expiry-input";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { requireEmployer } from "@/lib/employer/membership";
import { getClaimCandidates } from "@/lib/employer/claim";
import { deleteJobPosting } from "@/lib/jobs/posting-deletion";
import {
  emailDomain,
  evaluateDomainVerification,
  isConsumerEmailDomain,
  normalizeDomain,
} from "@/lib/employer/verification";
import { Constants, type Enums } from "@/lib/supabase/types";

/**
 * useActionState's contract: every action takes the previous state first. The
 * `_prev` parameters below are unused by design — they exist so the client
 * components can show an error inline instead of throwing, which for a form
 * an employer just spent two minutes filling in is the difference between a
 * fixable mistake and a lost draft.
 */
export type EmployerActionState = { error: string } | { ok: true } | null;

async function getAuthedUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  return { supabase, user };
}

/**
 * Dedup key for a posting an employer typed in, rather than one the
 * aggregation pipeline ingested.
 *
 * job_postings.dedup_fingerprint is UNIQUE across the whole table, and
 * src/lib/jobs/dedup.ts keys on company+title+location — fine for aggregated
 * jobs, where the company name IS the identity. It is wrong here: anyone can
 * create an organisation called "Paystack", so two unrelated orgs posting
 * "Backend Engineer, Lagos" would collide, and the second employer would be
 * refused for a reason that has nothing to do with them.
 *
 * Keying on the organisation id instead keeps the check that matters — the
 * same org can't post the same role twice — and drops the one that doesn't.
 * Aggregated rows keep their existing scheme; the two never meet, because a
 * sha256 of a different key space cannot collide by construction.
 */
function internalDedupFingerprint(orgId: string, title: string, location: string): string {
  const normalize = (v: string) =>
    v.toLowerCase().normalize("NFKD").replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();
  return createHash("sha256")
    .update(["internal", orgId, normalize(title), normalize(location)].join("|"))
    .digest("hex");
}

function str(form: FormData, key: string): string {
  return (form.get(key) as string | null)?.trim() ?? "";
}

function optionalEnum<T extends string>(
  form: FormData,
  key: string,
  allowed: readonly T[],
): T | null {
  const value = str(form, key);
  return allowed.includes(value as T) ? (value as T) : null;
}

/* -------------------------------------------------------------------------- *
 * Onboarding
 * -------------------------------------------------------------------------- */

export async function createOrganizationAction(
  _prev: EmployerActionState,
  form: FormData,
): Promise<EmployerActionState> {
  const { supabase, user } = await getAuthedUser();

  const name = str(form, "name");
  if (!name) return { error: "Company name is required." };

  const outcome = evaluateDomainVerification({
    userEmail: user.email,
    emailConfirmed: !!user.email_confirmed_at,
    claimedDomain: str(form, "domain"),
  });

  /*
   * Refuse to create a second organisation on a domain a VERIFIED one already
   * holds — the person should be joining their colleagues, not starting a
   * parallel company.
   *
   * Checked against verified orgs only, and that scoping is the whole design
   * (see migration 0044). An unverified org has no claim on a domain:
   * production contains one created by a gmail.com user claiming a company's
   * domain, which can never verify and would otherwise lock the real employer
   * out permanently. Verification is what establishes the claim, so only a
   * verified org can block.
   *
   * Read with the service role deliberately. The user's own client can see
   * `organizations` (it is publicly readable), but routing this through the
   * admin client keeps the answer independent of any future tightening of that
   * policy — a check that silently stops finding rows would reopen the gap.
   */
  if (outcome.domain) {
    const admin = createServiceRoleClient();
    const { data: existing } = await admin
      .from("organizations")
      .select("id, name")
      .eq("domain", outcome.domain)
      .eq("verified", true)
      .maybeSingle();

    if (existing) {
      return {
        error:
          `${existing.name} is already registered on ${outcome.domain}. ` +
          `Go back and choose it from the list to join your colleagues, rather than creating a second company.`,
      };
    }
  }

  // Created through the USER's client: the RLS policy (created_by = auth.uid())
  // is what authorises this, so the employer surface exercises the real gate
  // rather than routing around it with the service role.
  const { data: org, error } = await supabase
    .from("organizations")
    .insert({
      name,
      domain: outcome.domain,
      description: str(form, "description") || null,
      created_by: user.id,
    })
    .select("id")
    .single();

  if (error || !org) {
    return { error: `Couldn't create the organisation: ${error?.message ?? "unknown error"}` };
  }

  const { error: memberError } = await supabase
    .from("organization_members")
    .insert({ organization_id: org.id, user_id: user.id, role: "owner" });

  if (memberError) {
    // Roll back rather than leave an org nobody belongs to: 0026 only lets its
    // creator join, so an orphaned org here would be permanently unreachable
    // AND would occupy its domain for the join path below.
    //
    // Service role, not the session client: organizations/organization_members
    // have never had a DELETE policy (0151/0152's own write-grant audit found
    // this), so this call silently deleted zero rows for as long as it
    // existed — the row-being-yours-doesn't-make-it-deletable half of the
    // same lesson 0028/0030 already state for UPDATE. This is a genuine
    // internal cleanup path, not a user-facing delete action, so the fix is
    // to route it through the role that can actually do the job rather than
    // inventing a client-facing DELETE policy this product does not want.
    const cleanup = createServiceRoleClient();
    const { error: cleanupError } = await cleanup.from("organizations").delete().eq("id", org.id);
    if (cleanupError) console.error(`[createOrganizationAction] orphan cleanup failed for org ${org.id}:`, cleanupError.message);
    return { error: `Couldn't set you up as the owner: ${memberError.message}` };
  }

  // `verified` is deliberately not writable by any client (migration 0028), so
  // this is the one step that needs elevated rights. Note what decides it: the
  // outcome computed above from the SESSION user's own confirmed email, never
  // anything submitted in the form.
  if (outcome.verified) {
    const admin = createServiceRoleClient();
    const { error: verifyError } = await admin
      .from("organizations")
      .update({ verified: true, updated_at: new Date().toISOString() })
      .eq("id", org.id);
    if (verifyError) {
      /*
       * 23505 here is the 0044 index, and it means a genuine race: someone
       * else at this domain verified between the pre-check above and this
       * update. Their org is the real one, so roll this one back rather than
       * leave a duplicate sitting unverified on the domain forever — that is
       * exactly the debris the index exists to prevent, and an unverified
       * leftover would also be invisible to the joinable list.
       */
      if (verifyError.code === "23505") {
        // Service role — see the memberError branch above for why: neither
        // table has ever had a DELETE policy, so the session client here was
        // silently deleting zero rows too.
        const { error: memberCleanupError } = await admin
          .from("organization_members")
          .delete()
          .eq("organization_id", org.id);
        if (memberCleanupError) {
          console.error(
            `[createOrganizationAction] duplicate-domain cleanup (members) failed for org ${org.id}:`,
            memberCleanupError.message,
          );
        }
        const { error: orgCleanupError } = await admin.from("organizations").delete().eq("id", org.id);
        if (orgCleanupError) {
          console.error(
            `[createOrganizationAction] duplicate-domain cleanup (org) failed for org ${org.id}:`,
            orgCleanupError.message,
          );
        }
        return {
          error:
            `Someone else at ${outcome.domain} registered your company while you were filling this in. ` +
            `Go back and choose it from the list to join them.`,
        };
      }
      // Not fatal — the org exists and simply stays unverified, which is the
      // safe direction. Surfacing it beats a silent downgrade the employer
      // cannot explain.
      return {
        error: `Organisation created, but verification didn't complete: ${verifyError.message}. Your jobs stay private until it does.`,
      };
    }
  }

  revalidatePath("/employer", "layout");

  /*
   * "Claim your listing" (0128, build-prompt §6.12), surfaced reactively at
   * the one moment it is cheapest to show: the org just became verified, and
   * onboarding is the only screen this account has seen so far. Skipped
   * entirely — straight to Jobs Posted, unchanged from before this
   * feature — for the overwhelmingly common case of an unverified org or a
   * verified one with nothing to claim, so this never adds a screen most
   * employers will ever see. The employer can also reach /employer/claim on
   * their own later (linked from Jobs Posted whenever candidates exist), so
   * this redirect is a convenience, not the only route in — reactive, not
   * proactive outreach; see 0128's PR description for why.
   */
  if (outcome.verified) {
    const candidates = await getClaimCandidates(supabase, org.id).catch(() => []);
    if (candidates.length > 0) redirect("/employer/claim?onboarding=1");
  }
  redirect("/employer/jobs");
}

/**
 * Join an organisation someone else created.
 *
 * This cannot go through the user's client: 0026 narrowed the membership
 * INSERT policy to organisations you created yourself, precisely because the
 * old policy let anyone join anything. So joining is a server-side decision,
 * and the rule it enforces is the same one that grants verification — your
 * confirmed work email is at the organisation's verified domain.
 *
 * Service-role scoping, per the PR #18 audit: the user id comes from the
 * session, never from the form. The org id does come from input, but it is not
 * what authorises anything — the domain comparison is, and a caller who passes
 * an org id they have no email relationship to gets refused.
 */
export async function joinOrganizationAction(
  _prev: EmployerActionState,
  form: FormData,
): Promise<EmployerActionState> {
  const { user } = await getAuthedUser();

  const organizationId = str(form, "organizationId");
  if (!organizationId) return { error: "Pick an organisation to join." };
  if (!user.email_confirmed_at) {
    return { error: "Confirm your email address before joining a company." };
  }

  const userDomain = emailDomain(user.email);
  if (!userDomain || isConsumerEmailDomain(userDomain)) {
    return {
      error: "Joining a company requires a work email address, not a personal one.",
    };
  }

  const admin = createServiceRoleClient();
  const { data: org, error: orgError } = await admin
    .from("organizations")
    .select("id, domain, verified")
    .eq("id", organizationId)
    .maybeSingle();

  if (orgError) return { error: `Couldn't look up that company: ${orgError.message}` };
  // Same not-found answer for "no such org" and "not your domain", so this
  // can't be used to probe which organisations exist.
  if (!org || !org.verified || org.domain !== userDomain) {
    return { error: "That company isn't open for you to join with this email address." };
  }

  const { error: joinError } = await admin
    .from("organization_members")
    .insert({ organization_id: org.id, user_id: user.id, role: "admin" });

  if (joinError) return { error: `Couldn't add you to that company: ${joinError.message}` };

  revalidatePath("/employer", "layout");
  redirect("/employer/jobs");
}

/* -------------------------------------------------------------------------- *
 * Company profile
 * -------------------------------------------------------------------------- */

export async function updateCompanyProfileAction(
  _prev: EmployerActionState,
  form: FormData,
): Promise<EmployerActionState> {
  const { supabase, user } = await getAuthedUser();
  const { organization } = await requireEmployer();

  const name = str(form, "name");
  if (!name) return { error: "Company name is required." };

  const claimedDomain = normalizeDomain(str(form, "domain"));

  // Editing goes through the user's client, so migration 0028's column grants
  // are what stop `verified` being smuggled in — not a hand-written allow-list
  // here that a future refactor could widen without noticing.
  const { error } = await supabase
    .from("organizations")
    .update({
      name,
      domain: claimedDomain,
      description: str(form, "description") || null,
      logo_url: str(form, "logoUrl") || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", organization.id);

  if (error) return { error: `Couldn't save your profile: ${error.message}` };

  // Changing the domain re-runs verification in BOTH directions. Only lowering
  // it would let an employer verify with their real domain and then rename to
  // someone else's while keeping the badge.
  const outcome = evaluateDomainVerification({
    userEmail: user.email,
    emailConfirmed: !!user.email_confirmed_at,
    claimedDomain,
  });

  if (outcome.verified !== organization.verified) {
    const admin = createServiceRoleClient();
    await admin
      .from("organizations")
      .update({ verified: outcome.verified, updated_at: new Date().toISOString() })
      .eq("id", organization.id);
  }

  revalidatePath("/employer/profile");
  revalidatePath("/employer/jobs");
  return { ok: true };
}

/**
 * Submit CAC (Corporate Affairs Commission) business registration details for
 * manual admin confirmation — "Path 2" of verification (0116/0120), for an
 * employer whose confirmed account email is not at the company's claimed
 * domain and so cannot reach `verified` the way `updateCompanyProfileAction`
 * above does.
 *
 * Ownership-scoped exactly like that action: this writes through the SIGNED-
 * IN user's own client, not the service role, so `requireEmployer()` (which
 * throws for anyone not a member of the organisation) plus 0120's
 * `grant update (cac_number, cac_business_name)` are what stop this touching
 * anything else — the same "grant, not a hand-written allow-list" reasoning
 * as the domain field. Submitting does not itself verify the organisation;
 * only an admin's decision does that
 * (src/lib/admin/moderation/actions.ts#decideCacVerificationAction), which is
 * exactly why `verified`, `cac_confirmed_at` and `cac_confirmed_by` are
 * withheld from this grant in 0120 and cannot be touched from here even by
 * accident.
 */
export async function submitCacVerificationAction(
  _prev: EmployerActionState,
  form: FormData,
): Promise<EmployerActionState> {
  const { supabase } = await getAuthedUser();
  const { organization } = await requireEmployer();

  const cacNumber = str(form, "cacNumber");
  const cacBusinessName = str(form, "cacBusinessName");
  if (!cacNumber || !cacBusinessName) {
    return { error: "Both the RC number and the registered business name are required." };
  }

  const { error } = await supabase
    .from("organizations")
    .update({ cac_number: cacNumber, cac_business_name: cacBusinessName })
    .eq("id", organization.id);

  if (error) return { error: `Couldn't submit for verification: ${error.message}` };

  revalidatePath("/employer/profile");
  return { ok: true };
}

/* -------------------------------------------------------------------------- *
 * Job postings
 * -------------------------------------------------------------------------- */

function readJobForm(form: FormData) {
  return {
    title: str(form, "title"),
    location: str(form, "location"),
    description: str(form, "description"),
    work_type: optionalEnum<Enums<"work_type">>(form, "workType", Constants.public.Enums.work_type),
    employment_type: optionalEnum<Enums<"employment_type">>(
      form,
      "employmentType",
      Constants.public.Enums.employment_type,
    ),
    seniority: optionalEnum<Enums<"seniority_level">>(
      form,
      "seniority",
      Constants.public.Enums.seniority_level,
    ),
    years_experience_min: str(form, "yearsExperienceMin")
      ? Number(str(form, "yearsExperienceMin"))
      : null,
  };
}

type SalaryFields = {
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  salary_unit: Enums<"salary_unit"> | null;
};

/**
 * All four salary columns travel together or not at all — see migration
 * 0085 and job-posting-jsonld.ts's baseSalary note for why a bound with no
 * currency is treated as no salary at all. Unlike the ingestion parser
 * (which silently OMITS a malformed baseSalary so one bad source field never
 * costs a whole listing), this is a human filling in one form field at a
 * time, so the right behaviour is a clear inline error, not a silent drop —
 * the same reasoning readExpiry already applies to a hand-typed date.
 */
function readSalaryForm(form: FormData): { ok: true; value: SalaryFields } | { ok: false; error: string } {
  const minRaw = str(form, "salaryMin");
  const maxRaw = str(form, "salaryMax");
  const currency = str(form, "salaryCurrency").toUpperCase();
  const unit = optionalEnum<Enums<"salary_unit">>(form, "salaryUnit", Constants.public.Enums.salary_unit);

  const min = minRaw ? Number(minRaw) : null;
  const max = maxRaw ? Number(maxRaw) : null;
  if (min !== null && !Number.isFinite(min)) return { ok: false, error: "Minimum salary isn't a number." };
  if (max !== null && !Number.isFinite(max)) return { ok: false, error: "Maximum salary isn't a number." };

  if (min === null && max === null) {
    // No amount at all — currency and period without an amount describe
    // nothing, so they are dropped rather than half-saved.
    return { ok: true, value: { salary_min: null, salary_max: null, salary_currency: null, salary_unit: null } };
  }
  if (!currency) return { ok: false, error: "Add a currency for the salary, or clear both amounts." };
  if (!/^[A-Z]{3}$/.test(currency)) {
    return { ok: false, error: "Salary currency should be a 3-letter code, like NGN or USD." };
  }
  if (min !== null && max !== null && max < min) {
    return { ok: false, error: "Maximum salary can't be less than the minimum." };
  }

  return { ok: true, value: { salary_min: min, salary_max: max, salary_currency: currency, salary_unit: unit } };
}

export async function postJobAction(
  _prev: EmployerActionState,
  form: FormData,
): Promise<EmployerActionState> {
  const { supabase } = await getAuthedUser();
  const { organization } = await requireEmployer();
  const fields = readJobForm(form);

  if (!fields.title) return { error: "Job title is required." };
  if (fields.description.length < 40) {
    return { error: "Add a real job description — at least a couple of sentences." };
  }

  // A custom date the person typed can be refused; a preset never is.
  const expiry = readExpiry(form);
  if (!expiry.ok) return { error: expiry.error };

  const salary = readSalaryForm(form);
  if (!salary.ok) return { error: salary.error };

  // Inserted through the user's client on purpose. The 0027 policy
  // (`source_type = 'internal' and is_org_member(organization_id)`) is what
  // authorises it, so a regression in that policy breaks posting loudly here
  // instead of being silently bypassed by a service-role write.
  const { data: created, error } = await supabase
    .from("job_postings")
    .insert({
      source_type: "internal",
      organization_id: organization.id,
      company_name: organization.name,
      title: fields.title,
      location: fields.location || null,
      description: fields.description,
      work_type: fields.work_type,
      employment_type: fields.employment_type,
      seniority: fields.seniority,
      years_experience_min: Number.isFinite(fields.years_experience_min)
        ? fields.years_experience_min
        : null,
      // `keep` is unreachable on create — there is no stored value to keep —
      // so undefined collapses to null, which is the documented "does not
      // expire".
      expires_at: expiry.value ?? null,
      ...salary.value,
      status: "open",
      dedup_fingerprint: internalDedupFingerprint(organization.id, fields.title, fields.location),
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      return { error: "You've already posted this role in this location." };
    }
    return { error: `Couldn't publish the job: ${error.message}` };
  }

  revalidatePath("/employer/jobs");
  revalidatePath("/jobs");
  // `?posted=<id>` is how Jobs Posted knows to surface the share link right
  // away (src/app/employer/jobs/page.tsx) — there is no other confirmation
  // screen, so this is the only moment an employer sees it without a second
  // trip back to find their own row.
  redirect(`/employer/jobs?posted=${created.id}`);
}

export async function updateJobAction(
  jobId: string,
  _prev: EmployerActionState,
  form: FormData,
): Promise<EmployerActionState> {
  const { supabase } = await getAuthedUser();
  const { organization } = await requireEmployer();
  const fields = readJobForm(form);

  if (!fields.title) return { error: "Job title is required." };
  if (fields.description.length < 40) {
    return { error: "Add a real job description — at least a couple of sentences." };
  }

  // A custom date the person typed can be refused; a preset never is.
  const expiry = readExpiry(form);
  if (!expiry.ok) return { error: expiry.error };

  const salary = readSalaryForm(form);
  if (!salary.ok) return { error: salary.error };

  // .eq("organization_id") is belt-and-braces on top of the RLS UPDATE policy.
  // Both must agree; neither is trusted alone.
  const { error } = await supabase
    .from("job_postings")
    .update({
      title: fields.title,
      location: fields.location || null,
      description: fields.description,
      work_type: fields.work_type,
      employment_type: fields.employment_type,
      seniority: fields.seniority,
      years_experience_min: Number.isFinite(fields.years_experience_min)
        ? fields.years_experience_min
        : null,
      /*
       * SPREAD, so "Keep current" omits the column rather than writing to it.
       * Setting it unconditionally would mean every unrelated edit — fixing a
       * typo in the description — silently restarted the countdown from the
       * day of the edit. Explicitly choosing "No expiry" still writes null,
       * because that is a decision rather than an absence.
       */
      ...(expiry.value === undefined ? {} : { expires_at: expiry.value }),
      // Unlike expiry, salary has no "keep current" state to preserve — the
      // form always submits all four fields together, so writing them
      // unconditionally on every edit is correct, not a countdown reset.
      ...salary.value,
      dedup_fingerprint: internalDedupFingerprint(organization.id, fields.title, fields.location),
    })
    .eq("id", jobId)
    .eq("organization_id", organization.id);

  if (error) {
    if (error.code === "23505") {
      return { error: "Another of your postings already uses this title and location." };
    }
    return { error: `Couldn't save the job: ${error.message}` };
  }

  revalidatePath("/employer/jobs");
  revalidatePath("/jobs");
  redirect("/employer/jobs");
}

/**
 * The employer's own Close/Reopen toggle (posted-job-row.tsx binds `status`
 * to the opposite of the row's current one).
 *
 * `closed_at` (0102) is stamped as a SEPARATE write, through the service
 * role, deliberately. It is a trust column — the same shape as removed_at/
 * removal_reason (0056) — withheld from job_postings' UPDATE grant to
 * `authenticated` on purpose (tests/rls/column-privileges.test.ts asserts
 * this org's own session client gets 42501 trying to set it directly), so
 * this function cannot fold it into the `supabase` (session) update above
 * even though it is the one place a self-serve close legitimately needs it
 * set. The session write is still what AUTHORISES the change — RLS plus the
 * `status` column grant are the real gate here — the service-role write only
 * records a system fact about a change that write already made, the same
 * division admin_moderate_job_posting draws between an operator's authority
 * and the timestamp it leaves behind.
 */
export async function setJobStatusAction(jobId: string, status: Enums<"job_status">) {
  const { supabase } = await getAuthedUser();
  const { organization } = await requireEmployer();

  const { data: updated, error } = await supabase
    .from("job_postings")
    .update({ status })
    .eq("id", jobId)
    .eq("organization_id", organization.id)
    .select("id");

  // A rejected update resolves with `error`, and a policy mismatch resolves
  // with zero rows — neither throws. Per this repo's standing rule, both are
  // checked before doing anything else: closed_at must not be stamped for a
  // status change that didn't actually happen.
  if (!error && updated?.length) {
    const admin = createServiceRoleClient();
    if (status === "closed") {
      await admin.from("job_postings").update({ closed_at: new Date().toISOString() }).eq("id", jobId);
    } else if (status === "open") {
      // Reopening clears it, the same convention 0079's restore branch
      // already uses for removed_at: a posting that isn't closed must not
      // carry a stale closed_at the 30-day deletion job could act on if the
      // row is ever closed-then-reopened-then-closed and something upstream
      // regresses.
      await admin.from("job_postings").update({ closed_at: null }).eq("id", jobId);
    }
  }

  revalidatePath("/employer/jobs");
  revalidatePath("/jobs");
}

/**
 * Permanent, employer-triggered deletion — the manual counterpart to the
 * 30-day automatic sweep (`deleteStaleClosedPostings`,
 * src/lib/jobs/posting-deletion.ts), for an org that doesn't want to wait a
 * month for a mistaken or unwanted CLOSED listing to disappear on its own.
 * See that file's own header for why this only ever accepts an already-
 * closed posting, and for the FK-safety/banner-cleanup guarantee it shares
 * with the sweep rather than re-deriving.
 *
 * Two-step shape, same reason `claim_external_job_posting` (0128) and
 * `setJobStatusAction` above both draw the line where they do: `job_postings`
 * no longer grants DELETE to `authenticated` at all (0151), so the session
 * client below can only RESOLVE AND AUTHORISE the request — its own SELECT,
 * scoped to `.eq("organization_id", organization.id)`, is what a forged
 * `jobId` cannot cross — never perform the delete itself. The actual write
 * goes through `deleteJobPosting`'s own service-role client, which re-checks
 * `organizationId` again on that client, independently, as defense in depth:
 * never trust an id alone once past the session-client boundary, the same
 * discipline 0128's own header documents for its SECURITY DEFINER write.
 */
export async function deleteJobAction(jobId: string) {
  const { supabase } = await getAuthedUser();
  const { organization } = await requireEmployer();

  const { data: job } = await supabase
    .from("job_postings")
    .select("id")
    .eq("id", jobId)
    .eq("organization_id", organization.id)
    .maybeSingle();

  if (!job) {
    redirect(`/employer/jobs?error=${encodeURIComponent("Couldn't find that posting.")}`);
  }

  const admin = createServiceRoleClient();
  const result = await deleteJobPosting(admin, jobId, organization.id);

  if (!result.deleted) {
    const message =
      result.reason === "not_closed"
        ? "Close this posting before deleting it."
        : "Couldn't delete that posting — it may have already been removed.";
    redirect(`/employer/jobs?error=${encodeURIComponent(message)}`);
  }

  revalidatePath("/employer/jobs");
  revalidatePath("/jobs");
  redirect("/employer/jobs?deleted=1");
}

/**
 * "Submit for review" — Path 3 (0118/0119): an employer asks an admin to
 * individually approve THIS posting for public listing, for the case where
 * the organisation itself has no other route there yet.
 *
 * Bound per row exactly like `setJobStatusAction` above — no client JS, and
 * `.eq("organization_id", organization.id)` plus the RLS UPDATE policy is
 * what stops this touching a posting that isn't the caller's own. Only
 * `admin_review_requested_at` is granted to `authenticated` (0119); the
 * decision columns are service-role only, so this action cannot self-approve
 * no matter what it sends.
 *
 * `.is("admin_review_requested_at", null)` makes a second click a no-op
 * rather than re-stamping the timestamp — the queue's ordering (oldest first)
 * would otherwise move on every re-click.
 */
export async function requestJobReviewAction(jobId: string) {
  const { supabase } = await getAuthedUser();
  const { organization } = await requireEmployer();

  await supabase
    .from("job_postings")
    .update({ admin_review_requested_at: new Date().toISOString() })
    .eq("id", jobId)
    .eq("organization_id", organization.id)
    .is("admin_review_requested_at", null);

  revalidatePath("/employer/jobs");
}

/* -------------------------------------------------------------------------- *
 * Applicants (0125)
 * -------------------------------------------------------------------------- */

/**
 * The employer's own review status for one applicant — New / Reviewing /
 * Shortlisted / Interviewing / Hired / Not a fit. Deliberately NOT
 * `applications.stage`: that column is the seeker's own private Job Tracker
 * field (0037's own header), and nothing in this feature reads, writes, or
 * extends it.
 *
 * Written through the SIGNED-IN user's own client, not the service role —
 * `employer_applicant_status`'s own RLS policies (0125,
 * `is_org_member_for_application`) are what actually authorise this, the
 * same reason `postJobAction`/`updateJobAction` insert/update through the
 * user's client rather than the service role: a regression in that policy
 * should fail this loudly, not be silently papered over by an elevated
 * write that never exercises it.
 */
export async function setApplicantStatusAction(
  applicationId: string,
  status: Enums<"applicant_review_status">,
): Promise<{ error: string } | { ok: true }> {
  const { supabase } = await getAuthedUser();
  // Not strictly required for the write itself — RLS is the real gate — but
  // matches every other action in this file: a caller with no organisation
  // at all gets sent to onboarding rather than a raw policy-violation error.
  await requireEmployer();

  const { error } = await supabase
    .from("employer_applicant_status")
    .upsert({ application_id: applicationId, status }, { onConflict: "application_id" });

  if (error) return { error: `Couldn't update status: ${error.message}` };
  return { ok: true };
}

/* -------------------------------------------------------------------------- *
 * "Claim your listing" (0128)
 * -------------------------------------------------------------------------- */

const CLAIM_ERROR_MESSAGES: Record<string, string> = {
  org_not_found: "Couldn't find your organisation.",
  org_not_verified: "Verify your company (Company Profile) before claiming a listing.",
  not_found: "That listing doesn't exist any more — someone may already have claimed it.",
  already_claimed: "Someone already claimed this listing — reload the page to see the current list.",
  not_a_match:
    "This listing's source or company name doesn't match your organisation, so it can't be claimed from here.",
  title_required: "Job title is required.",
  description_too_short: "Add a real job description — at least a couple of sentences.",
};

/**
 * Claim an external posting: creates a NEW internal posting the organisation
 * fully owns and marks the external source row removed+claimed, in one
 * atomic database transaction (`claim_external_job_posting`, 0128).
 *
 * `organization.id` comes from `requireEmployer()` — read through the user's
 * OWN client, the same as every other action in this file — never from the
 * form. The RPC is service-role only and trusts `p_organization_id` for
 * exactly that reason: a client-supplied org id would be forgeable, but this
 * one was resolved from the caller's own session first. See 0128's migration
 * header for the full trust-boundary argument (same shape as
 * `auto_apply_claim_submission`, 0034).
 *
 * The match itself is NOT re-decided here — `job_posting_claim_candidates`
 * only ever suggests, and `claim_external_job_posting` re-verifies the domain
 * or name signal server-side before writing anything, so a tampered or stale
 * `externalJobPostingId` fails closed (`not_a_match`) rather than silently
 * attaching the wrong employer's org to someone else's job.
 */
export async function claimJobPostingAction(
  _prev: EmployerActionState,
  form: FormData,
): Promise<EmployerActionState> {
  const { organization } = await requireEmployer();

  const externalJobPostingId = str(form, "externalJobPostingId");
  const title = str(form, "title");
  const description = str(form, "description");
  const location = str(form, "location");

  if (!externalJobPostingId) return { error: "Missing listing to claim." };
  if (!title) return { error: "Job title is required." };
  if (description.length < 40) {
    return { error: "Add a real job description — at least a couple of sentences." };
  }

  const admin = createServiceRoleClient();
  const { data, error } = await admin.rpc("claim_external_job_posting", {
    p_organization_id: organization.id,
    p_external_job_posting_id: externalJobPostingId,
    p_title: title,
    p_description: description,
    // Nullable in SQL (no NOT NULL constraint); typegen renders a parameter
    // without a DEFAULT as non-optional and so over-narrows it to `string` —
    // same cast `decideCampaignAction` already applies to `p_note`.
    p_location: (location || null) as unknown as string,
  });

  if (error) {
    return { error: `Couldn't claim this listing: ${error.message}` };
  }
  const row = data?.[0];
  if (!row?.ok || !row.job_posting_id) {
    return { error: CLAIM_ERROR_MESSAGES[row?.reason ?? ""] ?? "Couldn't claim this listing." };
  }

  revalidatePath("/employer/jobs");
  revalidatePath("/employer/claim");
  revalidatePath("/jobs");
  redirect(`/employer/jobs?claimed=${row.job_posting_id}`);
}

/**
 * "Not now" on the Jobs Posted nudge banner — `organizations.
 * claim_review_dismissed_at` (0128/0129). Purely a UI preference: it decides
 * nothing about any `job_postings` row and carries no trust or money, which
 * is exactly why it's granted directly to `authenticated` rather than
 * routed through the service role, the same shape as `profiles.
 * farah_hint_dismissed_at` (0066).
 *
 * Silently a no-op for an org that isn't verified or has no candidates —
 * there's no banner to dismiss in that state, so nothing calls this then,
 * but it doesn't need to defend against it either: setting a timestamp
 * nobody reads yet is harmless.
 */
export async function dismissClaimReviewAction(): Promise<void> {
  const { supabase } = await getAuthedUser();
  const { organization } = await requireEmployer();

  await supabase
    .from("organizations")
    .update({ claim_review_dismissed_at: new Date().toISOString() })
    .eq("id", organization.id);

  revalidatePath("/employer/jobs");
}
