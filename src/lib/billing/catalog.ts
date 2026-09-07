import { CLEAN_PROFESSIONAL_CONFIG } from "@/components/resume-builder/skeletons/configs";
import { CATALOG_TEMPLATE_CONFIGS } from "@/components/resume-builder/skeletons/catalog-configs";
import type { TemplateConfig } from "@/components/resume-builder/skeletons/types";
import type { Json } from "@/lib/supabase/types";

/**
 * `structure_schema` for every PR3 slug (the 4 fixed PR2 fallback rows and
 * the 54 new templates), round-tripped through JSON the same way
 * `CLEAN_PROFESSIONAL_CONFIG` already is right below — see this file's
 * header for why that round-trip and this whole "reference the same source
 * the migration's JSON was generated from" pattern exists.
 */
function configFor(slug: string): TemplateConfig {
  const config = CATALOG_TEMPLATE_CONFIGS[slug];
  if (!config) throw new Error(`No skeleton config registered for template slug "${slug}".`);
  return config;
}
function structureSchemaFor(slug: string): Json {
  return JSON.parse(JSON.stringify(configFor(slug))) as Json;
}
function atsSafeFor(slug: string): boolean {
  return configFor(slug).atsSafe;
}

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
  // Template library PR3: these four were the "known unstyled free" slugs —
  // real ats_safe/structure_schema now, sourced from CATALOG_TEMPLATE_CONFIGS
  // (skeletons/catalog-configs.ts) exactly like clean-professional above.
  { name: "Structured Admin", slug: "structured-admin", industry_category: "Administration", is_premium: false, unlock_cost_credits: 0, ats_safe: atsSafeFor("structured-admin"), structure_schema: structureSchemaFor("structured-admin") },
  { name: "Product & Tech", slug: "product-tech", industry_category: "Technology", is_premium: false, unlock_cost_credits: 0, ats_safe: atsSafeFor("product-tech"), structure_schema: structureSchemaFor("product-tech") },
  { name: "Portfolio Grid", slug: "portfolio-grid", industry_category: "Design", is_premium: true, unlock_cost_credits: 10, ats_safe: false, structure_schema: {} },
  { name: "Field Notes", slug: "field-notes", industry_category: "Customer Success", is_premium: false, unlock_cost_credits: 0, ats_safe: atsSafeFor("field-notes"), structure_schema: structureSchemaFor("field-notes") },
  { name: "Ledger", slug: "ledger", industry_category: "Banking & Finance", is_premium: false, unlock_cost_credits: 0, ats_safe: atsSafeFor("ledger"), structure_schema: structureSchemaFor("ledger") },
  { name: "Pipeline", slug: "pipeline", industry_category: "Sales & Marketing", is_premium: true, unlock_cost_credits: 10, ats_safe: false, structure_schema: {} },
  { name: "Clinical", slug: "clinical", industry_category: "Healthcare", is_premium: false, unlock_cost_credits: 0, ats_safe: false, structure_schema: {} },
  { name: "Statute", slug: "statute", industry_category: "Legal", is_premium: true, unlock_cost_credits: 10, ats_safe: true, structure_schema: {} },
  { name: "Critical Path", slug: "critical-path", industry_category: "Project Management", is_premium: true, unlock_cost_credits: 10, ats_safe: false, structure_schema: {} },
  { name: "Public Record", slug: "public-record", industry_category: "Government & Public Sector", is_premium: true, unlock_cost_credits: 10, ats_safe: true, structure_schema: {} },

  // -------------------------------------------------------------------------
  // Template library PR3 — 54 new templates. See the PR description for the
  // full per-template distinctness rationale (skeleton + content, not just
  // style tokens) and the category breadth rationale (11 existing categories
  // get 2 new templates each; 10 new categories chosen for Nigerian/African
  // job-market relevance get 3-4 each).
  // -------------------------------------------------------------------------

  // Business
  { name: "Boardroom", slug: "business-boardroom", industry_category: "Business", is_premium: true, unlock_cost_credits: 10, ats_safe: atsSafeFor("business-boardroom"), structure_schema: structureSchemaFor("business-boardroom") },
  { name: "Memo", slug: "business-memo", industry_category: "Business", is_premium: false, unlock_cost_credits: 0, ats_safe: atsSafeFor("business-memo"), structure_schema: structureSchemaFor("business-memo") },
  // Administration
  { name: "Front Office", slug: "front-office", industry_category: "Administration", is_premium: true, unlock_cost_credits: 10, ats_safe: atsSafeFor("front-office"), structure_schema: structureSchemaFor("front-office") },
  { name: "Filing System", slug: "filing-system", industry_category: "Administration", is_premium: false, unlock_cost_credits: 0, ats_safe: atsSafeFor("filing-system"), structure_schema: structureSchemaFor("filing-system") },
  // Technology
  { name: "Stack Trace", slug: "stack-trace", industry_category: "Technology", is_premium: true, unlock_cost_credits: 10, ats_safe: atsSafeFor("stack-trace"), structure_schema: structureSchemaFor("stack-trace") },
  { name: "Terminal", slug: "terminal", industry_category: "Technology", is_premium: false, unlock_cost_credits: 0, ats_safe: atsSafeFor("terminal"), structure_schema: structureSchemaFor("terminal") },
  // Design
  { name: "Showcase", slug: "design-showcase", industry_category: "Design", is_premium: true, unlock_cost_credits: 10, ats_safe: atsSafeFor("design-showcase"), structure_schema: structureSchemaFor("design-showcase") },
  { name: "Studio Brief", slug: "studio-brief", industry_category: "Design", is_premium: false, unlock_cost_credits: 0, ats_safe: atsSafeFor("studio-brief"), structure_schema: structureSchemaFor("studio-brief") },
  // Customer Success
  { name: "Success Story", slug: "success-story", industry_category: "Customer Success", is_premium: true, unlock_cost_credits: 10, ats_safe: atsSafeFor("success-story"), structure_schema: structureSchemaFor("success-story") },
  { name: "Help Desk", slug: "help-desk", industry_category: "Customer Success", is_premium: false, unlock_cost_credits: 0, ats_safe: atsSafeFor("help-desk"), structure_schema: structureSchemaFor("help-desk") },
  // Banking & Finance
  { name: "Balance Sheet", slug: "balance-sheet", industry_category: "Banking & Finance", is_premium: true, unlock_cost_credits: 10, ats_safe: atsSafeFor("balance-sheet"), structure_schema: structureSchemaFor("balance-sheet") },
  { name: "Compliance Brief", slug: "compliance-brief", industry_category: "Banking & Finance", is_premium: false, unlock_cost_credits: 0, ats_safe: atsSafeFor("compliance-brief"), structure_schema: structureSchemaFor("compliance-brief") },
  // Sales & Marketing
  { name: "Pitch Deck", slug: "pitch-deck", industry_category: "Sales & Marketing", is_premium: true, unlock_cost_credits: 10, ats_safe: atsSafeFor("pitch-deck"), structure_schema: structureSchemaFor("pitch-deck") },
  { name: "Funnel", slug: "funnel", industry_category: "Sales & Marketing", is_premium: false, unlock_cost_credits: 0, ats_safe: atsSafeFor("funnel"), structure_schema: structureSchemaFor("funnel") },
  // Healthcare
  { name: "Rounds", slug: "rounds", industry_category: "Healthcare", is_premium: true, unlock_cost_credits: 10, ats_safe: atsSafeFor("rounds"), structure_schema: structureSchemaFor("rounds") },
  { name: "Care Plan", slug: "care-plan", industry_category: "Healthcare", is_premium: false, unlock_cost_credits: 0, ats_safe: atsSafeFor("care-plan"), structure_schema: structureSchemaFor("care-plan") },
  // Legal
  { name: "Legal Brief", slug: "legal-brief", industry_category: "Legal", is_premium: true, unlock_cost_credits: 10, ats_safe: atsSafeFor("legal-brief"), structure_schema: structureSchemaFor("legal-brief") },
  { name: "Chambers", slug: "chambers", industry_category: "Legal", is_premium: false, unlock_cost_credits: 0, ats_safe: atsSafeFor("chambers"), structure_schema: structureSchemaFor("chambers") },
  // Project Management
  { name: "Gantt", slug: "gantt", industry_category: "Project Management", is_premium: true, unlock_cost_credits: 10, ats_safe: atsSafeFor("gantt"), structure_schema: structureSchemaFor("gantt") },
  { name: "Sprint Board", slug: "sprint-board", industry_category: "Project Management", is_premium: false, unlock_cost_credits: 0, ats_safe: atsSafeFor("sprint-board"), structure_schema: structureSchemaFor("sprint-board") },
  // Government & Public Sector
  { name: "Gazette", slug: "gazette", industry_category: "Government & Public Sector", is_premium: true, unlock_cost_credits: 10, ats_safe: atsSafeFor("gazette"), structure_schema: structureSchemaFor("gazette") },
  { name: "Civic Record", slug: "civic-record", industry_category: "Government & Public Sector", is_premium: false, unlock_cost_credits: 0, ats_safe: atsSafeFor("civic-record"), structure_schema: structureSchemaFor("civic-record") },

  // Engineering (new category — see PR description)
  { name: "Blueprint", slug: "blueprint", industry_category: "Engineering", is_premium: false, unlock_cost_credits: 0, ats_safe: atsSafeFor("blueprint"), structure_schema: structureSchemaFor("blueprint") },
  { name: "Site Report", slug: "site-report", industry_category: "Engineering", is_premium: true, unlock_cost_credits: 10, ats_safe: atsSafeFor("site-report"), structure_schema: structureSchemaFor("site-report") },
  { name: "Specification", slug: "specification", industry_category: "Engineering", is_premium: true, unlock_cost_credits: 10, ats_safe: atsSafeFor("specification"), structure_schema: structureSchemaFor("specification") },
  { name: "Schematic", slug: "schematic", industry_category: "Engineering", is_premium: true, unlock_cost_credits: 10, ats_safe: atsSafeFor("schematic"), structure_schema: structureSchemaFor("schematic") },

  // Education & Academia (new category)
  { name: "Curriculum Vitae", slug: "curriculum-vitae", industry_category: "Education & Academia", is_premium: false, unlock_cost_credits: 0, ats_safe: atsSafeFor("curriculum-vitae"), structure_schema: structureSchemaFor("curriculum-vitae") },
  { name: "Lecture Notes", slug: "lecture-notes", industry_category: "Education & Academia", is_premium: true, unlock_cost_credits: 10, ats_safe: atsSafeFor("lecture-notes"), structure_schema: structureSchemaFor("lecture-notes") },
  { name: "Faculty Profile", slug: "faculty-profile", industry_category: "Education & Academia", is_premium: true, unlock_cost_credits: 10, ats_safe: atsSafeFor("faculty-profile"), structure_schema: structureSchemaFor("faculty-profile") },
  { name: "Research Record", slug: "research-record", industry_category: "Education & Academia", is_premium: true, unlock_cost_credits: 10, ats_safe: atsSafeFor("research-record"), structure_schema: structureSchemaFor("research-record") },

  // NGO & Development (new category)
  { name: "Field Mission", slug: "field-mission", industry_category: "NGO & Development", is_premium: false, unlock_cost_credits: 0, ats_safe: atsSafeFor("field-mission"), structure_schema: structureSchemaFor("field-mission") },
  { name: "Impact Report", slug: "impact-report", industry_category: "NGO & Development", is_premium: true, unlock_cost_credits: 10, ats_safe: atsSafeFor("impact-report"), structure_schema: structureSchemaFor("impact-report") },
  { name: "Grant Proposal", slug: "grant-proposal", industry_category: "NGO & Development", is_premium: true, unlock_cost_credits: 10, ats_safe: atsSafeFor("grant-proposal"), structure_schema: structureSchemaFor("grant-proposal") },

  // Creative & Media (new category)
  { name: "Byline", slug: "byline", industry_category: "Creative & Media", is_premium: false, unlock_cost_credits: 0, ats_safe: atsSafeFor("byline"), structure_schema: structureSchemaFor("byline") },
  { name: "Reel", slug: "reel", industry_category: "Creative & Media", is_premium: true, unlock_cost_credits: 10, ats_safe: atsSafeFor("reel"), structure_schema: structureSchemaFor("reel") },
  { name: "Press Kit", slug: "press-kit", industry_category: "Creative & Media", is_premium: true, unlock_cost_credits: 10, ats_safe: atsSafeFor("press-kit"), structure_schema: structureSchemaFor("press-kit") },

  // Agriculture & Agribusiness (new category)
  { name: "Harvest", slug: "harvest", industry_category: "Agriculture & Agribusiness", is_premium: false, unlock_cost_credits: 0, ats_safe: atsSafeFor("harvest"), structure_schema: structureSchemaFor("harvest") },
  { name: "Field Season", slug: "field-season", industry_category: "Agriculture & Agribusiness", is_premium: true, unlock_cost_credits: 10, ats_safe: atsSafeFor("field-season"), structure_schema: structureSchemaFor("field-season") },
  { name: "Value Chain", slug: "value-chain", industry_category: "Agriculture & Agribusiness", is_premium: true, unlock_cost_credits: 10, ats_safe: atsSafeFor("value-chain"), structure_schema: structureSchemaFor("value-chain") },

  // Oil & Gas / Energy (new category)
  { name: "Rig Report", slug: "rig-report", industry_category: "Oil & Gas / Energy", is_premium: false, unlock_cost_credits: 0, ats_safe: atsSafeFor("rig-report"), structure_schema: structureSchemaFor("rig-report") },
  { name: "Offshore", slug: "offshore", industry_category: "Oil & Gas / Energy", is_premium: true, unlock_cost_credits: 10, ats_safe: atsSafeFor("offshore"), structure_schema: structureSchemaFor("offshore") },
  { name: "Wellhead", slug: "wellhead", industry_category: "Oil & Gas / Energy", is_premium: true, unlock_cost_credits: 10, ats_safe: atsSafeFor("wellhead"), structure_schema: structureSchemaFor("wellhead") },

  // Telecommunications (new category)
  { name: "Network Ops", slug: "network-ops", industry_category: "Telecommunications", is_premium: false, unlock_cost_credits: 0, ats_safe: atsSafeFor("network-ops"), structure_schema: structureSchemaFor("network-ops") },
  { name: "Signal", slug: "signal", industry_category: "Telecommunications", is_premium: true, unlock_cost_credits: 10, ats_safe: atsSafeFor("signal"), structure_schema: structureSchemaFor("signal") },
  { name: "Uptime", slug: "uptime", industry_category: "Telecommunications", is_premium: true, unlock_cost_credits: 10, ats_safe: atsSafeFor("uptime"), structure_schema: structureSchemaFor("uptime") },

  // Construction & Real Estate (new category)
  { name: "Site Plan", slug: "site-plan", industry_category: "Construction & Real Estate", is_premium: false, unlock_cost_credits: 0, ats_safe: atsSafeFor("site-plan"), structure_schema: structureSchemaFor("site-plan") },
  { name: "Foundation", slug: "foundation", industry_category: "Construction & Real Estate", is_premium: true, unlock_cost_credits: 10, ats_safe: atsSafeFor("foundation"), structure_schema: structureSchemaFor("foundation") },
  { name: "Property Portfolio", slug: "property-portfolio", industry_category: "Construction & Real Estate", is_premium: true, unlock_cost_credits: 10, ats_safe: atsSafeFor("property-portfolio"), structure_schema: structureSchemaFor("property-portfolio") },

  // Hospitality & Travel (new category)
  { name: "Front Desk", slug: "front-desk", industry_category: "Hospitality & Travel", is_premium: false, unlock_cost_credits: 0, ats_safe: atsSafeFor("front-desk"), structure_schema: structureSchemaFor("front-desk") },
  { name: "Concierge", slug: "concierge", industry_category: "Hospitality & Travel", is_premium: true, unlock_cost_credits: 10, ats_safe: atsSafeFor("concierge"), structure_schema: structureSchemaFor("concierge") },
  { name: "Itinerary", slug: "itinerary", industry_category: "Hospitality & Travel", is_premium: true, unlock_cost_credits: 10, ats_safe: atsSafeFor("itinerary"), structure_schema: structureSchemaFor("itinerary") },

  // Logistics & Supply Chain (new category)
  { name: "Manifest", slug: "manifest", industry_category: "Logistics & Supply Chain", is_premium: false, unlock_cost_credits: 0, ats_safe: atsSafeFor("manifest"), structure_schema: structureSchemaFor("manifest") },
  { name: "Route Plan", slug: "route-plan", industry_category: "Logistics & Supply Chain", is_premium: true, unlock_cost_credits: 10, ats_safe: atsSafeFor("route-plan"), structure_schema: structureSchemaFor("route-plan") },
  { name: "Supply Chain", slug: "supply-chain", industry_category: "Logistics & Supply Chain", is_premium: true, unlock_cost_credits: 10, ats_safe: atsSafeFor("supply-chain"), structure_schema: structureSchemaFor("supply-chain") },
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
