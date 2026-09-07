import { CLEAN_PROFESSIONAL_CONFIG } from "@/components/resume-builder/skeletons/configs";
import type { Json } from "@/lib/supabase/types";

/**
 * The ONE place the seed catalog's numbers live — resume templates, credit
 * packs, and passes. scripts/seed.ts, scripts/seed-catalog.ts, and the
 * tests that pin this catalog all import from here rather than restating
 * the numbers.
 *
 * WHY THIS EXISTS. Both seed scripts carried their own copy of these three
 * arrays, verbatim. That duplication caused two of the two CI failures hit
 * while landing the pass-entitlement/pricing rebase in one night:
 * seed-catalog.ts's own copy still had Popular/Power active and the Sprint
 * Pass at its pre-rebase price, and every CI run's "Seed reference data"
 * step silently re-clobbered migration 0089's data with it — a second,
 * previously-missed seed source that only existed because the numbers were
 * written down twice. One source means the next price change is one edit
 * and a type error everywhere a caller expected the old shape, not a
 * second copy quietly left stale.
 *
 * These are deliberately LITERAL values, not derived from CREDIT_COSTS —
 * a pack's credit amount is its own product decision, even where it's
 * currently designed to equal a sum of action costs (see Plus, below, and
 * the cross-check in tests/billing/pricing-catalog-rebase.test.ts that
 * verifies that relationship against CREDIT_COSTS independently rather
 * than assuming it).
 *
 * `ats_safe`/`structure_schema` on each row are the SAME class of bug this
 * file's header already warns about, just discovered a second time: migration
 * 0104 sets both per-slug with a one-off `update ... where slug = '...'`, but
 * `scripts/seed-catalog.ts` upserts THIS array on every CI job, before the
 * unit tests run (`ci.yml`'s `checks` job) — and on a truly fresh ephemeral
 * stack (PR #214), these rows don't exist until that upsert CREATES them.
 * 0104's per-slug UPDATE runs first, matches zero rows (they don't exist
 * yet), and is a silent no-op; the upsert then inserts them fresh with
 * whatever this array says, defaulting `ats_safe`/`structure_schema` to the
 * column defaults for any row that omits them. Same root cause as the
 * Popular/Power incident above — a value that lives in two places and only
 * one of them is idempotent — so it gets the same fix: put it here, the one
 * place seed-catalog actually reads from, instead of a migration's UPDATE
 * being the only writer.
 */

export interface ResumeTemplateDefinition {
  name: string;
  slug: string;
  industry_category: string;
  is_premium: boolean;
  unlock_cost_credits: number;
  /** See migration 0104's own header for the full per-slug reasoning. */
  ats_safe: boolean;
  /**
   * `{}` for every row PR3 hasn't populated yet — matches the column
   * default and is what migration 0104 itself leaves untouched for every
   * slug except `clean-professional`.
   */
  structure_schema: Json;
}

export const RESUME_TEMPLATES: readonly ResumeTemplateDefinition[] = [
  {
    name: "Clean Professional",
    slug: "clean-professional",
    industry_category: "Business",
    is_premium: false,
    unlock_cost_credits: 0,
    ats_safe: true,
    // The skeleton system's own config, not a re-typed copy of it — see
    // src/components/resume-builder/skeletons/configs.ts's own header.
    // Round-tripped through JSON, the same way the test that pins this
    // value does, since `TemplateConfig` is a concrete interface and `Json`
    // needs a plain, string-keyed structure.
    structure_schema: JSON.parse(JSON.stringify(CLEAN_PROFESSIONAL_CONFIG)) as Json,
  },
  { name: "Structured Admin", slug: "structured-admin", industry_category: "Administration", is_premium: false, unlock_cost_credits: 0, ats_safe: true, structure_schema: {} },
  { name: "Product & Tech", slug: "product-tech", industry_category: "Technology", is_premium: false, unlock_cost_credits: 0, ats_safe: true, structure_schema: {} },
  { name: "Portfolio Grid", slug: "portfolio-grid", industry_category: "Design", is_premium: true, unlock_cost_credits: 10, ats_safe: false, structure_schema: {} },
  { name: "Field Notes", slug: "field-notes", industry_category: "Customer Success", is_premium: false, unlock_cost_credits: 0, ats_safe: true, structure_schema: {} },
  { name: "Ledger", slug: "ledger", industry_category: "Banking & Finance", is_premium: false, unlock_cost_credits: 0, ats_safe: true, structure_schema: {} },
  { name: "Pipeline", slug: "pipeline", industry_category: "Sales & Marketing", is_premium: true, unlock_cost_credits: 10, ats_safe: false, structure_schema: {} },
  { name: "Clinical", slug: "clinical", industry_category: "Healthcare", is_premium: false, unlock_cost_credits: 0, ats_safe: false, structure_schema: {} },
  { name: "Statute", slug: "statute", industry_category: "Legal", is_premium: true, unlock_cost_credits: 10, ats_safe: true, structure_schema: {} },
  { name: "Critical Path", slug: "critical-path", industry_category: "Project Management", is_premium: true, unlock_cost_credits: 10, ats_safe: false, structure_schema: {} },
  { name: "Public Record", slug: "public-record", industry_category: "Government & Public Sector", is_premium: true, unlock_cost_credits: 10, ats_safe: true, structure_schema: {} },
];

export interface CreditPackDefinition {
  name: string;
  credits: number;
  price_ngn: number;
}

/**
 * Founder-decided rebase, 2026-09-03 (see 0089_pricing_catalog_rebase.sql
 * and src/lib/credits/costs.ts's header for the anchor this is built from).
 * Only the currently-sellable packs — Popular and Power are retired below,
 * not listed here, since every writer of this list only ever touches the
 * rows it names.
 */
export const CREDIT_PACKS: readonly CreditPackDefinition[] = [
  { name: "Starter", credits: 20, price_ngn: 2500 },
  { name: "Plus", credits: 45, price_ngn: 5000 },
];

/** Deactivated by 0089, never deleted (payment_transactions still references them). */
export const RETIRED_CREDIT_PACKS: readonly string[] = ["Popular", "Power"];

export interface PassDefinition {
  name: string;
  duration_days: number;
  price_ngn: number;
}

export const PASSES: readonly PassDefinition[] = [
  { name: "7-Day Sprint Pass", duration_days: 7, price_ngn: 4000 },
  { name: "30-Day Pass", duration_days: 30, price_ngn: 6500 },
  { name: "90-Day Pass", duration_days: 90, price_ngn: 15000 },
];
