-- 0111 — layout-token retune for the 11 dedicated-persona slugs that were
-- still visual near-duplicates of a sibling on the same skeleton.
--
-- BACKGROUND. PRs #277/#279 gave 22 template slugs their own dedicated
-- persona (`src/lib/resume-builder/persona-for-slug.ts`), fixing CONTENT
-- distinctiveness for those slugs. It did nothing about LAYOUT: several
-- slugs shared a `skeleton` with `styleTokens` differing only in
-- `accent`/`ruleWeight` — subtle at thumbnail scale, per the founder. This
-- migration is the data-side half of the fix landed in
-- `src/components/resume-builder/skeletons/catalog-configs.ts` (see that
-- file's own "LAYOUT RETUNE PASS" header comment for the full reasoning per
-- slug); this file only updates the already-committed `structure_schema`
-- data to match.
--
-- WHY THIS IS NEEDED AT ALL. `structureSchemaFor()` (`src/lib/billing/
-- catalog.ts`) serializes a slug's WHOLE `TemplateConfig` — including
-- `styleTokens` — into `RESUME_TEMPLATES[].structure_schema`, and
-- `tests/billing/catalog-migration-parity.test.ts` deep-compares that
-- against migration 0105's frozen historical JSON. Retuning `styleTokens`
-- without a corrective migration would make every one of these 11 slugs
-- fail that comparison. Same pattern `0106_blueprint_certifications_label.sql`
-- already established for `blueprint`'s `sectionLabels` — this migration
-- does it again, this time for `styleTokens`, across 11 slugs at once
-- (including superseding `blueprint`'s own 0106 value, since this pass
-- retunes its `styleTokens` on top of 0106's `sectionLabels` fix — 0106's
-- `content` portion is unchanged and reproduced verbatim below).
--
-- Column-only, no schema change: `structure_schema` already exists (0104).
-- `tests/billing/catalog-migration-parity.test.ts` was updated alongside
-- this migration to check these 11 slugs against it instead of against
-- 0105's (now stale) original values.

update public.resume_templates
set structure_schema = '{
  "skeleton": "single-column",
  "styleTokens": {
    "displayFont": "condensed",
    "bodyFont": "humanist",
    "accent": "ink",
    "ruleWeight": "heavy",
    "headingTreatment": "uppercase-tracked",
    "density": "spacious",
    "nameScale": "xl",
    "contactLayout": "split"
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
      "certifications": "Professional Certifications",
      "projects": "Key Projects"
    },
    "showLinksInHeader": false,
    "showSummary": true
  },
  "atsSafe": true
}'::jsonb
where slug = 'blueprint';

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
  "atsSafe": true
}'::jsonb
where slug = 'business-memo';

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
  "atsSafe": true
}'::jsonb
where slug = 'harvest';

update public.resume_templates
set structure_schema = '{
  "skeleton": "single-column",
  "styleTokens": {
    "displayFont": "geometric",
    "bodyFont": "humanist",
    "accent": "ink",
    "ruleWeight": "double",
    "headingTreatment": "boxed",
    "density": "comfortable",
    "nameScale": "lg",
    "contactLayout": "split"
  },
  "content": {
    "sectionOrder": [
      "experience",
      "projects",
      "certifications",
      "education",
      "skills"
    ],
    "sectionLabels": {
      "certifications": "Safety Certifications"
    },
    "showLinksInHeader": false,
    "showSummary": true
  },
  "atsSafe": true
}'::jsonb
where slug = 'site-plan';

update public.resume_templates
set structure_schema = '{
  "skeleton": "header-band",
  "styleTokens": {
    "displayFont": "condensed",
    "bodyFont": "humanist",
    "accent": "ink",
    "ruleWeight": "medium",
    "headingTreatment": "small-caps",
    "density": "comfortable",
    "nameScale": "sm",
    "contactLayout": "inline"
  },
  "content": {
    "sectionOrder": [
      "experience",
      "projects",
      "skills",
      "education",
      "certifications"
    ],
    "sectionLabels": {
      "experience": "Shipped",
      "skills": "Tech Stack",
      "projects": "Side Projects"
    },
    "showLinksInHeader": true,
    "showSummary": true
  },
  "atsSafe": false
}'::jsonb
where slug = 'product-tech';

update public.resume_templates
set structure_schema = '{
  "skeleton": "compact-dense",
  "styleTokens": {
    "displayFont": "geometric",
    "bodyFont": "humanist",
    "accent": "ink",
    "ruleWeight": "heavy",
    "headingTreatment": "uppercase-tracked",
    "density": "compact",
    "nameScale": "md",
    "contactLayout": "split"
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
      "certifications": "Safety & HSE Certifications"
    },
    "showLinksInHeader": false,
    "showSummary": true
  },
  "atsSafe": true
}'::jsonb
where slug = 'rig-report';

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
  "atsSafe": true
}'::jsonb
where slug = 'specification';

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
  "atsSafe": true
}'::jsonb
where slug = 'foundation';

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
  "atsSafe": true
}'::jsonb
where slug = 'offshore';

update public.resume_templates
set structure_schema = '{
  "skeleton": "sidebar-left",
  "styleTokens": {
    "displayFont": "display",
    "bodyFont": "body",
    "accent": "ink",
    "ruleWeight": "double",
    "headingTreatment": "uppercase-tracked",
    "density": "comfortable",
    "nameScale": "lg",
    "contactLayout": "split"
  },
  "content": {
    "sectionOrder": [
      "skills",
      "certifications",
      "languages",
      "experience",
      "education",
      "publications",
      "projects"
    ],
    "sectionLabels": {},
    "showLinksInHeader": false,
    "showSummary": true
  },
  "atsSafe": false
}'::jsonb
where slug = 'chambers';

update public.resume_templates
set structure_schema = '{
  "skeleton": "grid-modules",
  "styleTokens": {
    "displayFont": "condensed",
    "bodyFont": "humanist",
    "accent": "ink",
    "ruleWeight": "hairline",
    "headingTreatment": "rule-under",
    "density": "spacious",
    "nameScale": "sm",
    "contactLayout": "inline"
  },
  "content": {
    "sectionOrder": [
      "projects",
      "experience",
      "certifications",
      "skills",
      "education"
    ],
    "sectionLabels": {
      "projects": "Engineering Projects"
    },
    "showLinksInHeader": false,
    "showSummary": true
  },
  "atsSafe": false
}'::jsonb
where slug = 'schematic';
