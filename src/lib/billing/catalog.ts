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
 */

export interface ResumeTemplateDefinition {
  name: string;
  slug: string;
  industry_category: string;
  is_premium: boolean;
  unlock_cost_credits: number;
}

export const RESUME_TEMPLATES: readonly ResumeTemplateDefinition[] = [
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
