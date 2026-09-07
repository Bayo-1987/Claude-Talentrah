import type { TemplateConfig } from "./types";

/**
 * `clean-professional`'s configuration under the new system. Every token
 * value here was chosen to reproduce the pre-PR2 `ResumeDocument`'s literal
 * output exactly (see token-classes.ts's case-by-case comments) — this is
 * the "move exactly one of the seven onto the skeleton system, prove it's
 * lossless" config, not a redesign. `resume-document.tsx` renders this
 * through `SingleColumnSkeleton`, and
 * `tests/resume-builder/schema-widen-render-parity.test.tsx` (unmodified
 * from PR1) is the byte-for-byte proof.
 *
 * This is ALSO the row this PR writes into `resume_templates.structure_schema`
 * for the `clean-professional` slug (migration 0103) — the first real,
 * non-`{}` value that column has ever held, and the shape PR3's 54 new rows
 * are expected to follow.
 */
export const CLEAN_PROFESSIONAL_CONFIG: TemplateConfig = {
  skeleton: "single-column",
  styleTokens: {
    displayFont: "display",
    bodyFont: "body",
    accent: "rust",
    ruleWeight: "heavy",
    headingTreatment: "uppercase-tracked",
    density: "comfortable",
    nameScale: "lg",
    contactLayout: "inline",
  },
  content: {
    sectionOrder: ["experience", "education", "skills", "projects", "certifications"],
    sectionLabels: {},
    showLinksInHeader: false,
    showSummary: true,
  },
  atsSafe: true,
};

/**
 * One demonstration configuration per REMAINING skeleton (single-column's is
 * `CLEAN_PROFESSIONAL_CONFIG` above). These are not catalog rows — PR3 adds
 * the 54-row library; these exist so the skeleton system has something
 * concrete to render in its own tests (crash coverage, the ATS-safety PDF
 * proof, and manual/preview checking) without reaching into PR3's scope.
 *
 * `product-tech-preview` is the one the PR brief's "use a links-in-header
 * block meaningfully, not just structurally" requirement is proven against —
 * see its `showLinksInHeader: true` and the header-band skeleton's dedicated
 * links row.
 */
export const DEMO_CONFIGS: Record<string, TemplateConfig> = {
  "clean-professional-demo": CLEAN_PROFESSIONAL_CONFIG,

  "sidebar-left-demo": {
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
      sectionOrder: ["skills", "languages", "certifications", "experience", "education", "projects"],
      sectionLabels: {},
      showLinksInHeader: false,
      showSummary: true,
    },
    // A real left column of unrelated content (contact/skills/languages)
    // running beside the main column — see ats-safety.test.ts.
    atsSafe: false,
  },

  "rail-right-demo": {
    skeleton: "rail-right",
    styleTokens: {
      displayFont: "geometric",
      bodyFont: "humanist",
      accent: "rust",
      ruleWeight: "medium",
      headingTreatment: "uppercase-tracked",
      density: "comfortable",
      nameScale: "lg",
      contactLayout: "stacked",
    },
    content: {
      // skills/languages/certifications deliberately included so the rail
      // this skeleton adds actually carries content — see
      // ats-safety.test.ts, which caught an earlier version of this config
      // rendering an EMPTY rail (rail-right's own structural risk existed,
      // but nothing was in it to demonstrate it against a real PDF).
      sectionOrder: ["experience", "projects", "education", "skills", "certifications"],
      sectionLabels: { skills: "Tech Stack" },
      showLinksInHeader: false,
      showSummary: true,
    },
    atsSafe: false,
  },

  "product-tech-preview": {
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
      // A tech/product resume: what shipped matters more than a bare job
      // title list, and "Tech Stack" reads correctly for the audience where
      // "Skills" reads as a soft-skills list.
      sectionOrder: ["experience", "projects", "skills", "education", "certifications"],
      sectionLabels: { experience: "Shipped", skills: "Tech Stack", projects: "Side Projects" },
      // THE meaningful use of a links-in-header block the PR brief calls
      // for: portfolio/GitHub/LinkedIn sit directly under the name inside
      // the banded header, styled as a real row rather than one more line
      // buried at the bottom of the page.
      showLinksInHeader: true,
      showSummary: true,
    },
    atsSafe: false,
  },

  "timeline-demo": {
    skeleton: "timeline",
    styleTokens: {
      displayFont: "display",
      bodyFont: "body",
      accent: "rust",
      ruleWeight: "medium",
      headingTreatment: "uppercase-tracked",
      density: "comfortable",
      nameScale: "lg",
      contactLayout: "inline",
    },
    content: {
      sectionOrder: ["experience", "education", "skills", "projects", "certifications"],
      sectionLabels: { experience: "Track Record" },
      showLinksInHeader: false,
      showSummary: true,
    },
    // A single flowing column with a decorative rail down the margin — no
    // side-by-side unrelated content — see ats-safety.test.ts.
    atsSafe: true,
  },

  "compact-dense-demo": {
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
      sectionOrder: ["experience", "education", "skills", "certifications", "projects"],
      sectionLabels: {},
      showLinksInHeader: false,
      showSummary: true,
    },
    atsSafe: true,
  },

  "grid-modules-demo": {
    skeleton: "grid-modules",
    styleTokens: {
      displayFont: "modern-serif",
      bodyFont: "humanist",
      accent: "ink",
      ruleWeight: "heavy",
      headingTreatment: "uppercase-tracked",
      density: "comfortable",
      nameScale: "xl",
      contactLayout: "split",
    },
    content: {
      sectionOrder: ["projects", "experience", "skills", "education", "awards"],
      sectionLabels: { projects: "Selected Work" },
      showLinksInHeader: true,
      showSummary: true,
    },
    // Projects render as real CSS grid modules — reading order is not
    // top-to-bottom text flow. See ats-safety.test.ts.
    atsSafe: false,
  },
};
