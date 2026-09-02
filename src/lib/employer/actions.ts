"use server";

import { createHash } from "node:crypto";
import { readExpiry } from "./expiry-input";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { requireEmployer } from "@/lib/employer/membership";
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
    await supabase.from("organizations").delete().eq("id", org.id);
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
        await supabase.from("organization_members").delete().eq("organization_id", org.id);
        await supabase.from("organizations").delete().eq("id", org.id);
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
  const { error } = await supabase.from("job_postings").insert({
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
    // `keep` is unreachable on create — there is no stored value to keep — so
    // undefined collapses to null, which is the documented "does not expire".
    expires_at: expiry.value ?? null,
    ...salary.value,
    status: "open",
    dedup_fingerprint: internalDedupFingerprint(organization.id, fields.title, fields.location),
  });

  if (error) {
    if (error.code === "23505") {
      return { error: "You've already posted this role in this location." };
    }
    return { error: `Couldn't publish the job: ${error.message}` };
  }

  revalidatePath("/employer/jobs");
  revalidatePath("/jobs");
  redirect("/employer/jobs");
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

export async function setJobStatusAction(jobId: string, status: Enums<"job_status">) {
  const { supabase } = await getAuthedUser();
  const { organization } = await requireEmployer();

  await supabase
    .from("job_postings")
    .update({ status })
    .eq("id", jobId)
    .eq("organization_id", organization.id);

  revalidatePath("/employer/jobs");
  revalidatePath("/jobs");
}
