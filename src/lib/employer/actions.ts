"use server";

import { createHash } from "node:crypto";
import { submittedValues, type SubmittedValues } from "@/lib/forms/keep-input";
import {
  CLOSING_DATE_PASSED_MESSAGE,
  DEFAULT_NEW_POSTING_EXPIRY_DAYS,
  MAX_EXPIRY_DAYS,
  SHORT_NOTICE_DAYS,
  closesSoonMessage,
  closingDateSourceFor,
  readExpiry,
} from "./expiry-input";
import { readSalaryForm } from "./salary-input";
import { revalidatePath } from "next/cache";
import { revalidateEmbed } from "@/lib/embed/revalidate";
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
import { extractStructuredJd, SKILL_VOCABULARY } from "@/lib/jobs/extract-jd";
import { parseScreeningQuestionsForm, reconcileScreeningQuestions } from "@/lib/employer/screening-questions";
import { parseJobPostingAssessmentForm, reconcileJobPostingAssessment } from "@/lib/employer/job-posting-assessment";
import { ASSESSMENT_SUBMISSION_BUCKET } from "@/lib/employer/assessment-document";
import { Constants, type Enums, type Json } from "@/lib/supabase/types";

/**
 * The only skill strings a client-submitted `skills` field is trusted for.
 * SkillsAutocomplete (job-posting-form.tsx) is autocomplete-only against this
 * same vocabulary so a real employer session never sends anything else, but
 * this is the server-side re-check for a hand-crafted POST — see that
 * component's own header for why a custom tag must never reach
 * `structured_jd.skills` (the NON_SCREENABLE_SKILLS failure mode in a new
 * disguise: an unscreenable tag nothing can ever be measured against).
 */
const SCREENABLE_SKILL_SET = new Set(SKILL_VOCABULARY);

/**
 * useActionState's contract: every action takes the previous state first. The
 * `_prev` parameters below are unused by design — they exist so the client
 * components can show an error inline instead of throwing, which for a form
 * an employer just spent two minutes filling in is the difference between a
 * fixable mistake and a lost draft.
 */
export type EmployerActionState = { error: string; values?: SubmittedValues } | { ok: true } | null;

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

  const typed = submittedValues(form, ["name", "domain", "description", "logoUrl"]);
  const name = str(form, "name");
  if (!name) return { error: "Company name is required.", values: typed };

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

  if (error) return { error: `Couldn't save your profile: ${error.message}`, values: typed };

  // Changing the domain re-runs verification in BOTH directions. Only lowering
  // it would let an employer verify with their real domain and then rename to
  // someone else's while keeping the badge.
  const outcome = evaluateDomainVerification({
    userEmail: user.email,
    emailConfirmed: !!user.email_confirmed_at,
    claimedDomain,
  });

  // The domain rule is ONE of two independent paths to `verified` (0120). An
  // organisation an admin confirmed by CAC registration (`cac_confirmed_at`,
  // written only by decideCacVerificationAction, never by a client) is verified
  // whatever this member's email domain says: the employer it exists for is the
  // one whose email is NOT at the company domain, so the rule evaluates false
  // for them on every save. Without this clause a save quietly un-verified a
  // CAC-confirmed organisation, and since the admin CAC queue excludes rows with
  // `cac_confirmed_at` set (queues.ts) nothing could put the badge back (#715).
  // `cac_confirmed_at` is read from the row loaded by requireEmployer(), not
  // from the form.
  const shouldBeVerified = outcome.verified || organization.cac_confirmed_at !== null;

  if (shouldBeVerified !== organization.verified) {
    const admin = createServiceRoleClient();
    await admin
      .from("organizations")
      .update({ verified: shouldBeVerified, updated_at: new Date().toISOString() })
      .eq("id", organization.id);
  }

  revalidatePath("/employer/profile");
  revalidatePath("/employer/jobs");
  revalidateEmbed(organization.id);
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
  // One hidden <input name="skills"> per selection (job-posting-form.tsx),
  // so getAll is the plain-FormData way to read a multi-value field back.
  // Re-checked against SCREENABLE_SKILL_SET rather than trusted, and
  // deduplicated — the client only ever sends canonical, unique values, but
  // this is the boundary where a hand-crafted request is caught rather than
  // silently writing an arbitrary string into computeMatchScore's own
  // denominator.
  const submittedSkills = Array.from(
    new Set(
      form
        .getAll("skills")
        .map((v) => String(v).trim().toLowerCase())
        .filter((v) => SCREENABLE_SKILL_SET.has(v)),
    ),
  );

  const description = str(form, "description");

  /*
   * Fallback, not the primary path: SkillsAutocomplete pre-populates from the
   * description client-side (on mount and on typing) so this should rarely
   * actually run for an employer who wrote a real description. It exists
   * because that pre-population's correctness depended on client-side timing
   * relative to the moment "Publish job" is clicked, and there IS no timing
   * that is safe against every input device and interaction speed — a fast
   * click right after finishing the description can submit before a
   * debounced update commits, the same way it could previously race a
   * blur-triggered one (caught by e2e/employer.spec.ts and its siblings,
   * which fill the description and click Publish back to back, exactly the
   * shape a fast typist or a password-manager-style fast form-fill produces).
   * Re-running the same extractor here means correctness never depends on
   * whether the client's own copy finished in time.
   */
  const skills =
    submittedSkills.length > 0 ? submittedSkills : extractStructuredJd(description).skills;

  return {
    title: str(form, "title"),
    location: str(form, "location"),
    description,
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
    skills,
  };
}

export async function postJobAction(
  _prev: EmployerActionState,
  form: FormData,
): Promise<EmployerActionState> {
  const { supabase, user } = await getAuthedUser();
  const { organization } = await requireEmployer();
  const fields = readJobForm(form);

  if (!fields.title) return { error: "Job title is required." };
  if (fields.description.length < 40) {
    return { error: "Add a real job description — at least a couple of sentences." };
  }
  /*
   * Hard block, not a warning. An internal posting with an empty
   * `structured_jd.skills` is exactly the landmine docs/stage8-match-
   * accuracy.md's own gating rules exist to keep out of the feed: every
   * candidate scores the same flat 50/100 "nothing to compare against"
   * neutral, Excellent-eligible (Auto-Apply is Excellent-only) included.
   * SkillsAutocomplete pre-populates from the description on both mount and
   * blur, so this should rarely actually surface to an employer who wrote a
   * real description — a soft nudge would rely on that same pre-population
   * doing all the work AND on nobody clearing the list afterward, which is
   * not a guarantee. Blocking here is the actual guarantee, the same shape
   * as the description-length check immediately above it.
   */
  if (fields.skills.length === 0) {
    return { error: "Add at least one skill so seekers can be matched against this posting." };
  }

  // A custom date the person typed can be refused; a preset never is.
  // CREATION ONLY passes the default (EMP-1 / E3): a new employer posting closes in 30 days unless the form said
  // otherwise. updateJobAction below deliberately does not.
  const expiry = readExpiry(form, new Date(), { defaultDays: DEFAULT_NEW_POSTING_EXPIRY_DAYS });
  if (!expiry.ok) return { error: expiry.error };

  const salary = readSalaryForm(form);
  if (!salary.ok) return { error: salary.error };

  const screeningQuestions = parseScreeningQuestionsForm(form);
  if (!screeningQuestions.ok) return { error: screeningQuestions.error };

  const assessment = parseJobPostingAssessmentForm(form);
  if (!assessment.ok) return { error: assessment.error };

  /*
   * TWO SUBMIT BUTTONS, ONE ACTION, ONE FORM — see job-posting-form.tsx's own
   * header on why. Each button sets `name="intent"` to its own value; only
   * the CLICKED button's value reaches FormData, which is plain HTML form
   * semantics, not something either button's onClick has to implement. An
   * unrecognised or missing intent defaults to "publish" — the form's own
   * primary/first button — rather than silently drafting a submission whose
   * intent this server didn't understand.
   */
  const intent = form.get("intent") === "draft" ? "draft" : "publish";
  const status: Enums<"job_status"> = intent === "draft" ? "draft" : "open";

  // Inserted through the user's client on purpose. The 0027 policy
  // (`source_type = 'internal' and is_org_member(organization_id)`) is what
  // authorises it, so a regression in that policy breaks posting loudly here
  // instead of being silently bypassed by a service-role write. `status`
  // covers both "open" and "draft" the same way — the INSERT policy (0114)
  // never restricted which status a new row may carry, only the UPDATE
  // policy did (0190 is what taught THAT check about draft).
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
      // so undefined collapses to null. An explicit "No expiry" is also null;
      // the 30-day default applies only when the form made no choice at all.
      expires_at: expiry.value ?? null,
      ...salary.value,
      status,
      dedup_fingerprint: internalDedupFingerprint(organization.id, fields.title, fields.location),
      // Only `skills` — the one key every match-scoring read site
      // (compute-and-store.ts, refresh-job.ts) actually reads. `keywords`/
      // `responsibilities` are the rest of `StructuredJD`'s shape, but
      // nothing reads them off an internal posting's own row, and inventing
      // values for them here would just be more surface for the two copies
      // to drift.
      structured_jd: { skills: fields.skills } as Json,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      return { error: "You've already posted this role in this location." };
    }
    return {
      error: `Couldn't ${intent === "draft" ? "save the draft" : "publish the job"}: ${error.message}`,
    };
  }

  /*
   * Where the closing date came from (closing_date_source, 0207). Not part of the insert above on purpose: the column is
   * not the employer's to write (a guard trigger refuses a client that carries it in, so it cannot spoof 'default'), so
   * the server records it with the service role AFTER the employer's own insert was authorised by RLS. If this write
   * fails the source stays NULL, which counts as 'chosen', the safe side: publishing never moves such a date.
   */
  const source = closingDateSourceFor(form, expiry.value, { creating: true });
  if (source) {
    const { error: sourceError } = await createServiceRoleClient()
      .from("job_postings")
      .update({ closing_date_source: source })
      .eq("id", created.id);
    if (sourceError) console.error("[employer] created job but could not record closing_date_source", created.id, sourceError.message);
  }

  // A brand-new posting has no existing questions to reconcile against —
  // this is a plain insert of whatever the form submitted. If it fails, the
  // posting itself still exists (public if published, private if drafted);
  // surfacing the error here rather than rolling back the posting matches
  // this repo's own stance (0043's "a charge of unknown outcome is not a
  // failure") that a partial success should be reported honestly, not
  // hidden behind an all-or-nothing illusion this isn't actually a single
  // transaction.
  if (screeningQuestions.value.length > 0) {
    const result = await reconcileScreeningQuestions(supabase, created.id, screeningQuestions.value);
    if (!result.ok) {
      return {
        error: `${intent === "draft" ? "Draft saved" : "Job published"}, but couldn't save its screening questions: ${result.error}`,
      };
    }
  }

  // Same honest-partial-failure stance as the screening questions just
  // above. Title/instructions/link/required are all a brand-new posting
  // can set here — the exercise FILE, if any, is added afterward from
  // Edit, once created.id exists for its storage path to be built from
  // (see /api/employer/job-assessment-exercise's own header).
  if (assessment.value) {
    const result = await reconcileJobPostingAssessment(supabase, created.id, organization.id, user.id, assessment.value);
    if (!result.ok) {
      return {
        error: `${intent === "draft" ? "Draft saved" : "Job published"}, but couldn't save its assessment: ${result.error}`,
      };
    }
  }

  revalidatePath("/employer/jobs");
  revalidatePath("/jobs");
  revalidateEmbed(organization.id);
  // `?posted=<id>` is how Jobs Posted knows to surface the "your posting now
  // has a real id" confirmation card and its deferred banner/assessment-file
  // uploads (src/app/employer/jobs/page.tsx) — that plumbing is genuinely
  // status-agnostic (a draft has a real id the instant it's inserted, same
  // as a published posting), so the SAME query param and the SAME redirect
  // target serve both intents. The card's own copy and share block are what
  // read `postedJob.status` to say something true about a draft rather than
  // claiming it is "posted".
  redirect(`/employer/jobs?posted=${created.id}`);
}

export async function updateJobAction(
  jobId: string,
  _prev: EmployerActionState,
  form: FormData,
): Promise<EmployerActionState> {
  const { supabase, user } = await getAuthedUser();
  const { organization } = await requireEmployer();
  const fields = readJobForm(form);

  if (!fields.title) return { error: "Job title is required." };
  if (fields.description.length < 40) {
    return { error: "Add a real job description — at least a couple of sentences." };
  }
  // Same hard block as postJobAction, same reasoning — see its own comment.
  // An edit that clears every skill is indistinguishable from a posting that
  // never had any, and both collapse every candidate's score to the same
  // flat 50/100 neutral.
  if (fields.skills.length === 0) {
    return { error: "Add at least one skill so seekers can be matched against this posting." };
  }

  // A custom date the person typed can be refused; a preset never is.
  const expiry = readExpiry(form);
  if (!expiry.ok) return { error: expiry.error };

  // NOT early-returned on failure, unlike every check above it — see the
  // comment on the salary spread below and the final check before redirect.
  // send-457: an invalid salary (an amount typed with no currency) used to
  // abort this entire action, silently dropping every other field in the
  // same submission — title, description, years of experience, all of it —
  // because nothing told the person their edit hadn't saved. The columns
  // this form's own fields touch don't depend on each other; salary being
  // wrong is no reason to also refuse the title change.
  const salary = readSalaryForm(form);

  const screeningQuestions = parseScreeningQuestionsForm(form);
  if (!screeningQuestions.ok) return { error: screeningQuestions.error };

  const assessment = parseJobPostingAssessmentForm(form);
  if (!assessment.ok) return { error: assessment.error };

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
      // Unlike expiry, salary normally has no "keep current" state to
      // preserve — the form submits all four fields together, so writing
      // them unconditionally is correct, not a countdown reset. But an
      // INVALID salary (caught above, not early-returned) genuinely does
      // need a "keep current": omitting the columns here leaves whatever
      // was already saved untouched rather than guessing at a value, the
      // same shape expiry's own omission already uses.
      ...(salary.ok ? salary.value : {}),
      dedup_fingerprint: internalDedupFingerprint(organization.id, fields.title, fields.location),
      // Same as salary: the form always submits the full current skill set
      // (SkillsAutocomplete's own state, not a delta), so this is an
      // unconditional overwrite, not a "keep current" field.
      structured_jd: { skills: fields.skills } as Json,
    })
    .eq("id", jobId)
    .eq("organization_id", organization.id);

  if (error) {
    if (error.code === "23505") {
      return { error: "Another of your postings already uses this title and location." };
    }
    return { error: `Couldn't save the job: ${error.message}` };
  }

  /*
   * An edit that sets or clears the closing date is the employer's own decision: 'chosen', or null with the date.
   * "Keep current" writes neither. Server-side for the same reason as in postJobAction; scoped to this org's own row.
   */
  const source = closingDateSourceFor(form, expiry.value, { creating: false });
  if (source !== undefined) {
    const { error: sourceError } = await createServiceRoleClient()
      .from("job_postings")
      .update({ closing_date_source: source })
      .eq("id", jobId)
      .eq("organization_id", organization.id);
    if (sourceError) console.error("[employer] saved job but could not record closing_date_source", jobId, sourceError.message);
  }

  // Reconciled, not blindly replaced — see reconcileScreeningQuestions'
  // own header for why a delete-and-reinsert (the pattern `skills` above
  // uses) would risk cascading away a candidate's already-submitted answers.
  const screeningResult = await reconcileScreeningQuestions(supabase, jobId, screeningQuestions.value);
  if (!screeningResult.ok) return { error: screeningResult.error };

  const assessmentResult = await reconcileJobPostingAssessment(supabase, jobId, organization.id, user.id, assessment.value);
  if (!assessmentResult.ok) return { error: assessmentResult.error };

  // Checked LAST, after every other field in this submission has already
  // been persisted above — this is the one error return in this function
  // that does NOT mean "nothing was saved." The person sees exactly what's
  // wrong with salary specifically, without losing the rest of their edit
  // to it.
  if (!salary.ok) return { error: salary.error };

  revalidatePath("/employer/jobs");
  revalidatePath("/jobs");
  revalidateEmbed(organization.id);
  // `?assessmentCreated=<jobId>` (send-449) is how Jobs Posted knows to run
  // the same deferred-upload step Create's own `?posted=<id>` already
  // triggers (PostSuccessAssessmentFilesNote) — the files EditJobAssessment-
  // FilesPicker staged client-side for this job can only be uploaded now
  // that job_posting_assessments.id exists, and this Server Action has no
  // way to reach IndexedDB itself to do it here. Only set on a genuine
  // INSERT (reconcileJobPostingAssessment's own `created` flag): an update
  // to an already-existing assessment already has its real
  // AssessmentExerciseUpload widget and nothing was ever staged for it.
  redirect(assessmentResult.created ? `/employer/jobs?assessmentCreated=${jobId}` : "/employer/jobs");
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
      const { error: closedAtError } = await admin
        .from("job_postings")
        .update({ closed_at: new Date().toISOString() })
        .eq("id", jobId);
      // A rejected update RESOLVES with `error`, it does not throw (same
      // rule this repo applies to deletes). Left unchecked, this is the one
      // path among the five that can land `status = 'closed'` where a
      // transient failure here would leave a closed posting with a NULL
      // closed_at — the exact state posting-deletion.ts's own comment calls
      // "structurally impossible" and the 30-day deletion sweep would then
      // never pick the row up. ingest.ts and expiry.ts already check this;
      // this call site was the outlier.
      if (closedAtError) {
        console.error("[employer] closed job but could not stamp closed_at", jobId, closedAtError.message);
      }
    } else if (status === "open") {
      // Reopening clears it, the same convention 0079's restore branch
      // already uses for removed_at: a posting that isn't closed must not
      // carry a stale closed_at the 30-day deletion job could act on if the
      // row is ever closed-then-reopened-then-closed and something upstream
      // regresses.
      const { error: reopenError } = await admin
        .from("job_postings")
        .update({ closed_at: null })
        .eq("id", jobId);
      if (reopenError) {
        console.error("[employer] reopened job but could not clear closed_at", jobId, reopenError.message);
      }
    }
  }

  revalidatePath("/employer/jobs");
  revalidatePath("/jobs");
  revalidateEmbed(organization.id);
}

/**
 * The employer's own draft -> open transition (posted-job-row.tsx's Publish
 * button on a draft row) — NOT `setJobStatusAction` above, on purpose.
 *
 * That action's own reopen branch treats "open" as a RETURN to a state the
 * posting already visited once (it clears a stale `closed_at`). A draft has
 * never been open, so this is a first publish, not a reopen, and it needs
 * the opposite stamp: `posted_at`, set to the moment publication actually
 * happens, not left at whatever the row's insert-time default already was.
 *
 * `posted_at` is what every freshness-gated surface measures a posting's age
 * from (`freshnessFloorISO()`, the sitemap's own `.gte("posted_at", ...)`,
 * "Most Recent" sort, the age line on the card and the detail page) — if
 * this action left it untouched, a draft quietly started weeks before being
 * published would look that many weeks stale the instant it went live,
 * which is a silent staleness bug, not a hypothetical one.
 *
 * Same two-step shape as `setJobStatusAction`'s closed_at stamp, for the
 * identical reason: `posted_at` is no longer UPDATE-grantable to
 * `authenticated` (0190 closed that off — it used to be, which was itself a
 * pre-existing freshness-gaming hole this fix also closes) so the session
 * client can AUTHORISE the transition but cannot stamp the trust column
 * itself. `.eq("status", "draft")` on the session-client update is
 * deliberate belt-and-braces beyond what RLS alone requires: this action
 * exists to publish a DRAFT specifically, and scoping the WHERE clause to
 * the one status it is meant to act on means a forged call against an
 * already-open, closed, or removed posting is a no-op (zero rows updated)
 * rather than a status change this action was never meant to make.
 */
export type PublishDraftResult =
  | { ok: true }
  /** `past`: the closing date has passed (blocks). `soon`: under 3 days away (warns; "Publish anyway" overrides). */
  | { ok: false; kind: "past" | "soon" | "other"; error: string };

/**
 * ── THE CLOSING DATE AT FIRST PUBLISH (EMP-1 / E3) ────────────────────────
 *
 * A draft is created with the same 30-day default as any new posting, but 30 days should count from the moment
 * candidates can first SEE the job, not from when it was drafted. What publishing does depends on
 * `closing_date_source` (0207), which the server recorded when the date was set:
 *
 *   no closing date       left null. "No expiry" stays no expiry through publish.
 *   'default'             reset to now + 30 days, whether or not it had passed yet.
 *   'chosen', or NULL     the employer's date, never moved. (A NULL source with a date is a row from before the column,
 *                         and counts as chosen: nobody can show it was defaulted.)
 *       already passed            the publish is REFUSED ("This closing date has passed. Pick a new one"), nothing is
 *                                 written, and the employer is asked to pick again.
 *       under 3 days away         the employer is WARNED with the real number of days and may "Publish anyway"
 *                                 (`confirmShortNotice`) or change the date. Not blocked: some jobs really are short.
 *       3 or more days out        left exactly as it is.
 *
 * `newExpiresIn`, when present, is the employer's answer to a refusal (the same duration values the form posts; "" is
 * "No expiry"). It is their pick, so it is recorded 'chosen' (or null with "No expiry"), and it gets the same
 * under-3-days warning.
 *
 * The reset and the re-pick are written with the service role, and the reset is itself conditional on
 * `closing_date_source = 'default'`, so a date edited to 'chosen' between the read and the write cannot be moved: the
 * statement refuses it rather than this code having read a value and then acted on it. They are made BEFORE the status
 * flips, so nothing is ever open with a date this action was about to replace; a chosen date that is kept carries
 * `expires_at > now` on the status UPDATE, so it cannot be published after it has slipped into the past.
 */
async function publishDraft(
  jobId: string,
  options: { newExpiresIn?: string; confirmShortNotice?: boolean } = {},
): Promise<PublishDraftResult> {
  const { supabase } = await getAuthedUser();
  const { organization } = await requireEmployer();

  const { data: draft } = await supabase
    .from("job_postings")
    .select("id, status, source_type, expires_at, closing_date_source")
    .eq("id", jobId)
    .eq("organization_id", organization.id)
    .maybeSingle();

  if (!draft || draft.status !== "draft" || draft.source_type !== "internal") {
    return { ok: false, kind: "other", error: "This job can't be published." };
  }

  const now = new Date();
  const shortNoticeAt = now.getTime() + SHORT_NOTICE_DAYS * 86_400_000;
  const daysFromNow = (days: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + days);
    return d.toISOString();
  };
  /** Under 3 days: a warning unless the employer has already said "Publish anyway". */
  const soonWarning = (closesAtMs: number): PublishDraftResult | null =>
    closesAtMs < shortNoticeAt && !options.confirmShortNotice
      ? { ok: false, kind: "soon", error: closesSoonMessage(closesAtMs - now.getTime()) }
      : null;

  /** A write the SERVICE ROLE makes before the status flips (the reset, or the employer's re-pick). */
  let preWrite: { payload: { expires_at?: string | null; closing_date_source?: string | null }; onlyIfDefault: boolean } | null = null;
  let keepsChosenDate = false;

  if (options.newExpiresIn !== undefined) {
    // The employer answered a refusal.
    if (options.newExpiresIn === "") {
      preWrite = { payload: { expires_at: null, closing_date_source: null }, onlyIfDefault: false };
    } else {
      const days = Number(options.newExpiresIn);
      if (!Number.isFinite(days) || days <= 0 || days > MAX_EXPIRY_DAYS) {
        return { ok: false, kind: "other", error: "That closing date isn't valid. Pick another." };
      }
      const closes = new Date(daysFromNow(days));
      const warning = soonWarning(closes.getTime());
      if (warning) return warning;
      preWrite = { payload: { expires_at: closes.toISOString(), closing_date_source: "chosen" }, onlyIfDefault: false };
    }
  } else if (draft.expires_at) {
    if (draft.closing_date_source === "default") {
      preWrite = { payload: { expires_at: daysFromNow(DEFAULT_NEW_POSTING_EXPIRY_DAYS) }, onlyIfDefault: true };
    } else {
      const closes = new Date(draft.expires_at).getTime();
      if (closes <= now.getTime()) return { ok: false, kind: "past", error: CLOSING_DATE_PASSED_MESSAGE };
      const warning = soonWarning(closes);
      if (warning) return warning;
      keepsChosenDate = true;
    }
  }

  const admin = createServiceRoleClient();
  if (preWrite) {
    let write = admin
      .from("job_postings")
      .update(preWrite.payload)
      .eq("id", jobId)
      .eq("organization_id", organization.id)
      .eq("source_type", "internal")
      .eq("status", "draft");
    if (preWrite.onlyIfDefault) write = write.eq("closing_date_source", "default");
    const { error: preWriteError } = await write;
    if (preWriteError) {
      console.error("[employer] could not set the closing date before publishing", jobId, preWriteError.message);
      return { ok: false, kind: "other", error: "This job couldn't be published. Refresh and try again." };
    }
  }

  let update = supabase
    .from("job_postings")
    .update({ status: "open" })
    .eq("id", jobId)
    .eq("organization_id", organization.id)
    .eq("status", "draft");
  if (keepsChosenDate) update = update.gt("expires_at", now.toISOString());
  const { data: updated, error } = await update.select("id");

  // Same rule as setJobStatusAction just above: a rejected update RESOLVES
  // with `error`, and a policy/status mismatch resolves with zero rows —
  // neither throws. posted_at must not be stamped for a publish that didn't
  // actually happen.
  if (error || !updated?.length) {
    return keepsChosenDate
      ? { ok: false, kind: "past", error: CLOSING_DATE_PASSED_MESSAGE }
      : { ok: false, kind: "other", error: "This job couldn't be published. Refresh and try again." };
  }

  const { error: postedAtError } = await admin
    .from("job_postings")
    .update({ posted_at: new Date().toISOString() })
    .eq("id", jobId);
  if (postedAtError) {
    console.error("[employer] published job but could not stamp posted_at", jobId, postedAtError.message);
  }

  revalidatePath("/employer/jobs");
  revalidatePath("/jobs");
  revalidateEmbed(organization.id);
  return { ok: true };
}

export async function publishJobAction(jobId: string): Promise<PublishDraftResult> {
  return publishDraft(jobId);
}

/**
 * The Publish button's own action (useActionState shape). The first click posts nothing but the button. If the closing
 * date has passed the row shows the message and a date control with "30 days" preselected, and the next click posts
 * `expiresIn`. If it is under 3 days away the row warns, and "Publish anyway" posts `confirmShortNotice`.
 */
export async function publishDraftFormAction(
  jobId: string,
  _prev: PublishDraftResult | null,
  form: FormData,
): Promise<PublishDraftResult> {
  return publishDraft(jobId, {
    newExpiresIn: form.has("expiresIn") ? String(form.get("expiresIn")).trim() : undefined,
    confirmShortNotice: form.get("confirmShortNotice") === "1",
  });
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
  revalidateEmbed(organization.id);
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

  /*
   * `.eq("status", "open")` — found while auditing this action for draft
   * support (send-447), not something it already had: nothing here checked
   * status at all before this. The UI's own "Submit for review" button
   * already only renders for `job.status === "open"`, but that is a
   * rendering condition, not a server-side check — a direct call against a
   * draft's id would otherwise have queued a posting that was never trying
   * to reach the public feed for an admin's Path 3 review, and an approval
   * on it would need re-reviewing the moment the posting's real content
   * later changed under Edit before ever being published.
   */
  await supabase
    .from("job_postings")
    .update({ admin_review_requested_at: new Date().toISOString() })
    .eq("id", jobId)
    .eq("organization_id", organization.id)
    .eq("status", "open")
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

export interface ScreeningAnswerDetail {
  questionText: string;
  questionType: string;
  required: boolean;
  answerYesNo: boolean | null;
  answerNumber: number | null;
  answerText: string | null;
  passed: boolean | null;
  /** send-345 — 'self' unless the employer opted this free_text question into a paid Farah review (0176). */
  screeningMode: string;
  farahReviewStatus: string | null;
  farahTier: string | null;
  farahSummary: string | null;
}

/**
 * send-344 — on-demand detail read for one application's screening answers.
 * NOT embedded in `employer_job_applicants` (already widened three times;
 * see 0175's own header for why raw answer text is a different shape of
 * read, fetched only when a recruiter actually opens it). Mirrors the same
 * on-demand precedent the resume view already uses, just as a Server Action
 * rather than a route — a handful of short fields, not a full page nav.
 *
 * `employer_application_screening_answers` (0175) is itself the real
 * authorization boundary — SECURITY DEFINER, derives the job posting's
 * organization_id from the application and checks is_org_member, no
 * client-supplied org id. This wrapper does not re-check membership itself,
 * same as `setApplicantStatusAction` above trusting RLS as the real gate.
 */
export async function getApplicationScreeningAnswersAction(
  applicationId: string,
): Promise<{ error: string } | { ok: true; answers: ScreeningAnswerDetail[] }> {
  const { supabase } = await getAuthedUser();
  await requireEmployer();

  const { data, error } = await supabase.rpc("employer_application_screening_answers", {
    p_application_id: applicationId,
  });
  if (error) return { error: `Couldn't load screening answers: ${error.message}` };

  return {
    ok: true,
    answers: (data ?? []).map((row) => ({
      questionText: row.question_text,
      questionType: row.question_type,
      required: row.required,
      answerYesNo: row.answer_yes_no,
      answerNumber: row.answer_number,
      answerText: row.answer_text,
      passed: row.passed,
      screeningMode: row.screening_mode,
      farahReviewStatus: row.farah_review_status,
      farahTier: row.farah_tier,
      farahSummary: row.farah_summary,
    })),
  };
}

export interface AssessmentSubmissionResponseFile {
  /** A short-lived signed URL — never a public one, since job-assessment-submissions is a private bucket. Null if signing itself failed. */
  url: string | null;
  originalFilename: string;
}

export interface AssessmentSubmissionDetail {
  responseText: string | null;
  /** Up to MAX_ASSESSMENT_FILES entries (send-365 — was a single responseFileUrl before this). */
  responseFiles: AssessmentSubmissionResponseFile[];
  responseLink: string | null;
  submittedAt: string;
}

/**
 * send-346 v2 — on-demand read of a candidate's assessment submission,
 * mirroring getApplicationScreeningAnswersAction's own shape. Widened by
 * send-365/0179 from a single file to a list.
 *
 * UNLIKE the screening-answers read above, this does NOT go through a
 * SECURITY DEFINER function — application_assessment_submissions' own
 * table RLS (0177: the submitting candidate OR is_org_member(organization_id))
 * already lets an org member read the row directly through their own
 * session client, and 0179's own new table RLS on
 * application_assessment_response_files makes the identical two-party
 * check available for the child rows, so a second privileged layer would
 * just duplicate what RLS already grants.
 *
 * Each file is resolved to a SIGNED url via the caller's own client —
 * `createSignedUrl` itself is subject to the bucket's RLS SELECT policy
 * (can_access_assessment_submission, rewritten by 0179 to join through the
 * new child table), so an employer outside the owning org is refused here
 * the same way a direct download would be, not because of an extra check
 * in this function but because Storage evaluates the identical policy
 * either way.
 */
export async function getApplicationAssessmentSubmissionAction(
  applicationId: string,
): Promise<{ error: string } | { ok: true; submission: AssessmentSubmissionDetail | null }> {
  const { supabase } = await getAuthedUser();
  await requireEmployer();

  const { data, error } = await supabase
    .from("application_assessment_submissions")
    .select("id, response_text, response_link, submitted_at")
    .eq("application_id", applicationId)
    .maybeSingle();
  if (error) return { error: `Couldn't load the assessment response: ${error.message}` };
  if (!data) return { ok: true, submission: null };

  const { data: fileRows, error: filesError } = await supabase
    .from("application_assessment_response_files")
    .select("file_path, original_filename")
    .eq("application_assessment_submission_id", data.id)
    .order("created_at", { ascending: true });
  if (filesError) return { error: `Couldn't load the response's files: ${filesError.message}` };

  const responseFiles: AssessmentSubmissionResponseFile[] = [];
  for (const row of fileRows ?? []) {
    const { data: signed, error: signError } = await supabase.storage
      .from(ASSESSMENT_SUBMISSION_BUCKET)
      .createSignedUrl(row.file_path, 3600);
    if (signError) {
      console.error(`[assessment-submission] could not sign ${row.file_path}:`, signError.message);
    }
    responseFiles.push({ url: signError ? null : signed.signedUrl, originalFilename: row.original_filename });
  }

  return {
    ok: true,
    submission: {
      responseText: data.response_text,
      responseFiles,
      responseLink: data.response_link,
      submittedAt: data.submitted_at,
    },
  };
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
  revalidateEmbed(organization.id);
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
