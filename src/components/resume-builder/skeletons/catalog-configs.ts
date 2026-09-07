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

/** Technology. Header-band with a real links row — the config the PR2 brief's "links in header used meaningfully" requirement was written for, now actually sold as a template rather than only living as a dev-page demo. */
const PRODUCT_TECH_CONFIG: TemplateConfig = {
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

/** Business. Single-column, achievement-first: projects (measurable wins) before education, the plain "read it straight through" alternative to Boardroom. */
const BUSINESS_MEMO_CONFIG: TemplateConfig = {
  skeleton: "single-column",
  styleTokens: {
    displayFont: "display",
    bodyFont: "body",
    accent: "rust",
    ruleWeight: "hairline",
    headingTreatment: "uppercase-tracked",
    density: "comfortable",
    nameScale: "md",
    contactLayout: "inline",
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

/** Legal. Sidebar-left, free — skills/certifications/languages beside a narrative main column, distinct shape from Legal Brief's dense single column. */
const CHAMBERS_CONFIG: TemplateConfig = {
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

/** Free. Single-column: professional certifications promoted, key projects listed plainly. */
const BLUEPRINT_CONFIG: TemplateConfig = {
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

/** Premium. Compact-dense, technical-skills-forward for a long specification/standards-heavy career. */
const SPECIFICATION_CONFIG: TemplateConfig = {
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
    sectionLabels: { skills: "Technical Skills" },
    showLinksInHeader: false,
    showSummary: true,
  },
  atsSafe: true,
};

/** Premium. Grid-modules — engineering projects as cards for a portfolio-forward engineer (structural renders, plant commissioning, etc.). */
const SCHEMATIC_CONFIG: TemplateConfig = {
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

/** Free. Single-column, field programmes as projects, certifications for GAP/organic standards. */
const HARVEST_CONFIG: TemplateConfig = {
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

/** Free. Compact-dense, safety/HSE certifications promoted directly under experience. */
const RIG_REPORT_CONFIG: TemplateConfig = {
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
    sectionOrder: ["experience", "certifications", "skills", "education", "projects"],
    sectionLabels: { certifications: "Safety & HSE Certifications" },
    showLinksInHeader: false,
    showSummary: true,
  },
  atsSafe: true,
};

/** Premium. Timeline. */
const OFFSHORE_CONFIG: TemplateConfig = {
  skeleton: "timeline",
  styleTokens: {
    displayFont: "geometric",
    bodyFont: "humanist",
    accent: "ink",
    ruleWeight: "heavy",
    headingTreatment: "uppercase-tracked",
    density: "comfortable",
    nameScale: "md",
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

/** Free. Single-column, safety certifications promoted, projects listed as built work. */
const SITE_PLAN_CONFIG: TemplateConfig = {
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
    sectionOrder: ["experience", "projects", "certifications", "education", "skills"],
    sectionLabels: { certifications: "Safety Certifications" },
    showLinksInHeader: false,
    showSummary: true,
  },
  atsSafe: true,
};

/** Premium. Timeline. */
const FOUNDATION_CONFIG: TemplateConfig = {
  skeleton: "timeline",
  styleTokens: {
    displayFont: "geometric",
    bodyFont: "humanist",
    accent: "ink",
    ruleWeight: "heavy",
    headingTreatment: "uppercase-tracked",
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
