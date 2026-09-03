/**
 * Seed/demo data per build-prompt §11: a fake org with internal postings, a
 * demo user with a base resume, and real external jobs pulled through the
 * actual ingestion pipeline — via its real HTTP route (not a direct import;
 * src/lib/jobs/ingest.ts pulls in "server-only" guards that only resolve
 * correctly inside Next's own runtime, not a plain tsx/node process), so
 * this also doubles as an end-to-end check that the pipeline works.
 *
 * Requires the dev server running (npm run dev) for the ingestion step.
 * Run with: npm run seed
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/types";
import { computeDedupFingerprint } from "../src/lib/jobs/dedup";
import { extractStructuredJd } from "../src/lib/jobs/extract-jd";
// Type-only, so the "server-only" guard in ingest.ts is never evaluated —
// but it means this script can no longer drift from the route's real
// response shape, which is exactly what just happened: the field was
// renamed token -> identifier and the hand-written type below kept
// compiling while every log line printed "greenhouse/undefined".
import type { IngestSourceResult } from "../src/lib/jobs/ingest";

const DEMO_EMAIL = "demo@talentrah.dev";
/** The demo account's credit balance after every seed. Set, never topped up. */
const DEMO_CREDITS = 20;

/*
 * Read from the environment, never committed. This password used to be a
 * literal here — and in the README and an e2e spec — in a PUBLIC repo, while
 * the account it unlocks is the verified owner of the demo organisation whose
 * job postings appear in every user's feed. Anyone could sign in and rewrite
 * them. Rotated 2026-08-25; set DEMO_PASSWORD in .env.local and as a CI secret.
 *
 * No fallback default on purpose: a default would quietly become the new
 * shared secret the moment someone forgot to set the variable.
 */
/*
 * Re-asserting a password on an ALREADY-EXISTING account is gated behind an
 * explicit opt-in, and that gate is load-bearing.
 *
 * CI runs `npm run seed` against the live project before the e2e job — there
 * is no separate database. Without this flag, the password of every seeded
 * account is whatever the seed script says on the branch being tested, so ANY
 * pull request could silently set the live demo account's password to a value
 * of its choosing just by editing this file. That is not hypothetical: a
 * throwaway branch opened on 2026-08-25 to prove the secret scanner works
 * reintroduced the old literals, and CI dutifully reset all three live
 * accounts back to the published passwords.
 *
 * So: creating a NEW account always sets a password (it must). Changing an
 * existing one is a deliberate local act — `SEED_ROTATE_PASSWORDS=1 npm run seed`.
 */
const ROTATE_PASSWORDS = process.env.SEED_ROTATE_PASSWORDS === "1";

const DEMO_PASSWORD = process.env.DEMO_PASSWORD;
if (!DEMO_PASSWORD) {
  throw new Error(
    "DEMO_PASSWORD is not set. Add it to .env.local (and to CI secrets for the e2e job). " +
      "It is deliberately not committed — see the note above this check.",
  );
}

// Mirrors the 7 templates already live in the "Talentrah" Supabase project
// (industry_category/is_premium/unlock_cost_credits) — reproduced here so a
// fresh project seeds the same real catalog rather than inventing a new one.
/**
 * `slug` is the join key the component registry
 * (src/components/resume-builder/templates/index.ts) reads — NOT `name`, which
 * is editable catalog copy. Keep these in step with migration 0042's backfill;
 * a slug that exists here but has no registered component renders as
 * clean-professional and fails tests/resume-builder/template-registry.test.ts.
 */
const RESUME_TEMPLATES: {
  name: string;
  slug: string;
  industry_category: string;
  is_premium: boolean;
  unlock_cost_credits: number;
}[] = [
  { name: "Clean Professional", slug: "clean-professional", industry_category: "Business", is_premium: false, unlock_cost_credits: 0 },
  { name: "Structured Admin", slug: "structured-admin", industry_category: "Administration", is_premium: false, unlock_cost_credits: 0 },
  { name: "Product & Tech", slug: "product-tech", industry_category: "Technology", is_premium: false, unlock_cost_credits: 0 },
  { name: "Portfolio Grid", slug: "portfolio-grid", industry_category: "Design", is_premium: true, unlock_cost_credits: 10 },
  { name: "Field Notes", slug: "field-notes", industry_category: "Customer Success", is_premium: false, unlock_cost_credits: 0 },
  { name: "Ledger", slug: "ledger", industry_category: "Banking & Finance", is_premium: false, unlock_cost_credits: 0 },
  { name: "Pipeline", slug: "pipeline", industry_category: "Sales & Marketing", is_premium: true, unlock_cost_credits: 10 },
  // Phase 2 — the full-library additions. Categories taken from Resume-Now's
  // and Enhancv's real taxonomies and deduped against the seven above.
  { name: "Clinical", slug: "clinical", industry_category: "Healthcare", is_premium: false, unlock_cost_credits: 0 },
  { name: "Statute", slug: "statute", industry_category: "Legal", is_premium: true, unlock_cost_credits: 10 },
  { name: "Critical Path", slug: "critical-path", industry_category: "Project Management", is_premium: true, unlock_cost_credits: 10 },
  { name: "Public Record", slug: "public-record", industry_category: "Government & Public Sector", is_premium: true, unlock_cost_credits: 10 },
];

/*
 * The paid catalogs. Prices are build-prompt §6.9's researched anchors —
 * credit ≈ ₦150, packs ₦2,500/₦6,000/₦12,500, passes ₦2,000 (7-day) and
 * ₦6,500 (30-day) — and per CLAUDE.md they are anchors, NOT validated prices.
 * Changing them here changes what checkout charges, so treat this as pricing
 * config, not fixture data.
 *
 * These existed in production only because an uncommitted migration
 * (0001–0025) inserted them once. Every other catalog the seed owns survived
 * the move to a fresh Supabase project; these two did not, because nothing
 * could recreate them — which is the bug this list closes.
 */
/*
 * Founder repricing, 2026-09-03 (see src/lib/credits/costs.ts's header for
 * the anchor this ladder is built from). Popular and Power are gone from
 * this list on purpose, not just left off a future edit — they're retired
 * by migration 0089 (deactivated, never deleted), and re-adding them here
 * would fight that migration on every seed run.
 */
const CREDIT_PACKS: { name: string; credits: number; price_ngn: number }[] = [
  { name: "Starter", credits: 20, price_ngn: 2500 },
  { name: "Plus", credits: 45, price_ngn: 5000 },
];

const PASSES: { name: string; duration_days: number; price_ngn: number }[] = [
  { name: "7-Day Sprint Pass", duration_days: 7, price_ngn: 4000 },
  { name: "30-Day Pass", duration_days: 30, price_ngn: 6500 },
  { name: "90-Day Pass", duration_days: 90, price_ngn: 15000 },
];

const INTERNAL_JOBS = [
  {
    title: "Senior Product Manager",
    location: "Lagos, Nigeria",
    work_type: "hybrid" as const,
    employment_type: "full_time" as const,
    seniority: "senior" as const,
    description:
      "Own the roadmap for Zaria Digital's merchant dashboard, working closely with engineering, design, and data on a weekly ship cadence. You'll drive product strategy for our core payments product, partner with data and engineering on activation and retention experiments, and represent the voice of the customer in every planning cycle.",
  },
  {
    title: "Backend Engineer (Node.js)",
    location: "Lagos, Nigeria",
    work_type: "remote" as const,
    employment_type: "full_time" as const,
    seniority: "mid" as const,
    description:
      "Build and maintain the services powering Zaria Digital's payments infrastructure. You'll work with Node.js, TypeScript, and PostgreSQL to ship reliable, well-tested APIs, and collaborate with product and design to turn requirements into shipped features.",
  },
  {
    title: "Customer Success Associate",
    location: "Remote",
    work_type: "remote" as const,
    employment_type: "full_time" as const,
    seniority: "entry" as const,
    description:
      "Be the first point of contact for Zaria Digital's merchants — onboarding new customers, resolving support tickets, and surfacing product feedback to the team. Great communication skills and a genuine interest in small-business customers required.",
  },
];

const DEMO_RESUME = {
  contact: {
    name: "Demo Seeker",
    email: DEMO_EMAIL,
    location: "Lagos, Nigeria",
  },
  summary:
    "Product-minded operator with 4 years across fintech and payments, focused on activation, retention, and merchant experience.",
  experience: [
    {
      title: "Product Manager",
      company: "Fintech Co",
      location: "Lagos, Nigeria",
      startDate: "2022",
      endDate: "Present",
      description:
        "Led product strategy for a merchant payments dashboard, driving stakeholder alignment across compliance, ops, and executive leadership.",
    },
    {
      title: "Associate Product Manager",
      company: "Payments Startup",
      location: "Lagos, Nigeria",
      startDate: "2020",
      endDate: "2022",
      description: "Owned onboarding and activation experiments for SMB merchants.",
    },
  ],
  education: [
    { school: "University of Lagos", degree: "B.Sc.", field: "Computer Science" },
  ],
  skills: [
    "product management",
    "stakeholder management",
    "sql",
    "agile",
    "data analysis",
    "figma",
  ],
  projects: [],
  certifications: [],
};

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local",
    );
  }

/**
 * Find an auth user by email, across ALL pages.
 *
 * `listUsers()` with no arguments returns only the FIRST PAGE — GoTrue's
 * default is 50 — ordered newest-first. Both lookups in this script used it
 * with a plain `.find()`, which works right up until the project has more
 * than 50 auth users, and then silently stops finding the accounts it is
 * meant to be re-using. `createUser` is called instead and fails with
 * "A user with this email address has already been registered", which is a
 * confusing way for a paging bug to present.
 *
 * This is not hypothetical and it is not a race, though it looks like one:
 * the seeded accounts are the OLDEST rows in the project, so a newest-first
 * page puts them LAST. Measured on the live project 2026-08-26:
 *
 *     listUsers() with no args returned: 47 users
 *     position of demo in the page: 47 of 47
 *
 * Three accounts from the cliff. Every suite run creates throwaway auth users
 * (there is no staging database — CLAUDE.md), so the count crosses 50 during
 * CI and drops back after cleanup. That is why it failed on one push to main
 * and passed on the next with identical code.
 */
async function findUserByEmail(
  supabase: SupabaseClient<Database>,
  email: string,
): Promise<{ id: string } | null> {
  const perPage = 200;
  for (let page = 1; ; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const hit = data.users.find((u) => u.email === email);
    if (hit) return hit;
    // A short page is the last page. Checking the page length rather than a
    // total avoids depending on a count GoTrue does not always return.
    if (data.users.length < perPage) return null;
  }
}

  const supabase = createClient<Database>(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log("→ Creating demo user…");
  let userId: string;
  const existingUser = await findUserByEmail(supabase, DEMO_EMAIL);

  if (existingUser) {
    userId = existingUser.id;
    if (ROTATE_PASSWORDS) {
      // Rotating DEMO_PASSWORD has to actually reach the live account,
      // otherwise the docs and tests change and the old published password
      // goes on working — which was the whole point of the rotation.
      const { error: pwErr } = await supabase.auth.admin.updateUserById(userId, {
        password: DEMO_PASSWORD,
      });
      if (pwErr) throw pwErr;
      console.log(`  already exists (${userId}) — password re-asserted from DEMO_PASSWORD`);
    } else {
      console.log(`  already exists (${userId}) — password left as-is (set SEED_ROTATE_PASSWORDS=1 to rotate)`);
    }
  } else {
    const { data, error } = await supabase.auth.admin.createUser({
      email: DEMO_EMAIL,
      password: DEMO_PASSWORD,
      email_confirm: true,
      user_metadata: {
        first_name: "Demo",
        last_name: "Seeker",
        country: "Nigeria",
      },
    });
    if (error || !data.user) throw error ?? new Error("Failed to create demo user");
    userId = data.user.id;
    console.log(`  created (${userId})`);
  }

  /*
   * ── THE DEMO ACCOUNT'S CONSUMABLES ARE RESET ON EVERY SEED ──────────────
   *
   * `free_trial_tailoring_used` and `free_trial_cover_letter_used` are
   * one-time flags, and `credits_balance` is spent down. On a shared CI
   * project that makes them ONE-WAY: the first run that tailors anything as
   * the demo user burns the trial for every run afterwards, forever, because
   * nothing ever set them back.
   *
   * That is not hypothetical — `free_trial_tailoring_used` was already `true`
   * on the CI project when this was written, with no record of which run
   * spent it. Any spec that depends on the trial being available then fails
   * for a reason that has nothing to do with the code it is testing, and
   * re-running does not help.
   *
   * So the seed makes them deterministic, exactly as it already re-asserts the
   * password: seeding is how this account is defined, and an account whose
   * state depends on which tests happened to run first is not seeded, it is
   * accumulated.
   *
   * Credits are set rather than topped up, for the same reason — "at least
   * 20" and "exactly 20" behave differently in any test that asserts a
   * balance after spending.
   */
  console.log("→ Resetting demo consumables (free trial, credits)…");
  const { error: consumablesError } = await supabase
    .from("profiles")
    .update({
      free_trial_tailoring_used: false,
      free_trial_cover_letter_used: false,
      credits_balance: DEMO_CREDITS,
    })
    .eq("id", userId);
  if (consumablesError) {
    // Loud: a silent failure here is a flake generator, and this is exactly
    // the "a rejected update RESOLVES with an error" shape.
    throw new Error(`Could not reset demo consumables: ${consumablesError.message}`);
  }

  console.log("→ Seeding base resume…");
  // Mirrors src/lib/resume/upsert-base-resume.ts's replace-in-place logic —
  // can't import that module directly, since it (like the rest of
  // src/lib/resume) is "server-only"-guarded and this script runs via plain
  // tsx/node, not Next's runtime (same constraint noted above for the
  // ingestion pipeline). The DB's unique partial index on
  // resumes(user_id) where is_base=true is what actually guarantees this
  // can't produce a duplicate either way.
  const { data: existingBase } = await supabase
    .from("resumes")
    .select("id")
    .eq("user_id", userId)
    .eq("is_base", true)
    .maybeSingle();

  if (existingBase) {
    await supabase
      .from("resumes")
      .update({ title: "My resume", source: "builder", structured_content: DEMO_RESUME })
      .eq("id", existingBase.id);
  } else {
    await supabase.from("resumes").insert({
      user_id: userId,
      is_base: true,
      title: "My resume",
      source: "builder",
      structured_content: DEMO_RESUME,
    });
  }

  console.log("→ Seeding credit packs and passes…");
  /*
   * Keyed on `name`, which 0051 made unique for exactly this reason — the same
   * argument as `slug` for resume_templates. Without that constraint the only
   * available match key was an unconstrained string, and re-seeding after a
   * copy edit would have duplicated the row rather than updated it.
   *
   * Upserted rather than inserted so a re-seed keeps prices current instead of
   * failing or duplicating. `is_active` is deliberately NOT written on update:
   * deactivating a pack is an operational decision made in the database, and
   * the seed should not silently switch it back on.
   */
  for (const pack of CREDIT_PACKS) {
    const { error } = await supabase
      .from("credit_packs")
      .upsert({ ...pack, is_active: true }, { onConflict: "name", ignoreDuplicates: false })
      .select("id")
      .single();
    if (error) throw new Error(`Failed to seed credit pack ${pack.name}: ${error.message}`);
  }
  for (const pass of PASSES) {
    const { error } = await supabase
      .from("passes")
      .upsert({ ...pass, is_active: true }, { onConflict: "name", ignoreDuplicates: false })
      .select("id")
      .single();
    if (error) throw new Error(`Failed to seed pass ${pass.name}: ${error.message}`);
  }
  console.log(`  ✓ ${CREDIT_PACKS.length} credit pack(s), ${PASSES.length} pass(es)`);

  console.log("→ Seeding resume templates…");
  /*
   * Keyed on `slug`, not `name`. `slug` is the column with the unique
   * constraint (0042), so it is the only one that can be matched on safely —
   * matching on `name` would create a duplicate row the moment catalog copy
   * was edited, and duplicates are what the constraint exists to prevent.
   */
  const templateIdBySlug = new Map<string, string>();
  for (const t of RESUME_TEMPLATES) {
    const { data: existingTemplate } = await supabase
      .from("resume_templates")
      .select("id")
      .eq("slug", t.slug)
      .maybeSingle();
    if (existingTemplate) {
      // Keep catalog copy current on re-seed; slug itself never changes.
      await supabase
        .from("resume_templates")
        .update({
          name: t.name,
          industry_category: t.industry_category,
          is_premium: t.is_premium,
          unlock_cost_credits: t.unlock_cost_credits,
        })
        .eq("id", existingTemplate.id);
      templateIdBySlug.set(t.slug, existingTemplate.id);
      continue;
    }
    const { data: newTemplate, error: templateError } = await supabase
      .from("resume_templates")
      .insert(t)
      .select("id")
      .single();
    if (templateError || !newTemplate) throw templateError ?? new Error(`Failed to create template ${t.name}`);
    templateIdBySlug.set(t.slug, newTemplate.id);
  }

  console.log("→ Seeding Resume Builder demo resumes (in-progress + finalized)…");
  const inProgressTemplateId = templateIdBySlug.get("product-tech");
  const finalizedTemplateId = templateIdBySlug.get("clean-professional");

  async function upsertBuilderResume(
    title: string,
    templateId: string | undefined,
    content: typeof DEMO_RESUME | Record<string, unknown>,
  ) {
    const { data: existing } = await supabase
      .from("resumes")
      .select("id")
      .eq("user_id", userId)
      .eq("title", title)
      .eq("is_base", false)
      .maybeSingle();
    const payload = {
      user_id: userId,
      is_base: false,
      template_id: templateId ?? null,
      title,
      source: "builder" as const,
      structured_content: JSON.parse(JSON.stringify(content)),
    };
    if (existing) {
      await supabase.from("resumes").update(payload).eq("id", existing.id);
    } else {
      await supabase.from("resumes").insert(payload);
    }
  }

  // In-progress: a draft that's barely started — only contact info filled in.
  await upsertBuilderResume("Product Manager — draft", inProgressTemplateId, {
    contact: { name: "Demo Seeker", email: DEMO_EMAIL, location: "Lagos, Nigeria" },
    summary: "",
    experience: [],
    education: [],
    skills: [],
    projects: [],
    certifications: [],
  });

  // Finalized: fully fleshed out and ready to export.
  await upsertBuilderResume("Product Manager — Clean Professional", finalizedTemplateId, DEMO_RESUME);

  console.log("→ Seeding demo organization…");
  const ORG_NAME = "Zaria Digital";
  const { data: existingOrg } = await supabase
    .from("organizations")
    .select("id")
    .eq("name", ORG_NAME)
    .maybeSingle();

  let org = existingOrg;
  if (!org) {
    const { data: newOrg, error: orgError } = await supabase
      .from("organizations")
      .insert({
        name: ORG_NAME,
        domain: "zariadigital.example",
        verified: true,
        description:
          "A fictional Lagos-based fintech, seeded for demo purposes — builds payments tools for African SMBs.",
        created_by: userId,
      })
      .select("id")
      .single();
    if (orgError || !newOrg) throw orgError ?? new Error("Failed to create demo org");
    org = newOrg;
  }

  await supabase
    .from("organization_members")
    .upsert(
      { organization_id: org.id, user_id: userId, role: "owner" },
      { onConflict: "organization_id,user_id" },
    );

  console.log("→ Seeding internal job postings…");
  for (const job of INTERNAL_JOBS) {
    await supabase.from("job_postings").upsert(
      {
        source_type: "internal",
        organization_id: org.id,
        title: job.title,
        company_name: ORG_NAME,
        location: job.location,
        work_type: job.work_type,
        employment_type: job.employment_type,
        seniority: job.seniority,
        description: job.description,
        structured_jd: JSON.parse(JSON.stringify(extractStructuredJd(job.description))),
        status: "open",
        posted_at: new Date().toISOString(),
        last_checked_at: new Date().toISOString(),
        dedup_fingerprint: computeDedupFingerprint(ORG_NAME, job.title, job.location),
      },
      { onConflict: "dedup_fingerprint" },
    );
  }

  console.log("→ Seeding Job Tracker demo entries…");
  const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();

  const { data: internalJobs } = await supabase
    .from("job_postings")
    .select("id, title")
    .eq("organization_id", org.id);
  const jobIdByTitle = new Map((internalJobs ?? []).map((j) => [j.title, j.id]));

  async function upsertLinkedApplication(
    title: string,
    stage: Database["public"]["Enums"]["application_stage"],
    source: "manual" | "internal_apply",
    appliedDaysAgo: number | null,
  ) {
    const jobId = jobIdByTitle.get(title);
    if (!jobId) return;
    const { data: existing } = await supabase
      .from("applications")
      .select("id")
      .eq("user_id", userId)
      .eq("job_posting_id", jobId)
      .maybeSingle();
    const payload = {
      user_id: userId,
      job_posting_id: jobId,
      stage,
      source,
      applied_at: appliedDaysAgo === null ? null : daysAgo(appliedDaysAgo),
    };
    if (existing) {
      await supabase.from("applications").update(payload).eq("id", existing.id);
    } else {
      await supabase.from("applications").insert(payload);
    }
  }

  async function upsertManualApplication(
    companyName: string,
    title: string,
    location: string,
    stage: Database["public"]["Enums"]["application_stage"],
    appliedDaysAgo: number,
    notes: string,
  ) {
    const { data: existing } = await supabase
      .from("applications")
      .select("id")
      .eq("user_id", userId)
      .is("job_posting_id", null)
      .eq("manual_job_snapshot->>title", title)
      .maybeSingle();
    const payload = {
      user_id: userId,
      job_posting_id: null,
      manual_job_snapshot: { companyName, title, location },
      stage,
      source: "manual" as const,
      applied_at: daysAgo(appliedDaysAgo),
      notes,
    };
    if (existing) {
      await supabase.from("applications").update(payload).eq("id", existing.id);
    } else {
      await supabase.from("applications").insert(payload);
    }
  }

  await upsertLinkedApplication("Customer Success Associate", "saved", "manual", null);
  await upsertLinkedApplication("Backend Engineer (Node.js)", "applied", "internal_apply", 10);
  await upsertLinkedApplication("Senior Product Manager", "interviewing", "internal_apply", 15);
  await upsertManualApplication(
    "Flutterwave",
    "Growth Product Manager",
    "Lagos, Nigeria",
    "offer",
    20,
    "Final round went well — awaiting paperwork.",
  );
  await upsertManualApplication(
    "Paystack",
    "Backend Engineer",
    "Lagos, Nigeria",
    "hired",
    40,
    "Accepted! Starts next month.",
  );
  await upsertManualApplication(
    "Interswitch",
    "Software Engineer",
    "Lagos, Nigeria",
    "rejected",
    25,
    "Didn't move forward after the technical screen.",
  );

  console.log("→ Seeding Refer & Earn demo data…");
  const { data: demoProfile } = await supabase
    .from("profiles")
    .select("referral_code")
    .eq("id", userId)
    .single();

  if (!demoProfile) throw new Error("Demo profile not found — seed the demo user first");
  const demoReferralCode = demoProfile.referral_code;

  /*
   * These two accounts exist only as referral-funnel demo data — nothing, in
   * the app or the tests, ever logs in as them. So they get a fresh random
   * password on every seed run, which is never stored, printed or committed.
   *
   * They previously shared a literal password committed to this PUBLIC repo,
   * and they are real accounts on the live project — the same mistake as the
   * demo user's, missed when that one was rotated. An unguessable password
   * nobody holds is stronger here than another env var to manage, precisely
   * because no one needs to log in.
   */
  const throwawayPassword = () => `seed-${randomBytes(24).toString("base64url")}`;

  async function upsertReferredFriend(email: string, firstName: string) {
    const existingFriend = await findUserByEmail(supabase, email);
    if (existingFriend) {
      if (ROTATE_PASSWORDS) {
        // Re-assert, so re-seeding actually retires the old published password
        // rather than only changing what a fresh project would get.
        const { error: pwErr } = await supabase.auth.admin.updateUserById(existingFriend.id, {
          password: throwawayPassword(),
        });
        if (pwErr) throw pwErr;
      }
      return existingFriend.id;
    }

    // Goes through the exact same handle_new_user() trigger a real signup
    // does — referral row + signup-bonus grant happen for real here, not
    // scripted, so this also verifies the M8 reward pipeline end-to-end.
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password: throwawayPassword(),
      email_confirm: true,
      user_metadata: {
        first_name: firstName,
        last_name: "Friend",
        country: "Nigeria",
        referred_by_code: demoReferralCode,
      },
    });
    if (error || !data.user) throw error ?? new Error(`Failed to create ${email}`);
    return data.user.id;
  }

  // Friend #1: signed up via the demo user's link, hasn't activated yet.
  await upsertReferredFriend("amaka.friend@talentrah.dev", "Amaka");

  // Friend #2: signed up AND activated (gets a base resume below, which
  // fires resumes_check_activation → the 20-credit activation bonus).
  const activatedFriendId = await upsertReferredFriend("chidi.friend@talentrah.dev", "Chidi");
  const { data: friendHasResume } = await supabase
    .from("resumes")
    .select("id")
    .eq("user_id", activatedFriendId)
    .eq("is_base", true)
    .maybeSingle();
  if (!friendHasResume) {
    await supabase.from("resumes").insert({
      user_id: activatedFriendId,
      is_base: true,
      title: "My resume",
      source: "builder",
      structured_content: {
        contact: { name: "Chidi Friend", email: "chidi.friend@talentrah.dev" },
        summary: "Early-career operations coordinator exploring fintech and logistics roles.",
        experience: [],
        education: [],
        skills: ["customer support", "logistics", "excel"],
        projects: [],
        certifications: [],
      },
    });
  }

  // Invited-only entry: no live flow in this build creates a pre-signup
  // "invited" referral row (share surfaces are copy-link/WhatsApp/email/
  // social, none of which are a tracked send-on-your-behalf flow) — this
  // one row is seeded directly purely so the dashboard's full funnel is
  // reviewable. See build summary for the honest scope note on this.
  const { count: invitedCount } = await supabase
    .from("referrals")
    .select("id", { count: "exact", head: true })
    .eq("referrer_id", userId)
    .eq("status", "invited");
  if (!invitedCount) {
    await supabase.from("referrals").insert({
      referrer_id: userId,
      referred_user_id: null,
      status: "invited",
    });
  }

  console.log("→ Running real ingestion pipeline for external jobs…");
  const devServerUrl = process.env.SEED_APP_URL ?? "http://localhost:3000";
  /*
   * The admin routes fail closed — unset INGEST_SECRET means every one of
   * them answers 401. That is deliberate (they were all reachable
   * unauthenticated on the deployment before it), but it makes this script a
   * caller that must present a credential, so check for it up front rather
   * than reporting the resulting 401 as "is the dev server running?".
   */
  if (!process.env.INGEST_SECRET && !process.env.ADMIN_API_SECRET) {
    throw new Error(
      "Seeding needs INGEST_SECRET (or ADMIN_API_SECRET) set — it drives the real " +
        "ingestion routes over HTTP, and those fail closed without one. Set the same " +
        "value the dev server is running with.",
    );
  }
  const adminSecret = (process.env.ADMIN_API_SECRET || process.env.INGEST_SECRET)!;

  const ingestRes = await fetch(`${devServerUrl}/api/admin/ingest-jobs`, {
    method: "POST",
    headers: { "x-admin-secret": adminSecret },
  });
  if (!ingestRes.ok) {
    throw new Error(
      ingestRes.status === 401
        ? `Ingestion route returned 401 — INGEST_SECRET here doesn't match the one the server at ${devServerUrl} was started with.`
        : `Ingestion route returned ${ingestRes.status} — is \`npm run dev\` running at ${devServerUrl}?`,
    );
  }
  const { results } = (await ingestRes.json()) as { results: IngestSourceResult[] };
  for (const r of results) {
    if (r.error) {
      console.log(`  ✗ ${r.source}/${r.identifier}: ${r.error}`);
    } else {
      const skipped = r.skipped ? `, skipped ${r.skipped}` : "";
      const collided = r.collided ? `, collided ${r.collided}` : "";
      // Loud on purpose: this one means the source may be serving stale jobs.
      const skippedSweep = r.closureSkipped ? "  ⚠ freshness sweep SKIPPED (empty fetch)" : "";
      console.log(
        `  ✓ ${r.source}/${r.identifier}: fetched ${r.fetched}, upserted ${r.upserted}, closed ${r.closed}${collided}${skipped}${skippedSweep}`,
      );
    }
  }

  // --- M10: scholarships (build-prompt §6.15) -----------------------------
  // Same shape as the job ingestion above: drive the real authenticated
  // route rather than importing the pipeline, so this doubles as a check
  // that the route works. Ingestion always lands rows as `pending` — the
  // moderation gate is what publishes them, so the seed explicitly reviews
  // most of them and deliberately leaves a couple unpublished so the gate
  // is visibly exercised rather than just asserted.
  console.log("\nIngesting scholarships...");
  const schRes = await fetch(`${devServerUrl}/api/admin/ingest-scholarships`, {
    method: "POST",
    headers: { "x-admin-secret": adminSecret },
  });
  if (!schRes.ok) {
    throw new Error(`Scholarship ingestion returned ${schRes.status}.`);
  }
  const { summary: schSummary } = (await schRes.json()) as {
    summary: { fetched: number; upserted: number; staleMarked: number };
  };
  console.log(
    `  ✓ fetched ${schSummary.fetched}, upserted ${schSummary.upserted}, expired ${schSummary.staleMarked}`,
  );

  // Publish rule keys off deadline verification, not a hand-maintained list:
  // a listing is only publishable if its deadline was actually confirmed
  // against the provider's own page (deadline_verified_at). That keeps the
  // gate honest and reproducible — re-running the seed can't quietly
  // publish something whose date nobody checked.
  const { data: allScholarships } = await supabase
    .from("scholarships")
    .select("id, program_name, deadline_verified_at, moderation_note");

  let verifiedCount = 0;
  let pendingCount = 0;
  for (const row of allScholarships ?? []) {
    const publishable = row.deadline_verified_at !== null;
    await supabase
      .from("scholarships")
      .update({
        moderation_status: publishable ? "verified" : "pending",
        moderation_note: publishable
          ? "Provider, deadline and eligibility confirmed against the official page."
          : (row.moderation_note ?? "Deadline not confirmed against the official source."),
        moderated_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    if (publishable) verifiedCount++;
    else pendingCount++;
  }
  console.log(`  ✓ moderated: ${verifiedCount} verified, ${pendingCount} left pending (unconfirmed deadline)`);

  // One save per tracker stage for the demo user. Verified listings first so
  // the visible ones get used before the gated ones — a save pointing at a
  // `pending` listing is valid data but renders nothing, since RLS hides the
  // scholarship it joins to.
  const ordered = [...(allScholarships ?? [])].sort(
    (a, b) => (a.deadline_verified_at ? 0 : 1) - (b.deadline_verified_at ? 0 : 1),
  );
  const STAGES = ["saved", "applying", "submitted", "outcome"] as const;
  for (let i = 0; i < STAGES.length && i < ordered.length; i++) {
    await supabase.from("scholarship_saves").upsert(
      { user_id: userId, scholarship_id: ordered[i].id, status: STAGES[i] },
      { onConflict: "user_id,scholarship_id" },
    );
  }
  console.log(`  ✓ demo saves: one in each of ${STAGES.join(", ")}`);

  console.log("\nDone. Demo login:");
  console.log(`  email:    ${DEMO_EMAIL}`);
  // Not echoed. This output lands in CI logs, and the whole point of the
  // rotation was to stop the password being readable by anyone who can read
  // this project. It is whatever DEMO_PASSWORD was set to.
  console.log("  password: (whatever you set DEMO_PASSWORD to)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
