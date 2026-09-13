-- 0158 — flip ats_safe to false for the 16 real catalog templates confirmed
-- to corrupt text under Sunbird's DM Sans, pending the real fix.
--
-- UPDATED to add a 16th slug, `clean-professional`, found after the other
-- 15 were already identified and this migration was first written:
-- `clean-professional` lives directly in `RESUME_TEMPLATES`
-- (src/lib/billing/catalog.ts), sourced from `CLEAN_PROFESSIONAL_CONFIG`
-- (skeletons/configs.ts) rather than `CATALOG_TEMPLATE_CONFIGS` — the query
-- that found the other 15 (`Object.keys(CATALOG_TEMPLATE_CONFIGS).filter(...)`)
-- structurally could not see it, since it isn't a member of that map. It is
-- a real, free, likely-default catalog template with the exact same
-- bodyFont:"body" + education-section exposure as the other 15.
--
-- BACKGROUND. send-197's Sunbird design-system swap (PR #386) moved the
-- app's body font from Source Sans 3 to DM Sans. Investigating a pre-existing
-- ats-safety.spec.ts failure in 5 of these slugs found a genuine Chromium/
-- Skia print-to-PDF text-extraction defect: certain glyph-pair advances
-- (confirmed on DM Sans's own "T"->"I" transition, and independently on
-- Barlow Condensed's "t"->"a"/"f"->"f"/"t"->"h"/"t"->"e" transitions)
-- render visually correct but get read back with a spurious inserted space
-- by pdf.js/pdf-parse (the same library src/api/resume/parse uses), because
-- the gap is numerically indistinguishable from the run's own real space
-- character. Confirmed NOT a line-wrap (single text item, one Y-coordinate,
-- `hasEOL: false`), NOT a font-authoring defect (both fonts' own GPOS
-- kern tables specify zero or a NEGATIVE — tightening — adjustment on every
-- corrupted pair, checked on the raw un-instanced variable font for DM
-- Sans specifically so per-weight variation isn't a confound), and NOT
-- fixable via `font-kerning`/`font-feature-settings` (tested directly on
-- real CI output — neither changes the corruption for either font).
--
-- ats-safety.spec.ts only samples one representative catalog slug per
-- skeleton (11 of 58), so it caught 3 of these 15
-- (`structured-admin`/`ledger`/`specification`); querying
-- `CATALOG_TEMPLATE_CONFIGS` directly for every slug with
-- `styleTokens.bodyFont === "body"` found all 15 real, sellable rows
-- exposed to the identical mechanism, 12 of which had never been tested at
-- all. The founder's call (see the PR #386 investigation thread): ship
-- Sunbird's DM Sans uniformly across the catalog rather than carve these 15
-- out onto a different typography, and be honest about the consequence —
-- these 15 lose their `ats_safe: true` claim until the real fix (verifying
-- each generated PDF's extracted text against source before granting the
-- badge, tracked as a separate follow-up) lands. This migration does NOT
-- change `styleTokens`, `content`, or any other part of these slugs'
-- configuration — DM Sans stays exactly as Sunbird set it. It changes
-- `atsSafe`/`ats_safe` only.
--
-- WHY THIS TOUCHES `structure_schema` TOO, NOT JUST THE `ats_safe` COLUMN.
-- `structureSchemaFor()` (`src/lib/billing/catalog.ts`) serializes a slug's
-- WHOLE `TemplateConfig` — `atsSafe` included, the same field this migration
-- changes — into `structure_schema`, and
-- `tests/billing/catalog-migration-parity.test.ts` deep-compares that
-- against a frozen historical migration per slug. Flipping `atsSafe` in
-- `catalog-configs.ts` without a corrective migration here would make that
-- comparison fail for all 16, clean-professional included (five of the
-- original 15 — `business-memo`, `harvest`, `specification`, `foundation`,
-- `offshore` — were already superseded once,
-- by `0111_persona_layout_token_retune.sql`; this migration supersedes 0111
-- for those five and 0105 directly for the other ten). Same pattern 0111
-- already established for a `styleTokens` retune, applied here to `atsSafe`.
-- `tests/billing/catalog-migration-parity.test.ts` was updated alongside
-- this migration to check all 16 slugs against it instead of their prior
-- source.
--
-- Column-only, no schema change: both `ats_safe` and `structure_schema`
-- already exist (0104).

update public.resume_templates set ats_safe = false where slug = 'structured-admin';

update public.resume_templates
set structure_schema = '{
  "skeleton": "single-column",
  "styleTokens": {
    "displayFont": "display",
    "bodyFont": "body",
    "accent": "ink",
    "ruleWeight": "medium",
    "headingTreatment": "uppercase-tracked",
    "density": "comfortable",
    "nameScale": "md",
    "contactLayout": "inline"
  },
  "content": {
    "sectionOrder": [
      "experience",
      "skills",
      "education",
      "certifications",
      "projects"
    ],
    "sectionLabels": {
      "skills": "Core Competencies"
    },
    "showLinksInHeader": false,
    "showSummary": true
  },
  "atsSafe": false
}'::jsonb
where slug = 'structured-admin';

update public.resume_templates set ats_safe = false where slug = 'ledger';

update public.resume_templates
set structure_schema = '{
  "skeleton": "timeline",
  "styleTokens": {
    "displayFont": "display",
    "bodyFont": "body",
    "accent": "ink",
    "ruleWeight": "double",
    "headingTreatment": "uppercase-tracked",
    "density": "comfortable",
    "nameScale": "lg",
    "contactLayout": "inline"
  },
  "content": {
    "sectionOrder": [
      "experience",
      "education",
      "certifications",
      "skills",
      "projects"
    ],
    "sectionLabels": {
      "experience": "Track Record",
      "certifications": "Licenses & Certifications"
    },
    "showLinksInHeader": false,
    "showSummary": true
  },
  "atsSafe": false
}'::jsonb
where slug = 'ledger';

update public.resume_templates set ats_safe = false where slug = 'business-memo';

update public.resume_templates
set structure_schema = '{
  "skeleton": "single-column",
  "styleTokens": {
    "displayFont": "modern-serif",
    "bodyFont": "body",
    "accent": "rust",
    "ruleWeight": "hairline",
    "headingTreatment": "rule-under",
    "density": "comfortable",
    "nameScale": "md",
    "contactLayout": "stacked"
  },
  "content": {
    "sectionOrder": [
      "experience",
      "projects",
      "education",
      "skills",
      "certifications"
    ],
    "sectionLabels": {},
    "showLinksInHeader": false,
    "showSummary": true
  },
  "atsSafe": false
}'::jsonb
where slug = 'business-memo';

update public.resume_templates set ats_safe = false where slug = 'filing-system';

update public.resume_templates
set structure_schema = '{
  "skeleton": "compact-dense",
  "styleTokens": {
    "displayFont": "display",
    "bodyFont": "body",
    "accent": "ink",
    "ruleWeight": "hairline",
    "headingTreatment": "uppercase-tracked",
    "density": "compact",
    "nameScale": "sm",
    "contactLayout": "inline"
  },
  "content": {
    "sectionOrder": [
      "experience",
      "education",
      "skills",
      "certifications",
      "projects"
    ],
    "sectionLabels": {
      "skills": "Office Skills"
    },
    "showLinksInHeader": false,
    "showSummary": true
  },
  "atsSafe": false
}'::jsonb
where slug = 'filing-system';

update public.resume_templates set ats_safe = false where slug = 'help-desk';

update public.resume_templates
set structure_schema = '{
  "skeleton": "single-column",
  "styleTokens": {
    "displayFont": "body",
    "bodyFont": "body",
    "accent": "ink",
    "ruleWeight": "hairline",
    "headingTreatment": "rule-under",
    "density": "comfortable",
    "nameScale": "md",
    "contactLayout": "inline"
  },
  "content": {
    "sectionOrder": [
      "experience",
      "skills",
      "certifications",
      "education",
      "projects"
    ],
    "sectionLabels": {
      "skills": "Support Tools"
    },
    "showLinksInHeader": false,
    "showSummary": true
  },
  "atsSafe": false
}'::jsonb
where slug = 'help-desk';

update public.resume_templates set ats_safe = false where slug = 'compliance-brief';

update public.resume_templates
set structure_schema = '{
  "skeleton": "single-column",
  "styleTokens": {
    "displayFont": "display",
    "bodyFont": "body",
    "accent": "ink",
    "ruleWeight": "medium",
    "headingTreatment": "uppercase-tracked",
    "density": "comfortable",
    "nameScale": "md",
    "contactLayout": "inline"
  },
  "content": {
    "sectionOrder": [
      "experience",
      "certifications",
      "education",
      "skills",
      "projects"
    ],
    "sectionLabels": {
      "certifications": "Regulatory Certifications"
    },
    "showLinksInHeader": false,
    "showSummary": true
  },
  "atsSafe": false
}'::jsonb
where slug = 'compliance-brief';

update public.resume_templates set ats_safe = false where slug = 'rounds';

update public.resume_templates
set structure_schema = '{
  "skeleton": "timeline",
  "styleTokens": {
    "displayFont": "display",
    "bodyFont": "body",
    "accent": "ink",
    "ruleWeight": "medium",
    "headingTreatment": "rule-under",
    "density": "comfortable",
    "nameScale": "md",
    "contactLayout": "stacked"
  },
  "content": {
    "sectionOrder": [
      "experience",
      "certifications",
      "education",
      "skills",
      "projects"
    ],
    "sectionLabels": {
      "experience": "Clinical Experience",
      "certifications": "Licenses"
    },
    "showLinksInHeader": false,
    "showSummary": true
  },
  "atsSafe": false
}'::jsonb
where slug = 'rounds';

update public.resume_templates set ats_safe = false where slug = 'care-plan';

update public.resume_templates
set structure_schema = '{
  "skeleton": "single-column",
  "styleTokens": {
    "displayFont": "body",
    "bodyFont": "body",
    "accent": "rust",
    "ruleWeight": "hairline",
    "headingTreatment": "uppercase-tracked",
    "density": "comfortable",
    "nameScale": "md",
    "contactLayout": "inline"
  },
  "content": {
    "sectionOrder": [
      "experience",
      "education",
      "certifications",
      "skills",
      "projects"
    ],
    "sectionLabels": {},
    "showLinksInHeader": false,
    "showSummary": true
  },
  "atsSafe": false
}'::jsonb
where slug = 'care-plan';

update public.resume_templates set ats_safe = false where slug = 'gazette';

update public.resume_templates
set structure_schema = '{
  "skeleton": "single-column",
  "styleTokens": {
    "displayFont": "display",
    "bodyFont": "body",
    "accent": "ink",
    "ruleWeight": "double",
    "headingTreatment": "uppercase-tracked",
    "density": "comfortable",
    "nameScale": "lg",
    "contactLayout": "stacked"
  },
  "content": {
    "sectionOrder": [
      "experience",
      "education",
      "certifications",
      "awards",
      "skills",
      "projects"
    ],
    "sectionLabels": {
      "experience": "Public Service Experience",
      "awards": "Honours & Awards"
    },
    "showLinksInHeader": false,
    "showSummary": true
  },
  "atsSafe": false
}'::jsonb
where slug = 'gazette';

update public.resume_templates set ats_safe = false where slug = 'civic-record';

update public.resume_templates
set structure_schema = '{
  "skeleton": "compact-dense",
  "styleTokens": {
    "displayFont": "display",
    "bodyFont": "body",
    "accent": "ink",
    "ruleWeight": "hairline",
    "headingTreatment": "uppercase-tracked",
    "density": "compact",
    "nameScale": "sm",
    "contactLayout": "inline"
  },
  "content": {
    "sectionOrder": [
      "experience",
      "education",
      "certifications",
      "skills",
      "projects"
    ],
    "sectionLabels": {},
    "showLinksInHeader": false,
    "showSummary": true
  },
  "atsSafe": false
}'::jsonb
where slug = 'civic-record';

update public.resume_templates set ats_safe = false where slug = 'specification';

update public.resume_templates
set structure_schema = '{
  "skeleton": "compact-dense",
  "styleTokens": {
    "displayFont": "modern-serif",
    "bodyFont": "body",
    "accent": "ink",
    "ruleWeight": "medium",
    "headingTreatment": "rule-under",
    "density": "compact",
    "nameScale": "md",
    "contactLayout": "stacked"
  },
  "content": {
    "sectionOrder": [
      "experience",
      "skills",
      "certifications",
      "education",
      "projects"
    ],
    "sectionLabels": {
      "skills": "Technical Skills"
    },
    "showLinksInHeader": false,
    "showSummary": true
  },
  "atsSafe": false
}'::jsonb
where slug = 'specification';

update public.resume_templates set ats_safe = false where slug = 'harvest';

update public.resume_templates
set structure_schema = '{
  "skeleton": "single-column",
  "styleTokens": {
    "displayFont": "humanist",
    "bodyFont": "body",
    "accent": "ink",
    "ruleWeight": "medium",
    "headingTreatment": "small-caps",
    "density": "compact",
    "nameScale": "sm",
    "contactLayout": "stacked"
  },
  "content": {
    "sectionOrder": [
      "experience",
      "projects",
      "education",
      "certifications",
      "skills"
    ],
    "sectionLabels": {
      "projects": "Field Programmes",
      "certifications": "Certifications (GAP, Organic)"
    },
    "showLinksInHeader": false,
    "showSummary": true
  },
  "atsSafe": false
}'::jsonb
where slug = 'harvest';

update public.resume_templates set ats_safe = false where slug = 'offshore';

update public.resume_templates
set structure_schema = '{
  "skeleton": "timeline",
  "styleTokens": {
    "displayFont": "geometric",
    "bodyFont": "body",
    "accent": "rust",
    "ruleWeight": "double",
    "headingTreatment": "boxed",
    "density": "comfortable",
    "nameScale": "xl",
    "contactLayout": "inline"
  },
  "content": {
    "sectionOrder": [
      "experience",
      "certifications",
      "education",
      "skills",
      "projects"
    ],
    "sectionLabels": {
      "certifications": "Safety & HSE Certifications"
    },
    "showLinksInHeader": false,
    "showSummary": true
  },
  "atsSafe": false
}'::jsonb
where slug = 'offshore';

update public.resume_templates set ats_safe = false where slug = 'foundation';

update public.resume_templates
set structure_schema = '{
  "skeleton": "timeline",
  "styleTokens": {
    "displayFont": "condensed",
    "bodyFont": "body",
    "accent": "ink",
    "ruleWeight": "heavy",
    "headingTreatment": "uppercase-tracked",
    "density": "comfortable",
    "nameScale": "md",
    "contactLayout": "stacked"
  },
  "content": {
    "sectionOrder": [
      "experience",
      "certifications",
      "education",
      "skills",
      "projects"
    ],
    "sectionLabels": {},
    "showLinksInHeader": false,
    "showSummary": true
  },
  "atsSafe": false
}'::jsonb
where slug = 'foundation';

update public.resume_templates set ats_safe = false where slug = 'manifest';

update public.resume_templates
set structure_schema = '{
  "skeleton": "single-column",
  "styleTokens": {
    "displayFont": "condensed",
    "bodyFont": "body",
    "accent": "ink",
    "ruleWeight": "medium",
    "headingTreatment": "uppercase-tracked",
    "density": "comfortable",
    "nameScale": "md",
    "contactLayout": "inline"
  },
  "content": {
    "sectionOrder": [
      "experience",
      "certifications",
      "skills",
      "education",
      "projects"
    ],
    "sectionLabels": {
      "certifications": "Logistics Certifications"
    },
    "showLinksInHeader": false,
    "showSummary": true
  },
  "atsSafe": false
}'::jsonb
where slug = 'manifest';

update public.resume_templates set ats_safe = false where slug = 'clean-professional';

update public.resume_templates
set structure_schema = '{
  "skeleton": "single-column",
  "styleTokens": {
    "displayFont": "display",
    "bodyFont": "body",
    "accent": "rust",
    "ruleWeight": "heavy",
    "headingTreatment": "uppercase-tracked",
    "density": "comfortable",
    "nameScale": "lg",
    "contactLayout": "inline"
  },
  "content": {
    "sectionOrder": [
      "experience",
      "education",
      "skills",
      "projects",
      "certifications"
    ],
    "sectionLabels": {},
    "showLinksInHeader": false,
    "showSummary": true
  },
  "atsSafe": false
}'::jsonb
where slug = 'clean-professional';
