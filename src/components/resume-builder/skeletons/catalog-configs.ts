import type { TemplateConfig } from "./types";

/**
 * Template library PR 3 of 3 — the 54-row library, plus real `structure_schema`
 * for the four slugs that shipped in PR2 free but unstyled (`structured-admin`,
 * `product-tech`, `field-notes`, `ledger`).
 *
 * ONE CONFIG PER SLUG, keyed here rather than duplicated as JSON. This is the
 * single source of truth `src/lib/billing/catalog.ts`'s `RESUME_TEMPLATES`
 * reads `ats_safe`/`structure_schema` from (mirroring exactly how
 * `CLEAN_PROFESSIONAL_CONFIG` already works, per that file's own header), and
 * the same source `supabase/migrations/0105_resume_template_library.sql`'s
 * literal JSON was generated from. `tests/billing/catalog-migration-parity.test.ts`
 * re-parses that migration file and deep-compares it against this map (via
 * `RESUME_TEMPLATES`) so the two cannot quietly drift apart the way
 * `structure_schema` already did once (see catalog.ts's header on the PR2 bug
 * this guards against).
 *
 * WHY NO CONFIG HERE INVENTS A NEW SKELETON OR A BESPOKE COMPONENT. The
 * PR2 brief is that a template is a migration plus a JSON payload — 65 rows
 * rendered through seven skeleton components, not 65 components. Every
 * section body below is one of `section-blocks.tsx`'s existing renderers via
 * `content.sectionOrder`; distinctness between templates comes from which
 * skeleton, which sections in which order, which labels, and the style-token
 * combination — never a new rendering path.
 *
 * ATS SAFETY: every config below inherits its skeleton's own already-verified
 * baseline UNCHANGED — `single-column`/`timeline`/`compact-dense` render
 * `content.sectionOrder` as one linear DOM sequence regardless of what that
 * order is, so permuting/relabeling sections cannot change their proven
 * true claim; `sidebar-left`/`rail-right`/`header-band`/`grid-modules` are
 * false unconditionally, for the structural reason each skeleton's own file
 * documents, regardless of which sections a config routes into the side
 * column/rail/band/grid. No config here does anything more exotic than that
 * (no config invents a new split), so no row below needed its own individual
 * PDF-extraction check beyond one representative per skeleton — see
 * `e2e/ats-safety.spec.ts` and the PR description for exactly which slugs got
 * the real check and why the rest can rely on the skeleton's own proof.
 */

// ---------------------------------------------------------------------------
// The four PR2 free-but-unstyled slugs, now real.
// ---------------------------------------------------------------------------

/**
 * LAYOUT RETUNE PASS (content unchanged; see this file's own comments below
 * on the specific configs this pass touched). PRs #277/#279 gave 22 slugs
 * their own dedicated persona (`persona-for-slug.ts`), which fixed CONTENT
 * distinctiveness but did nothing about LAYOUT: two templates sharing a
 * skeleton with `styleTokens` differing only in `accent`/`ruleWeight` read as
 * identical at thumbnail scale. Grouping all 58 configs here by `skeleton`
 * found several such clusters — some of them exact byte-for-byte
 * `styleTokens` ties across 2–6 slugs. The founder's priority: a slug that
 * already has its own dedicated persona AND is still a visual near-duplicate
 * of a sibling on the same skeleton is retuned first, since content is right
 * there but layout still reads as a copy. That intersection is exactly 11
 * slugs: `blueprint`, `business-memo`, `harvest`, `site-plan` (single-column,
 * a 6-way tie with `compliance-brief`/`structured-admin` left untouched —
 * lower priority, no dedicated persona), `product-tech` (header-band, a
 * 3-way tie with `pitch-deck`/`signal`), `rig-report`/`specification`
 * (compact-dense, a 4-way tie with `field-notes`/`terminal`),
 * `foundation`/`offshore` (timeline — BOTH sides of this one had a dedicated
 * persona), `chambers` (sidebar-left, tied with `faculty-profile`), and
 * `schematic` (grid-modules, near-tied with `stack-trace`/`uptime`). Path A
 * only, per the founder's decision: no new skeleton, no new `TemplateConfig`
 * field — every retune below stays inside `types.ts`'s existing token
 * vocabulary, and pushes past accent/ruleWeight into displayFont/bodyFont
 * pairing, headingTreatment, density, nameScale and contactLayout, since the
 * founder was explicit that an accent or rule change alone doesn't read as
 * different at thumbnail scale.
 *
 * WHY THIS ALSO NEEDED A MIGRATION. `structureSchemaFor()` (`src/lib/billing/
 * catalog.ts`) serializes a slug's WHOLE `TemplateConfig` — `styleTokens`
 * included — into `RESUME_TEMPLATES[].structure_schema`, and
 * `tests/billing/catalog-migration-parity.test.ts` deep-compares that against
 * migration 0105's frozen historical JSON for every slug not already listed
 * in its `STRUCTURE_SCHEMA_SUPERSEDED_BY_LATER_MIGRATION` set. Retuning
 * `styleTokens` here without a corrective migration would make that
 * comparison fail for all 11 slugs. See migration
 * `0110_persona_layout_token_retune.sql`, which does for these 11 exactly
 * what `0106_blueprint_certifications_label.sql` already did for blueprint's
 * `sectionLabels` — and supersedes 0106's own `structure_schema` value for
 * `blueprint`, since this pass changes its `styleTokens` on top of 0106's
 * `sectionLabels` correction.
 */

/** Administration. Single-column: an admin resume is read front-to-back by an office manager, not skimmed by section — no reason to reach for a split layout. */
const STRUCTURED_ADMIN_CONFIG: TemplateConfig = {
  skeleton: "single-column",
  styleTokens: {
    displayFont: "display",
    bodyFont: "body",
    accent: "ink",
    ruleWeight: "medium",
    headingTreatment: "uppercase-tracked",
    density: "comfortable",
    nameScale: "md",
    contactLayout: "inline",
  },
  content: {
    sectionOrder: ["experience", "skills", "education", "certifications", "projects"],
    sectionLabels: { skills: "Core Competencies" },
    showLinksInHeader: false,
    showSummary: true,
  },
  atsSafe: true,
};

/**
 * Technology. Header-band with a real links row — the config the PR2 brief's "links in header used meaningfully" requirement was written for, now actually sold as a template rather than only living as a dev-page demo.
 *
 * LAYOUT RETUNE: was byte-identical in `styleTokens` to `pitch-deck`/`signal`
 * (a 3-way tie: geometric/humanist/rust/none/uppercase-tracked/comfortable/
 * lg/split), and it's the one of the three with a dedicated persona
 * (`SOFTWARE_ENGINEER_RESUME`). NOTE: `header-band.tsx` renders its
 * full-bleed name band from `accent` alone and hardcodes the contact line's
 * className — `ruleWeight`/`contactLayout` are inert for this skeleton, so
 * the tokens that actually move pixels here are `displayFont` (condensed —
 * no other header-band config used it), `accent` (ink, which repaints the
 * whole band from the rust the rest of the skeleton shares — the single
 * biggest visible change), `headingTreatment` (small-caps) and `nameScale`
 * (`sm`, the smallest in this skeleton) for a minimal console register
 * instead of the wide rust-banded look the rest of the skeleton shares.
 */
const PRODUCT_TECH_CONFIG: TemplateConfig = {
  skeleton: "header-band",
  styleTokens: {
    displayFont: "condensed",
    bodyFont: "humanist",
    accent: "ink",
    ruleWeight: "medium",
    headingTreatment: "small-caps",
    density: "comfortable",
    nameScale: "sm",
    contactLayout: "inline",
  },
  content: {
    sectionOrder: ["experience", "projects", "skills", "education", "certifications"],
    sectionLabels: { experience: "Shipped", skills: "Tech Stack", projects: "Side Projects" },
    showLinksInHeader: true,
    showSummary: true,
  },
  atsSafe: false,
};

/** Customer Success. Compact-dense — a support career is usually many short roles/tools, not a handful of long narratives; tight density fits that shape without shrinking below legibility. */
const FIELD_NOTES_CONFIG: TemplateConfig = {
  skeleton: "compact-dense",
  styleTokens: {
    displayFont: "condensed",
    bodyFont: "condensed",
    accent: "ink",
    ruleWeight: "hairline",
    headingTreatment: "small-caps",
    density: "compact",
    nameScale: "sm",
    contactLayout: "inline",
  },
  content: {
    sectionOrder: ["experience", "skills", "certifications", "education", "projects"],
    sectionLabels: { experience: "Customer Impact", skills: "Tools & Platforms" },
    showLinksInHeader: false,
    showSummary: true,
  },
  atsSafe: true,
};

/** Banking & Finance. Timeline — a finance career reads as a track record, and the accent rail reinforces that without touching reading order (still ATS-safe). Double rule under the header for the same restrained, formal register statute already established for Legal. */
const LEDGER_CONFIG: TemplateConfig = {
  skeleton: "timeline",
  styleTokens: {
    displayFont: "display",
    bodyFont: "body",
    accent: "ink",
    ruleWeight: "double",
    headingTreatment: "uppercase-tracked",
    density: "comfortable",
    nameScale: "lg",
    contactLayout: "inline",
  },
  content: {
    sectionOrder: ["experience", "education", "certifications", "skills", "projects"],
    sectionLabels: { experience: "Track Record", certifications: "Licenses & Certifications" },
    showLinksInHeader: false,
    showSummary: true,
  },
  atsSafe: true,
};

// ---------------------------------------------------------------------------
// Existing categories — 2 new templates each (1 free + 1 premium), 22 total.
// ---------------------------------------------------------------------------

/** Business. Sidebar-left: an executive-track resume where skills/languages/certifications are reference facts a reader checks second, after the narrative. */
const BUSINESS_BOARDROOM_CONFIG: TemplateConfig = {
  skeleton: "sidebar-left",
  styleTokens: {
    displayFont: "modern-serif",
    bodyFont: "humanist",
    accent: "ink",
    ruleWeight: "hairline",
    headingTreatment: "rule-under",
    density: "comfortable",
    nameScale: "lg",
    contactLayout: "stacked",
  },
  content: {
    sectionOrder: ["skills", "certifications", "experience", "education", "projects"],
    sectionLabels: { experience: "Leadership Experience" },
    showLinksInHeader: false,
    showSummary: true,
  },
  atsSafe: false,
};

/**
 * Business. Single-column, achievement-first: projects (measurable wins)
 * before education, the plain "read it straight through" alternative to
 * Boardroom.
 *
 * LAYOUT RETUNE: was byte-identical in shape to `structured-admin`/`harvest`/
 * `compliance-brief`/`site-plan` up to accent+ruleWeight (all
 * display/body/uppercase-tracked/comfortable/md/inline). `business-memo` has
 * its own dedicated persona (`BUSINESS_OPERATIONS_MANAGER_RESUME`), so it's
 * one of the priority retunes: modern-serif/body (a pairing no other
 * single-column config used) + rule-under heading + stacked contact gives it
 * an editorial-memo register genuinely distinct from that cluster's plain
 * tracked-caps look, not just a different accent.
 */
const BUSINESS_MEMO_CONFIG: TemplateConfig = {
  skeleton: "single-column",
  styleTokens: {
    displayFont: "modern-serif",
    bodyFont: "body",
    accent: "rust",
    ruleWeight: "hairline",
    headingTreatment: "rule-under",
    density: "comfortable",
    nameScale: "md",
    contactLayout: "stacked",
  },
  content: {
    sectionOrder: ["experience", "projects", "education", "skills", "certifications"],
    sectionLabels: {},
    showLinksInHeader: false,
    showSummary: true,
  },
  atsSafe: true,
};

/** Administration. Rail-right: narrative on the left, a fact rail (skills/certifications) on the right — the mirror image of Structured Admin's single column, for an admin professional who wants their tool/software list visually separated. */
const FRONT_OFFICE_CONFIG: TemplateConfig = {
  skeleton: "rail-right",
  styleTokens: {
    displayFont: "humanist",
    bodyFont: "humanist",
    accent: "ink",
    ruleWeight: "medium",
    headingTreatment: "small-caps",
    density: "comfortable",
    nameScale: "md",
    contactLayout: "split",
  },
  content: {
    sectionOrder: ["experience", "education", "projects", "skills", "certifications"],
    sectionLabels: { skills: "Office Software" },
    showLinksInHeader: false,
    showSummary: true,
  },
  atsSafe: false,
};

/** Administration. Compact-dense — many short administrative postings fit on one page without shrinking past legibility. */
const FILING_SYSTEM_CONFIG: TemplateConfig = {
  skeleton: "compact-dense",
  styleTokens: {
    displayFont: "display",
    bodyFont: "body",
    accent: "ink",
    ruleWeight: "hairline",
    headingTreatment: "uppercase-tracked",
    density: "compact",
    nameScale: "sm",
    contactLayout: "inline",
  },
  content: {
    sectionOrder: ["experience", "education", "skills", "certifications", "projects"],
    sectionLabels: { skills: "Office Skills" },
    showLinksInHeader: false,
    showSummary: true,
  },
  atsSafe: true,
};

/** Technology. Grid-modules: projects rendered as real cards — for an engineer, shipped work is the qualification. */
const STACK_TRACE_CONFIG: TemplateConfig = {
  skeleton: "grid-modules",
  styleTokens: {
    displayFont: "geometric",
    bodyFont: "humanist",
    accent: "rust",
    ruleWeight: "medium",
    headingTreatment: "boxed",
    density: "comfortable",
    nameScale: "lg",
    contactLayout: "split",
  },
  content: {
    sectionOrder: ["projects", "experience", "skills", "education", "certifications"],
    sectionLabels: { projects: "Shipped Projects", skills: "Stack" },
    showLinksInHeader: true,
    showSummary: true,
  },
  atsSafe: false,
};

/** Technology. Compact-dense, condensed type for a long list of tools/languages without a sidebar. */
const TERMINAL_CONFIG: TemplateConfig = {
  skeleton: "compact-dense",
  styleTokens: {
    displayFont: "condensed",
    bodyFont: "condensed",
    accent: "ink",
    ruleWeight: "hairline",
    headingTreatment: "small-caps",
    density: "compact",
    nameScale: "sm",
    contactLayout: "inline",
  },
  content: {
    sectionOrder: ["experience", "projects", "skills", "education", "certifications"],
    sectionLabels: { skills: "Languages & Tools" },
    showLinksInHeader: false,
    showSummary: true,
  },
  atsSafe: true,
};

/** Design. Grid-modules, "Selected Work" first — the portfolio-led layout Design's own category is built for, distinct from the existing Portfolio Grid template (a bespoke masonry component) by being the skeleton-driven card grid instead. */
const DESIGN_SHOWCASE_CONFIG: TemplateConfig = {
  skeleton: "grid-modules",
  styleTokens: {
    displayFont: "modern-serif",
    bodyFont: "humanist",
    accent: "ink",
    ruleWeight: "heavy",
    headingTreatment: "boxed",
    density: "spacious",
    nameScale: "xl",
    contactLayout: "split",
  },
  content: {
    sectionOrder: ["projects", "experience", "skills", "education", "certifications"],
    sectionLabels: { projects: "Selected Work" },
    showLinksInHeader: true,
    showSummary: true,
  },
  atsSafe: false,
};

/** Design. Header-band, free — a banded header alternative to the grid for a design portfolio that wants a strong name treatment without a full project grid. */
const STUDIO_BRIEF_CONFIG: TemplateConfig = {
  skeleton: "header-band",
  styleTokens: {
    displayFont: "modern-serif",
    bodyFont: "humanist",
    accent: "rust",
    ruleWeight: "none",
    headingTreatment: "boxed",
    density: "comfortable",
    nameScale: "xl",
    contactLayout: "split",
  },
  content: {
    sectionOrder: ["experience", "projects", "skills", "education", "certifications"],
    sectionLabels: { projects: "Selected Work" },
    showLinksInHeader: true,
    showSummary: true,
  },
  atsSafe: false,
};

/** Customer Success. Timeline, wins-first ordering (certifications before education) distinct from Field Notes' dense tool-first ordering. */
const SUCCESS_STORY_CONFIG: TemplateConfig = {
  skeleton: "timeline",
  styleTokens: {
    displayFont: "display",
    bodyFont: "humanist",
    accent: "rust",
    ruleWeight: "medium",
    headingTreatment: "rule-under",
    density: "comfortable",
    nameScale: "lg",
    contactLayout: "inline",
  },
  content: {
    sectionOrder: ["experience", "certifications", "skills", "education", "projects"],
    sectionLabels: { experience: "Customer Wins" },
    showLinksInHeader: false,
    showSummary: true,
  },
  atsSafe: true,
};

/** Customer Success. Single-column, free — the plain restrained option next to Success Story's accented timeline. */
const HELP_DESK_CONFIG: TemplateConfig = {
  skeleton: "single-column",
  styleTokens: {
    displayFont: "body",
    bodyFont: "body",
    accent: "ink",
    ruleWeight: "hairline",
    headingTreatment: "rule-under",
    density: "comfortable",
    nameScale: "md",
    contactLayout: "inline",
  },
  content: {
    sectionOrder: ["experience", "skills", "certifications", "education", "projects"],
    sectionLabels: { skills: "Support Tools" },
    showLinksInHeader: false,
    showSummary: true,
  },
  atsSafe: true,
};

/** Banking & Finance. Sidebar-left, certifications/skills as reference facts beside a narrative main column — distinct shape from Ledger's single flowing timeline. */
const BALANCE_SHEET_CONFIG: TemplateConfig = {
  skeleton: "sidebar-left",
  styleTokens: {
    displayFont: "modern-serif",
    bodyFont: "body",
    accent: "ink",
    ruleWeight: "hairline",
    headingTreatment: "rule-under",
    density: "comfortable",
    nameScale: "md",
    contactLayout: "stacked",
  },
  content: {
    sectionOrder: ["skills", "certifications", "experience", "education", "projects"],
    sectionLabels: { certifications: "Professional Certifications" },
    showLinksInHeader: false,
    showSummary: true,
  },
  atsSafe: false,
};

/** Banking & Finance. Single-column, free, certifications promoted ahead of education — regulatory credentials are the first thing a compliance reviewer checks. */
const COMPLIANCE_BRIEF_CONFIG: TemplateConfig = {
  skeleton: "single-column",
  styleTokens: {
    displayFont: "display",
    bodyFont: "body",
    accent: "ink",
    ruleWeight: "medium",
    headingTreatment: "uppercase-tracked",
    density: "comfortable",
    nameScale: "md",
    contactLayout: "inline",
  },
  content: {
    sectionOrder: ["experience", "certifications", "education", "skills", "projects"],
    sectionLabels: { certifications: "Regulatory Certifications" },
    showLinksInHeader: false,
    showSummary: true,
  },
  atsSafe: true,
};

/** Sales & Marketing. Header-band, campaigns-as-projects with a links row for a portfolio of campaign case studies. */
const PITCH_DECK_CONFIG: TemplateConfig = {
  skeleton: "header-band",
  styleTokens: {
    displayFont: "geometric",
    bodyFont: "humanist",
    accent: "rust",
    ruleWeight: "none",
    headingTreatment: "uppercase-tracked",
    density: "comfortable",
    nameScale: "lg",
    contactLayout: "split",
  },
  content: {
    sectionOrder: ["experience", "projects", "skills", "education", "certifications"],
    sectionLabels: { experience: "Track Record", projects: "Campaigns" },
    showLinksInHeader: true,
    showSummary: true,
  },
  atsSafe: false,
};

/** Sales & Marketing. Rail-right, free — skills/languages as a checkable fact rail beside campaign narrative. */
const FUNNEL_CONFIG: TemplateConfig = {
  skeleton: "rail-right",
  styleTokens: {
    displayFont: "geometric",
    bodyFont: "humanist",
    accent: "rust",
    ruleWeight: "medium",
    headingTreatment: "uppercase-tracked",
    density: "comfortable",
    nameScale: "md",
    contactLayout: "inline",
  },
  content: {
    sectionOrder: ["experience", "projects", "education", "skills", "languages", "certifications"],
    sectionLabels: {},
    showLinksInHeader: false,
    showSummary: true,
  },
  atsSafe: false,
};

/** Healthcare. Timeline, licenses promoted directly after clinical experience — the two things a hiring nurse/clinician manager checks first, distinct from Care Plan's plain single column. */
const ROUNDS_CONFIG: TemplateConfig = {
  skeleton: "timeline",
  styleTokens: {
    displayFont: "display",
    bodyFont: "body",
    accent: "ink",
    ruleWeight: "medium",
    headingTreatment: "rule-under",
    density: "comfortable",
    nameScale: "md",
    contactLayout: "stacked",
  },
  content: {
    sectionOrder: ["experience", "certifications", "education", "skills", "projects"],
    sectionLabels: { experience: "Clinical Experience", certifications: "Licenses" },
    showLinksInHeader: false,
    showSummary: true,
  },
  atsSafe: true,
};

/** Healthcare. Single-column, free. */
const CARE_PLAN_CONFIG: TemplateConfig = {
  skeleton: "single-column",
  styleTokens: {
    displayFont: "body",
    bodyFont: "body",
    accent: "rust",
    ruleWeight: "hairline",
    headingTreatment: "uppercase-tracked",
    density: "comfortable",
    nameScale: "md",
    contactLayout: "inline",
  },
  content: {
    sectionOrder: ["experience", "education", "certifications", "skills", "projects"],
    sectionLabels: {},
    showLinksInHeader: false,
    showSummary: true,
  },
  atsSafe: true,
};

/** Legal. Compact-dense — a long legal career (multiple chambers/firms) plus publications fits on one restrained page. */
const LEGAL_BRIEF_CONFIG: TemplateConfig = {
  skeleton: "compact-dense",
  styleTokens: {
    displayFont: "modern-serif",
    bodyFont: "humanist",
    accent: "ink",
    ruleWeight: "hairline",
    headingTreatment: "small-caps",
    density: "compact",
    nameScale: "sm",
    contactLayout: "stacked",
  },
  content: {
    sectionOrder: ["experience", "education", "certifications", "publications", "skills", "projects"],
    sectionLabels: { experience: "Legal Experience", publications: "Publications & Speaking" },
    showLinksInHeader: false,
    showSummary: true,
  },
  atsSafe: true,
};

/**
 * Legal. Sidebar-left, free — skills/certifications/languages beside a narrative main column, distinct shape from Legal Brief's dense single column.
 *
 * LAYOUT RETUNE: was byte-identical in `styleTokens` to `faculty-profile`
 * (both modern-serif/humanist/ink/hairline/rule-under/comfortable/md/
 * stacked), and `chambers` is the one with a dedicated persona
 * (`CORPORATE_LEGAL_ASSOCIATE_RESUME`). NOTE: `sidebar-left.tsx` hardcodes
 * its header wrapper className (`"pb-4"`) rather than reading
 * `headerRuleClass(tokens.ruleWeight)` — `ruleWeight` is inert for this
 * skeleton, so `double` here is a no-op kept only for schema/DB parity, not a
 * claimed visual change. What actually differs from `faculty-profile`:
 * display/body (the app's own Newsreader/Source Sans pairing — used by no
 * other sidebar-left config), a tracked-caps heading (vs `faculty-profile`'s
 * underline rule), a bigger `lg` name and a `split` contact layout (both
 * genuinely rendered — `nameSizeClass`/`contactLineClass` read those tokens
 * directly) — a distinctly more formal, chambers-letterhead register.
 */
const CHAMBERS_CONFIG: TemplateConfig = {
  skeleton: "sidebar-left",
  styleTokens: {
    displayFont: "display",
    bodyFont: "body",
    accent: "ink",
    ruleWeight: "double",
    headingTreatment: "uppercase-tracked",
    density: "comfortable",
    nameScale: "lg",
    contactLayout: "split",
  },
  content: {
    sectionOrder: ["skills", "certifications", "languages", "experience", "education", "publications", "projects"],
    sectionLabels: {},
    showLinksInHeader: false,
    showSummary: true,
  },
  atsSafe: false,
};

/** Project Management. Timeline, certifications (PMP/Agile) promoted right after delivery history. */
const GANTT_CONFIG: TemplateConfig = {
  skeleton: "timeline",
  styleTokens: {
    displayFont: "geometric",
    bodyFont: "humanist",
    accent: "rust",
    ruleWeight: "medium",
    headingTreatment: "uppercase-tracked",
    density: "comfortable",
    nameScale: "lg",
    contactLayout: "inline",
  },
  content: {
    sectionOrder: ["experience", "certifications", "education", "skills", "projects"],
    sectionLabels: { experience: "Programs Delivered", certifications: "Certifications (PMP, Agile)" },
    showLinksInHeader: false,
    showSummary: true,
  },
  atsSafe: true,
};

/** Project Management. Grid-modules, free — delivered programs as cards, distinct structural shape from Gantt's flowing timeline. */
const SPRINT_BOARD_CONFIG: TemplateConfig = {
  skeleton: "grid-modules",
  styleTokens: {
    displayFont: "geometric",
    bodyFont: "humanist",
    accent: "ink",
    ruleWeight: "medium",
    headingTreatment: "boxed",
    density: "comfortable",
    nameScale: "md",
    contactLayout: "split",
  },
  content: {
    sectionOrder: ["projects", "experience", "skills", "education", "certifications"],
    sectionLabels: { projects: "Delivered Programs" },
    showLinksInHeader: false,
    showSummary: true,
  },
  atsSafe: false,
};

/** Government & Public Sector. Single-column, awards/honours surfaced — distinct from Public Record's label:value bespoke layout and from Civic Record's dense alternative below. */
const GAZETTE_CONFIG: TemplateConfig = {
  skeleton: "single-column",
  styleTokens: {
    displayFont: "display",
    bodyFont: "body",
    accent: "ink",
    ruleWeight: "double",
    headingTreatment: "uppercase-tracked",
    density: "comfortable",
    nameScale: "lg",
    contactLayout: "stacked",
  },
  content: {
    sectionOrder: ["experience", "education", "certifications", "awards", "skills", "projects"],
    sectionLabels: { experience: "Public Service Experience", awards: "Honours & Awards" },
    showLinksInHeader: false,
    showSummary: true,
  },
  atsSafe: true,
};

/** Government & Public Sector. Compact-dense, free. */
const CIVIC_RECORD_CONFIG: TemplateConfig = {
  skeleton: "compact-dense",
  styleTokens: {
    displayFont: "display",
    bodyFont: "body",
    accent: "ink",
    ruleWeight: "hairline",
    headingTreatment: "uppercase-tracked",
    density: "compact",
    nameScale: "sm",
    contactLayout: "inline",
  },
  content: {
    sectionOrder: ["experience", "education", "certifications", "skills", "projects"],
    sectionLabels: {},
    showLinksInHeader: false,
    showSummary: true,
  },
  atsSafe: true,
};

// ---------------------------------------------------------------------------
// New categories relevant to Nigerian/African job seekers — 32 templates.
// See the PR description for why these ten were chosen.
// ---------------------------------------------------------------------------

// --- Engineering (civil / mechanical / electrical — one broad discipline
// category, since there is no job-posting industry taxonomy to split against;
// see the PR description) — 4 templates, one per non-portfolio-overlapping
// skeleton plus a grid variant for project-led engineers. ---

/**
 * Free. Single-column: professional certifications promoted, key projects listed plainly.
 *
 * LAYOUT RETUNE: `blueprint` had its own dedicated persona
 * (`EPC_SITE_ENGINEER_RESUME`) but was byte-identical in `styleTokens`
 * (up to accent/ruleWeight) to `structured-admin`/`business-memo`/`harvest`/
 * `compliance-brief`/`site-plan` — a 6-way tie, the single biggest
 * near-duplicate cluster in the catalog. Condensed/humanist (a pairing no
 * other single-column config used) at a spacious density with an `xl` name
 * — the only `xl` name anywhere in this skeleton — reads as a genuinely
 * different, bolder document, not a recolored twin.
 */
const BLUEPRINT_CONFIG: TemplateConfig = {
  skeleton: "single-column",
  styleTokens: {
    displayFont: "condensed",
    bodyFont: "humanist",
    accent: "ink",
    ruleWeight: "heavy",
    headingTreatment: "uppercase-tracked",
    density: "spacious",
    nameScale: "xl",
    contactLayout: "split",
  },
  content: {
    sectionOrder: ["experience", "education", "certifications", "skills", "projects"],
    /*
     * "Professional Certifications", not "... (COREN)": naming a specific
     * real credentialing body (COREN, Nigeria's engineering licensing
     * council) reads as a factual claim about the demo content underneath
     * it, and the shared PREVIEW_SAMPLE_RESUME (a PM's CSPO + Product
     * School certs) can't back that claim up — it reads as wrong to anyone
     * who recognizes COREN, not as generic placeholder content. See
     * tests/resume-builder/catalog-configs-labels.test.ts for the
     * regression guard.
     */
    sectionLabels: { certifications: "Professional Certifications", projects: "Key Projects" },
    showLinksInHeader: false,
    showSummary: true,
  },
  atsSafe: true,
};

/** Premium. Timeline — field/site postings read as a career track record. */
const SITE_REPORT_CONFIG: TemplateConfig = {
  skeleton: "timeline",
  styleTokens: {
    displayFont: "geometric",
    bodyFont: "humanist",
    accent: "ink",
    ruleWeight: "medium",
    headingTreatment: "small-caps",
    density: "comfortable",
    nameScale: "md",
    contactLayout: "inline",
  },
  content: {
    sectionOrder: ["experience", "certifications", "education", "skills", "projects"],
    sectionLabels: { experience: "Field Experience", certifications: "Safety & Trade Certifications" },
    showLinksInHeader: false,
    showSummary: true,
  },
  atsSafe: true,
};

/**
 * Premium. Compact-dense, technical-skills-forward for a long specification/standards-heavy career.
 *
 * LAYOUT RETUNE: the other dedicated-persona member of the 4-way
 * compact-dense tie described on `rig-report` above
 * (`STRUCTURAL_DESIGN_ENGINEER_RESUME`). Modern-serif/body with an
 * underline-rule heading (no other compact-dense config used `rule-under` —
 * the family was entirely small-caps or tracked caps) plus a `stacked`
 * contact and the only other `md` name in this skeleton give it a precise,
 * drafted-document register distinct from `rig-report`'s bolder industrial
 * one and from the rest of the tied cluster.
 */
const SPECIFICATION_CONFIG: TemplateConfig = {
  skeleton: "compact-dense",
  styleTokens: {
    displayFont: "modern-serif",
    bodyFont: "body",
    accent: "ink",
    ruleWeight: "medium",
    headingTreatment: "rule-under",
    density: "compact",
    nameScale: "md",
    contactLayout: "stacked",
  },
  content: {
    sectionOrder: ["experience", "skills", "certifications", "education", "projects"],
    sectionLabels: { skills: "Technical Skills" },
    showLinksInHeader: false,
    showSummary: true,
  },
  atsSafe: true,
};

/**
 * Premium. Grid-modules — engineering projects as cards for a portfolio-forward engineer (structural renders, plant commissioning, etc.).
 *
 * LAYOUT RETUNE: was byte-identical in `styleTokens` to `stack-trace`, and
 * only an accent swap away from `uptime` too (all three geometric/humanist,
 * medium rule, boxed heading, comfortable/lg/split, differing at most by
 * accent) — and `schematic` is the one with a dedicated persona
 * (`ELECTRICAL_DESIGN_ENGINEER_RESUME`). Every grid-modules config used
 * `headingTreatment: "boxed"` and `contactLayout: "split"` — `sectionHeadingClass`/
 * `contactLineClass` (`token-classes.ts`) don't require that, so this is the
 * first to break both: condensed/humanist, a hairline rule, an underline-rule
 * heading, spacious density and the smallest name (`sm`, versus `lg`/`xl`
 * everywhere else in this skeleton) reads as a minimal technical-drawing
 * register, not a re-carded twin of `stack-trace`/`uptime`.
 */
const SCHEMATIC_CONFIG: TemplateConfig = {
  skeleton: "grid-modules",
  styleTokens: {
    displayFont: "condensed",
    bodyFont: "humanist",
    accent: "ink",
    ruleWeight: "hairline",
    headingTreatment: "rule-under",
    density: "spacious",
    nameScale: "sm",
    contactLayout: "inline",
  },
  content: {
    sectionOrder: ["projects", "experience", "certifications", "skills", "education"],
    sectionLabels: { projects: "Engineering Projects" },
    showLinksInHeader: false,
    showSummary: true,
  },
  atsSafe: false,
};

// --- Education & Academia — 4 templates. Chosen because Nigeria/Africa has a
// large formal education/academic-appointment job market (universities,
// polytechnics, research institutes, international scholarships this product
// already surfaces) with a genuinely different resume shape: education leads,
// publications are a first-class section, and a "CV" in the literal academic
// sense (long, complete record) is the norm rather than a one-page resume. ---

/** Free. Single-column, education-first ordering — the one structural change every academic template below shares and that no other category uses. */
const CURRICULUM_VITAE_CONFIG: TemplateConfig = {
  skeleton: "single-column",
  styleTokens: {
    displayFont: "modern-serif",
    bodyFont: "humanist",
    accent: "ink",
    ruleWeight: "hairline",
    headingTreatment: "rule-under",
    density: "comfortable",
    nameScale: "md",
    contactLayout: "stacked",
  },
  content: {
    sectionOrder: ["education", "experience", "publications", "certifications", "skills", "projects"],
    sectionLabels: { experience: "Teaching Experience", publications: "Publications" },
    showLinksInHeader: false,
    showSummary: true,
  },
  atsSafe: true,
};

/** Premium. Compact-dense, education-first, awards/grants included — for a long academic record. */
const LECTURE_NOTES_CONFIG: TemplateConfig = {
  skeleton: "compact-dense",
  styleTokens: {
    displayFont: "modern-serif",
    bodyFont: "humanist",
    accent: "ink",
    ruleWeight: "hairline",
    headingTreatment: "small-caps",
    density: "compact",
    nameScale: "sm",
    contactLayout: "stacked",
  },
  content: {
    sectionOrder: ["education", "experience", "publications", "awards", "skills", "projects", "certifications"],
    sectionLabels: { experience: "Academic Appointments", awards: "Honours & Grants" },
    showLinksInHeader: false,
    showSummary: true,
  },
  atsSafe: true,
};

/** Premium. Sidebar-left, education-first main column with a skills/languages/certifications sidebar — a faculty profile shape. */
const FACULTY_PROFILE_CONFIG: TemplateConfig = {
  skeleton: "sidebar-left",
  styleTokens: {
    displayFont: "modern-serif",
    bodyFont: "humanist",
    accent: "ink",
    ruleWeight: "hairline",
    headingTreatment: "rule-under",
    density: "comfortable",
    nameScale: "md",
    contactLayout: "stacked",
  },
  content: {
    sectionOrder: ["skills", "languages", "certifications", "education", "experience", "publications", "awards", "projects"],
    sectionLabels: {},
    showLinksInHeader: false,
    showSummary: true,
  },
  atsSafe: false,
};

/** Premium. Timeline, education-first, research positions and publications tracked chronologically. */
const RESEARCH_RECORD_CONFIG: TemplateConfig = {
  skeleton: "timeline",
  styleTokens: {
    displayFont: "modern-serif",
    bodyFont: "humanist",
    accent: "rust",
    ruleWeight: "medium",
    headingTreatment: "rule-under",
    density: "comfortable",
    nameScale: "md",
    contactLayout: "stacked",
  },
  content: {
    sectionOrder: ["education", "experience", "publications", "certifications", "skills", "projects"],
    sectionLabels: { experience: "Research Positions" },
    showLinksInHeader: false,
    showSummary: true,
  },
  atsSafe: true,
};

// --- NGO & Development — 3 templates. A large formal-sector employer of
// Nigerian/African graduates (UN agencies, INGOs, local development orgs) with
// a distinct resume shape: volunteering/programme work is core experience, not
// an afterthought, and "impact" (beneficiaries reached, programmes delivered)
// is the framing. ---

/** Free. Timeline — programme + volunteer experience read as one continuous track record. */
const FIELD_MISSION_CONFIG: TemplateConfig = {
  skeleton: "timeline",
  styleTokens: {
    displayFont: "humanist",
    bodyFont: "humanist",
    accent: "rust",
    ruleWeight: "medium",
    headingTreatment: "rule-under",
    density: "comfortable",
    nameScale: "md",
    contactLayout: "stacked",
  },
  content: {
    sectionOrder: ["experience", "volunteering", "education", "certifications", "skills", "projects"],
    sectionLabels: { experience: "Programme Experience", volunteering: "Volunteer & Community Work" },
    showLinksInHeader: false,
    showSummary: true,
  },
  atsSafe: true,
};

/** Premium. Single-column, programmes framed as "projects led" ahead of education. */
const IMPACT_REPORT_CONFIG: TemplateConfig = {
  skeleton: "single-column",
  styleTokens: {
    displayFont: "display",
    bodyFont: "humanist",
    accent: "rust",
    ruleWeight: "medium",
    headingTreatment: "uppercase-tracked",
    density: "comfortable",
    nameScale: "md",
    contactLayout: "inline",
  },
  content: {
    sectionOrder: ["experience", "volunteering", "projects", "education", "skills", "certifications"],
    sectionLabels: { experience: "Development Experience", projects: "Programmes Led" },
    showLinksInHeader: false,
    showSummary: true,
  },
  atsSafe: true,
};

/** Premium. Sidebar-left — skills/languages/certifications (donor-language fluency matters here) beside programme narrative. */
const GRANT_PROPOSAL_CONFIG: TemplateConfig = {
  skeleton: "sidebar-left",
  styleTokens: {
    displayFont: "humanist",
    bodyFont: "humanist",
    accent: "ink",
    ruleWeight: "hairline",
    headingTreatment: "rule-under",
    density: "comfortable",
    nameScale: "md",
    contactLayout: "stacked",
  },
  content: {
    sectionOrder: ["skills", "languages", "certifications", "experience", "volunteering", "education", "projects"],
    sectionLabels: {},
    showLinksInHeader: false,
    showSummary: true,
  },
  atsSafe: false,
};

// --- Creative & Media — 3 templates. Journalism, film/broadcast, content
// creation — a large and growing Nigerian creative-economy segment distinct
// from Design (visual/product design) in what it foregrounds: bylines and
// publications, not a project grid of visual work first. ---

/** Free. Single-column with a links row (portfolio/reel/socials) and bylines as a first-class section. */
const BYLINE_CONFIG: TemplateConfig = {
  skeleton: "single-column",
  styleTokens: {
    displayFont: "modern-serif",
    bodyFont: "humanist",
    accent: "rust",
    ruleWeight: "hairline",
    headingTreatment: "rule-under",
    density: "comfortable",
    nameScale: "lg",
    contactLayout: "split",
  },
  content: {
    sectionOrder: ["experience", "projects", "publications", "education", "skills", "certifications"],
    sectionLabels: { projects: "Selected Work", publications: "Bylines & Features" },
    showLinksInHeader: true,
    showSummary: true,
  },
  atsSafe: true,
};

/** Premium. Grid-modules — a reel/portfolio grid, the visual-work-first counterpart to Byline. */
const REEL_CONFIG: TemplateConfig = {
  skeleton: "grid-modules",
  styleTokens: {
    displayFont: "geometric",
    bodyFont: "humanist",
    accent: "rust",
    ruleWeight: "none",
    headingTreatment: "boxed",
    density: "spacious",
    nameScale: "xl",
    contactLayout: "split",
  },
  content: {
    sectionOrder: ["projects", "experience", "skills", "education", "certifications"],
    sectionLabels: { projects: "Portfolio Reel" },
    showLinksInHeader: true,
    showSummary: true,
  },
  atsSafe: false,
};

/** Premium. Header-band — a press-kit shape, press/features promoted as their own section. */
const PRESS_KIT_CONFIG: TemplateConfig = {
  skeleton: "header-band",
  styleTokens: {
    displayFont: "modern-serif",
    bodyFont: "humanist",
    accent: "ink",
    ruleWeight: "none",
    headingTreatment: "boxed",
    density: "comfortable",
    nameScale: "xl",
    contactLayout: "split",
  },
  content: {
    sectionOrder: ["experience", "projects", "publications", "skills", "education", "certifications"],
    sectionLabels: { publications: "Press & Features" },
    showLinksInHeader: true,
    showSummary: true,
  },
  atsSafe: false,
};

// --- Agriculture & Agribusiness — 3 templates. A major real employment
// sector across the continent (smallholder support, agribusiness, agtech)
// that no competitor category-list surfaces. ---

/**
 * Free. Single-column, field programmes as projects, certifications for GAP/organic standards.
 *
 * LAYOUT RETUNE: another member of the 6-way single-column tie described on
 * `blueprint` above, and also carrying its own dedicated persona
 * (`COMMERCIAL_AGRONOMIST_RESUME`). Humanist/body, small-caps headings, a
 * `compact` density (no other single-column config used anything but
 * `comfortable`) and a small `sm` name give it a tighter, practical
 * field-report register distinct from the rest of that cluster on five
 * dimensions at once, not just accent/rule.
 */
const HARVEST_CONFIG: TemplateConfig = {
  skeleton: "single-column",
  styleTokens: {
    displayFont: "humanist",
    bodyFont: "body",
    accent: "ink",
    ruleWeight: "medium",
    headingTreatment: "small-caps",
    density: "compact",
    nameScale: "sm",
    contactLayout: "stacked",
  },
  content: {
    sectionOrder: ["experience", "projects", "education", "certifications", "skills"],
    sectionLabels: { projects: "Field Programmes", certifications: "Certifications (GAP, Organic)" },
    showLinksInHeader: false,
    showSummary: true,
  },
  atsSafe: true,
};

/** Premium. Timeline — seasonal/field-season postings read as a career track record. */
const FIELD_SEASON_CONFIG: TemplateConfig = {
  skeleton: "timeline",
  styleTokens: {
    displayFont: "humanist",
    bodyFont: "humanist",
    accent: "ink",
    ruleWeight: "medium",
    headingTreatment: "small-caps",
    density: "comfortable",
    nameScale: "md",
    contactLayout: "inline",
  },
  content: {
    sectionOrder: ["experience", "certifications", "education", "skills", "projects"],
    sectionLabels: {},
    showLinksInHeader: false,
    showSummary: true,
  },
  atsSafe: true,
};

/** Premium. Rail-right — skills/certifications/languages as a fact rail beside value-chain project narrative. */
const VALUE_CHAIN_CONFIG: TemplateConfig = {
  skeleton: "rail-right",
  styleTokens: {
    displayFont: "humanist",
    bodyFont: "humanist",
    accent: "ink",
    ruleWeight: "medium",
    headingTreatment: "uppercase-tracked",
    density: "comfortable",
    nameScale: "md",
    contactLayout: "inline",
  },
  content: {
    sectionOrder: ["experience", "projects", "education", "skills", "certifications", "languages"],
    sectionLabels: {},
    showLinksInHeader: false,
    showSummary: true,
  },
  atsSafe: false,
};

// --- Oil & Gas / Energy — 3 templates. A major hard-currency-adjacent
// Nigerian employment sector with its own credential norms (HSE/safety
// certifications are the first thing a recruiter checks). ---

/**
 * Free. Compact-dense, safety/HSE certifications promoted directly under experience.
 *
 * LAYOUT RETUNE: was byte-identical in `styleTokens` to `field-notes`/
 * `specification`/`terminal` (a 4-way tie, all condensed/condensed/ink/
 * hairline/small-caps/compact/sm/inline), and carries its own dedicated
 * persona (`DRILLING_RIG_SUPERVISOR_RESUME`). Geometric/humanist, a heavy
 * header rule, tracked-caps headings, a `split` contact layout (no other
 * compact-dense config used `split`) and the ONLY `md` name in this
 * skeleton's whole 9-member family give it a bolder, more industrial
 * register than the rest of that cluster.
 */
const RIG_REPORT_CONFIG: TemplateConfig = {
  skeleton: "compact-dense",
  styleTokens: {
    displayFont: "geometric",
    bodyFont: "humanist",
    accent: "ink",
    ruleWeight: "heavy",
    headingTreatment: "uppercase-tracked",
    density: "compact",
    nameScale: "md",
    contactLayout: "split",
  },
  content: {
    sectionOrder: ["experience", "certifications", "skills", "education", "projects"],
    sectionLabels: { certifications: "Safety & HSE Certifications" },
    showLinksInHeader: false,
    showSummary: true,
  },
  atsSafe: true,
};

/**
 * Premium. Timeline.
 *
 * LAYOUT RETUNE: the other side of the `foundation` tie described above —
 * geometric/body (no other timeline config used this exact pairing) with a
 * `double` rule, a `boxed` heading treatment (unused anywhere else in this
 * skeleton — the rest is tracked caps, small-caps or rule-under) and an `xl`
 * name for a bolder, industrial-process register distinct from
 * `foundation`'s condensed/stacked look.
 */
const OFFSHORE_CONFIG: TemplateConfig = {
  skeleton: "timeline",
  styleTokens: {
    displayFont: "geometric",
    bodyFont: "body",
    accent: "rust",
    ruleWeight: "double",
    headingTreatment: "boxed",
    density: "comfortable",
    nameScale: "xl",
    contactLayout: "inline",
  },
  content: {
    sectionOrder: ["experience", "certifications", "education", "skills", "projects"],
    sectionLabels: { certifications: "Safety & HSE Certifications" },
    showLinksInHeader: false,
    showSummary: true,
  },
  atsSafe: true,
};

/** Premium. Sidebar-left — certifications/skills/languages as reference facts beside a field-experience narrative. */
const WELLHEAD_CONFIG: TemplateConfig = {
  skeleton: "sidebar-left",
  styleTokens: {
    displayFont: "geometric",
    bodyFont: "humanist",
    accent: "ink",
    ruleWeight: "medium",
    headingTreatment: "uppercase-tracked",
    density: "comfortable",
    nameScale: "md",
    contactLayout: "stacked",
  },
  content: {
    sectionOrder: ["certifications", "skills", "languages", "experience", "education", "projects"],
    sectionLabels: {},
    showLinksInHeader: false,
    showSummary: true,
  },
  atsSafe: false,
};

// --- Telecommunications — 3 templates. A large, fast-growing employer
// segment (MTN/Airtel/Glo-scale operators, network vendors, telecom-adjacent
// tech) distinct enough from generic Technology to warrant its own category. ---

/** Free. Single-column. */
const NETWORK_OPS_CONFIG: TemplateConfig = {
  skeleton: "single-column",
  styleTokens: {
    displayFont: "geometric",
    bodyFont: "humanist",
    accent: "ink",
    ruleWeight: "medium",
    headingTreatment: "uppercase-tracked",
    density: "comfortable",
    nameScale: "md",
    contactLayout: "inline",
  },
  content: {
    sectionOrder: ["experience", "projects", "skills", "certifications", "education"],
    sectionLabels: {},
    showLinksInHeader: false,
    showSummary: true,
  },
  atsSafe: true,
};

/** Premium. Header-band with a links row. */
const SIGNAL_CONFIG: TemplateConfig = {
  skeleton: "header-band",
  styleTokens: {
    displayFont: "geometric",
    bodyFont: "humanist",
    accent: "rust",
    ruleWeight: "none",
    headingTreatment: "uppercase-tracked",
    density: "comfortable",
    nameScale: "lg",
    contactLayout: "split",
  },
  content: {
    sectionOrder: ["experience", "projects", "skills", "education", "certifications"],
    sectionLabels: {},
    showLinksInHeader: true,
    showSummary: true,
  },
  atsSafe: false,
};

/** Premium. Grid-modules — network/rollout projects as cards. */
const UPTIME_CONFIG: TemplateConfig = {
  skeleton: "grid-modules",
  styleTokens: {
    displayFont: "geometric",
    bodyFont: "humanist",
    accent: "ink",
    ruleWeight: "medium",
    headingTreatment: "boxed",
    density: "comfortable",
    nameScale: "lg",
    contactLayout: "split",
  },
  content: {
    sectionOrder: ["projects", "experience", "skills", "certifications", "education"],
    sectionLabels: { projects: "Network Projects" },
    showLinksInHeader: false,
    showSummary: true,
  },
  atsSafe: false,
};

// --- Construction & Real Estate — 3 templates. ---

/**
 * Free. Single-column, safety certifications promoted, projects listed as built work.
 *
 * LAYOUT RETUNE: the fourth member of the 6-way single-column tie described
 * on `blueprint` above, and it also carries its own dedicated persona
 * (`LAND_SURVEYOR_RESUME`). Geometric/humanist plus a `boxed` heading
 * treatment (no other single-column config used `boxed` — every heading in
 * this skeleton was plain tracked caps or an underline rule) reads as a
 * survey-plan/technical-drawing register the rest of the cluster doesn't
 * touch.
 */
const SITE_PLAN_CONFIG: TemplateConfig = {
  skeleton: "single-column",
  styleTokens: {
    displayFont: "geometric",
    bodyFont: "humanist",
    accent: "ink",
    ruleWeight: "double",
    headingTreatment: "boxed",
    density: "comfortable",
    nameScale: "lg",
    contactLayout: "split",
  },
  content: {
    sectionOrder: ["experience", "projects", "certifications", "education", "skills"],
    sectionLabels: { certifications: "Safety Certifications" },
    showLinksInHeader: false,
    showSummary: true,
  },
  atsSafe: true,
};

/**
 * Premium. Timeline.
 *
 * LAYOUT RETUNE: was byte-identical in `styleTokens` to `offshore` below —
 * the only 2-way tie in the whole catalog where BOTH sides already carry
 * their own dedicated persona (`GEOTECHNICAL_ENGINEER_RESUME` here,
 * `OFFSHORE_PROCESS_ENGINEER_RESUME` there), so both needed retuning, away
 * from each other as well as from the rest of the timeline skeleton.
 * Condensed/body (a pairing no other timeline config used) keeps the heavy
 * rule and tracked-caps heading but moves to a `stacked` contact — genuinely
 * different from `offshore`'s new geometric/body/boxed-heading/xl-name
 * combination below.
 */
const FOUNDATION_CONFIG: TemplateConfig = {
  skeleton: "timeline",
  styleTokens: {
    displayFont: "condensed",
    bodyFont: "body",
    accent: "ink",
    ruleWeight: "heavy",
    headingTreatment: "uppercase-tracked",
    density: "comfortable",
    nameScale: "md",
    contactLayout: "stacked",
  },
  content: {
    sectionOrder: ["experience", "certifications", "education", "skills", "projects"],
    sectionLabels: {},
    showLinksInHeader: false,
    showSummary: true,
  },
  atsSafe: true,
};

/** Premium. Grid-modules — developments/builds as portfolio cards. */
const PROPERTY_PORTFOLIO_CONFIG: TemplateConfig = {
  skeleton: "grid-modules",
  styleTokens: {
    displayFont: "modern-serif",
    bodyFont: "humanist",
    accent: "ink",
    ruleWeight: "heavy",
    headingTreatment: "boxed",
    density: "comfortable",
    nameScale: "lg",
    contactLayout: "split",
  },
  content: {
    sectionOrder: ["projects", "experience", "certifications", "education", "skills"],
    sectionLabels: { projects: "Developments" },
    showLinksInHeader: false,
    showSummary: true,
  },
  atsSafe: false,
};

// --- Hospitality & Travel — 3 templates. Languages are a first-class,
// promoted section here (guest-facing multilingual ability is a real
// differentiator), which no other category promotes this consistently. ---

/** Free. Single-column, languages promoted directly after experience. */
const FRONT_DESK_CONFIG: TemplateConfig = {
  skeleton: "single-column",
  styleTokens: {
    displayFont: "humanist",
    bodyFont: "humanist",
    accent: "rust",
    ruleWeight: "hairline",
    headingTreatment: "rule-under",
    density: "comfortable",
    nameScale: "md",
    contactLayout: "inline",
  },
  content: {
    sectionOrder: ["experience", "languages", "skills", "education", "certifications", "projects"],
    sectionLabels: { skills: "Guest Service Skills" },
    showLinksInHeader: false,
    showSummary: true,
  },
  atsSafe: true,
};

/** Premium. Rail-right — skills/languages/certifications as a fact rail. */
const CONCIERGE_CONFIG: TemplateConfig = {
  skeleton: "rail-right",
  styleTokens: {
    displayFont: "modern-serif",
    bodyFont: "humanist",
    accent: "rust",
    ruleWeight: "hairline",
    headingTreatment: "rule-under",
    density: "comfortable",
    nameScale: "md",
    contactLayout: "stacked",
  },
  content: {
    sectionOrder: ["experience", "education", "projects", "skills", "languages", "certifications"],
    sectionLabels: {},
    showLinksInHeader: false,
    showSummary: true,
  },
  atsSafe: false,
};

/** Premium. Compact-dense, languages promoted — for a long multi-property/seasonal hospitality career. */
const ITINERARY_CONFIG: TemplateConfig = {
  skeleton: "compact-dense",
  styleTokens: {
    displayFont: "humanist",
    bodyFont: "humanist",
    accent: "rust",
    ruleWeight: "hairline",
    headingTreatment: "small-caps",
    density: "compact",
    nameScale: "sm",
    contactLayout: "inline",
  },
  content: {
    sectionOrder: ["experience", "languages", "skills", "education", "projects", "certifications"],
    sectionLabels: {},
    showLinksInHeader: false,
    showSummary: true,
  },
  atsSafe: true,
};

// --- Logistics & Supply Chain — 3 templates. A large formal-sector employer
// (freight, warehousing, last-mile/e-commerce fulfilment) growing fast across
// Nigerian cities. ---

/** Free. Single-column, logistics certifications promoted. */
const MANIFEST_CONFIG: TemplateConfig = {
  skeleton: "single-column",
  styleTokens: {
    displayFont: "condensed",
    bodyFont: "body",
    accent: "ink",
    ruleWeight: "medium",
    headingTreatment: "uppercase-tracked",
    density: "comfortable",
    nameScale: "md",
    contactLayout: "inline",
  },
  content: {
    sectionOrder: ["experience", "certifications", "skills", "education", "projects"],
    sectionLabels: { certifications: "Logistics Certifications" },
    showLinksInHeader: false,
    showSummary: true,
  },
  atsSafe: true,
};

/** Premium. Timeline. */
const ROUTE_PLAN_CONFIG: TemplateConfig = {
  skeleton: "timeline",
  styleTokens: {
    displayFont: "condensed",
    bodyFont: "humanist",
    accent: "ink",
    ruleWeight: "medium",
    headingTreatment: "small-caps",
    density: "comfortable",
    nameScale: "md",
    contactLayout: "inline",
  },
  content: {
    sectionOrder: ["experience", "certifications", "education", "skills", "projects"],
    sectionLabels: {},
    showLinksInHeader: false,
    showSummary: true,
  },
  atsSafe: true,
};

/** Premium. Sidebar-left — certifications/skills/languages beside a narrative main column. */
const SUPPLY_CHAIN_CONFIG: TemplateConfig = {
  skeleton: "sidebar-left",
  styleTokens: {
    displayFont: "condensed",
    bodyFont: "humanist",
    accent: "ink",
    ruleWeight: "hairline",
    headingTreatment: "small-caps",
    density: "comfortable",
    nameScale: "md",
    contactLayout: "stacked",
  },
  content: {
    sectionOrder: ["certifications", "skills", "languages", "experience", "education", "projects"],
    sectionLabels: {},
    showLinksInHeader: false,
    showSummary: true,
  },
  atsSafe: false,
};

/**
 * slug -> config, for every row PR3 touches: the 4 fixed PR2 fallback slugs
 * plus the 54 new templates. `clean-professional` deliberately stays out of
 * this map — its config is `CLEAN_PROFESSIONAL_CONFIG` (configs.ts), and the
 * six other pre-PR2 slugs (`clinical`, `statute`, `critical-path`,
 * `public-record`, `portfolio-grid`, `pipeline`) are bespoke components, not
 * skeleton configs, so they have none.
 */
export const CATALOG_TEMPLATE_CONFIGS: Record<string, TemplateConfig> = {
  "structured-admin": STRUCTURED_ADMIN_CONFIG,
  "product-tech": PRODUCT_TECH_CONFIG,
  "field-notes": FIELD_NOTES_CONFIG,
  ledger: LEDGER_CONFIG,

  "business-boardroom": BUSINESS_BOARDROOM_CONFIG,
  "business-memo": BUSINESS_MEMO_CONFIG,
  "front-office": FRONT_OFFICE_CONFIG,
  "filing-system": FILING_SYSTEM_CONFIG,
  "stack-trace": STACK_TRACE_CONFIG,
  terminal: TERMINAL_CONFIG,
  "design-showcase": DESIGN_SHOWCASE_CONFIG,
  "studio-brief": STUDIO_BRIEF_CONFIG,
  "success-story": SUCCESS_STORY_CONFIG,
  "help-desk": HELP_DESK_CONFIG,
  "balance-sheet": BALANCE_SHEET_CONFIG,
  "compliance-brief": COMPLIANCE_BRIEF_CONFIG,
  "pitch-deck": PITCH_DECK_CONFIG,
  funnel: FUNNEL_CONFIG,
  rounds: ROUNDS_CONFIG,
  "care-plan": CARE_PLAN_CONFIG,
  "legal-brief": LEGAL_BRIEF_CONFIG,
  chambers: CHAMBERS_CONFIG,
  gantt: GANTT_CONFIG,
  "sprint-board": SPRINT_BOARD_CONFIG,
  gazette: GAZETTE_CONFIG,
  "civic-record": CIVIC_RECORD_CONFIG,

  blueprint: BLUEPRINT_CONFIG,
  "site-report": SITE_REPORT_CONFIG,
  specification: SPECIFICATION_CONFIG,
  schematic: SCHEMATIC_CONFIG,

  "curriculum-vitae": CURRICULUM_VITAE_CONFIG,
  "lecture-notes": LECTURE_NOTES_CONFIG,
  "faculty-profile": FACULTY_PROFILE_CONFIG,
  "research-record": RESEARCH_RECORD_CONFIG,

  "field-mission": FIELD_MISSION_CONFIG,
  "impact-report": IMPACT_REPORT_CONFIG,
  "grant-proposal": GRANT_PROPOSAL_CONFIG,

  byline: BYLINE_CONFIG,
  reel: REEL_CONFIG,
  "press-kit": PRESS_KIT_CONFIG,

  harvest: HARVEST_CONFIG,
  "field-season": FIELD_SEASON_CONFIG,
  "value-chain": VALUE_CHAIN_CONFIG,

  "rig-report": RIG_REPORT_CONFIG,
  offshore: OFFSHORE_CONFIG,
  wellhead: WELLHEAD_CONFIG,

  "network-ops": NETWORK_OPS_CONFIG,
  signal: SIGNAL_CONFIG,
  uptime: UPTIME_CONFIG,

  "site-plan": SITE_PLAN_CONFIG,
  foundation: FOUNDATION_CONFIG,
  "property-portfolio": PROPERTY_PORTFOLIO_CONFIG,

  "front-desk": FRONT_DESK_CONFIG,
  concierge: CONCIERGE_CONFIG,
  itinerary: ITINERARY_CONFIG,

  manifest: MANIFEST_CONFIG,
  "route-plan": ROUTE_PLAN_CONFIG,
  "supply-chain": SUPPLY_CHAIN_CONFIG,
};
