/**
 * Reference data only — the rows the app treats as a catalog rather than as
 * someone's data: resume templates, credit packs, passes, scholarships.
 *
 * WHY THIS IS SEPARATE FROM `npm run seed`. The full seed needs a running dev
 * server: it drives the real ingestion routes so the seed doubles as a check
 * that those routes work. That is a good property and worth keeping — but it
 * means seeding lives in CI's Playwright job, which is `needs: checks`. On a
 * database that has never been seeded, the UNIT tests therefore run first,
 * fail on a missing catalog, and skip the very job that would have fixed it.
 *
 * That deadlock cost a red CI run the first time the suite was pointed at the
 * new project, and it would cost one again for every fresh project after it.
 *
 * Everything here is a direct database write with no app involved, so it can
 * run before the unit tests. It is idempotent: safe to run on every CI job and
 * on an already-populated database.
 *
 * The FULL seed remains the thing that creates demo users, resumes,
 * applications and ingested jobs. This is deliberately only the catalog.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/types";
import { SEED_SCHOLARSHIPS } from "../src/lib/scholarships/sources.config";
import { computeScholarshipFingerprint } from "../src/lib/scholarships/dedup";

const RESUME_TEMPLATES = [
  { name: "Clean Professional", slug: "clean-professional", industry_category: "Business", is_premium: false, unlock_cost_credits: 0 },
  { name: "Structured Admin", slug: "structured-admin", industry_category: "Administration", is_premium: false, unlock_cost_credits: 0 },
  { name: "Product & Tech", slug: "product-tech", industry_category: "Technology", is_premium: false, unlock_cost_credits: 0 },
  { name: "Portfolio Grid", slug: "portfolio-grid", industry_category: "Design", is_premium: true, unlock_cost_credits: 10 },
  { name: "Field Notes", slug: "field-notes", industry_category: "Customer Success", is_premium: false, unlock_cost_credits: 0 },
  { name: "Ledger", slug: "ledger", industry_category: "Banking & Finance", is_premium: false, unlock_cost_credits: 0 },
  { name: "Pipeline", slug: "pipeline", industry_category: "Sales & Marketing", is_premium: true, unlock_cost_credits: 10 },
  { name: "Clinical", slug: "clinical", industry_category: "Healthcare", is_premium: false, unlock_cost_credits: 0 },
  { name: "Statute", slug: "statute", industry_category: "Legal", is_premium: true, unlock_cost_credits: 10 },
  { name: "Critical Path", slug: "critical-path", industry_category: "Project Management", is_premium: true, unlock_cost_credits: 10 },
  { name: "Public Record", slug: "public-record", industry_category: "Government & Public Sector", is_premium: true, unlock_cost_credits: 10 },
];

// Founder-decided rebase, 2026-09-03 (see 0089_pricing_catalog_rebase.sql).
// Popular and Power are retired — deactivated below, not listed here, since
// this script's upsert only ever touches the rows it lists.
const CREDIT_PACKS = [
  { name: "Starter", credits: 20, price_ngn: 2500 },
  { name: "Plus", credits: 45, price_ngn: 5000 },
];
const RETIRED_CREDIT_PACKS = ["Popular", "Power"];

const PASSES = [
  { name: "7-Day Sprint Pass", duration_days: 7, price_ngn: 4000 },
  { name: "30-Day Pass", duration_days: 30, price_ngn: 6500 },
  { name: "90-Day Pass", duration_days: 90, price_ngn: 15000 },
];

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("seed-catalog needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  }
  const db = createClient<Database>(url, key, { auth: { persistSession: false } });

  const { error: tplErr } = await db
    .from("resume_templates")
    .upsert(RESUME_TEMPLATES, { onConflict: "slug" });
  if (tplErr) throw new Error(`resume_templates: ${tplErr.message}`);

  const { error: packErr } = await db
    .from("credit_packs")
    .upsert(CREDIT_PACKS.map((p) => ({ ...p, is_active: true })), { onConflict: "name" });
  if (packErr) throw new Error(`credit_packs: ${packErr.message}`);

  // Retired packs must not come back active on a re-run of this script —
  // this ran on every CI job and reactivated Popular/Power on every single
  // run until this fix, silently reverting 0089's catalog data (a schema
  // migration can't stop a script from writing over it on the next run).
  const { error: retireErr } = await db
    .from("credit_packs")
    .update({ is_active: false })
    .in("name", RETIRED_CREDIT_PACKS);
  if (retireErr) throw new Error(`retiring credit_packs: ${retireErr.message}`);

  const { error: passErr } = await db
    .from("passes")
    .upsert(PASSES.map((p) => ({ ...p, is_active: true })), { onConflict: "name" });
  if (passErr) throw new Error(`passes: ${passErr.message}`);

  /*
   * Scholarships carry their own moderation state, and reproducing it matters:
   * tests/rls/cross-user.test.ts asserts that a VERIFIED one is visible to any
   * signed-in user and a PENDING one is not, so a catalog with only one of the
   * two states would leave that gate untested rather than failing loudly.
   *
   * The publish rule is the same one the full seed uses and is not a
   * hand-maintained list: a listing is publishable only if its deadline was
   * actually confirmed against the provider's page. Anything unverified stays
   * pending, which is what keeps a couple of rows on the unpublished side.
   */
  const rows = SEED_SCHOLARSHIPS.map((s) => ({
    provider: s.provider,
    program_name: s.programName,
    host_institution: s.hostInstitution,
    degree_levels: s.degreeLevels,
    field_tags: s.fieldTags,
    funding_type: s.fundingType,
    funding_covers: s.fundingCovers,
    eligibility_nationalities: s.eligibilityNationalities,
    eligibility_prior_degree: s.eligibilityPriorDegree,
    eligibility_age: s.eligibilityAge,
    eligibility_other: s.eligibilityOther,
    application_deadline: s.applicationDeadline,
    cycle_year: s.cycleYear,
    official_url: s.officialUrl,
    source_name: s.sourceName,
    deadline_verified_at: s.deadlineVerifiedAt,
    deadline_note: s.deadlineNote,
    moderation_status: (s.deadlineVerifiedAt ? "verified" : "pending") as
      | "verified"
      | "pending",
    moderation_note: s.reviewNote,
    dedup_fingerprint: computeScholarshipFingerprint(s.provider, s.programName, s.cycleYear),
  }));

  const { error: schErr } = await db
    .from("scholarships")
    .upsert(rows, { onConflict: "dedup_fingerprint" });
  if (schErr) throw new Error(`scholarships: ${schErr.message}`);

  const verified = rows.filter((r) => r.moderation_status === "verified").length;
  console.log(
    `catalog: ${RESUME_TEMPLATES.length} templates, ${CREDIT_PACKS.length} packs, ` +
      `${PASSES.length} passes, ${rows.length} scholarships ` +
      `(${verified} verified / ${rows.length - verified} pending)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
