-- 0158 (reissued — the original 0158_ats_safe_dm_sans_kerning_mitigation.sql
-- was deleted by this same PR's revert of the Sunbird design swap, and this
-- migration is what actually undoes ITS DATABASE EFFECT, which deleting the
-- file does not touch).
--
-- WHY THIS MIGRATION EXISTS AT ALL. Reverting PR #386 (design/sunbird-swap)
-- put `catalog-configs.ts` back to claiming `atsSafe: true` for these 16
-- templates in the TypeScript source — but a migration is apply-once: the
-- ORIGINAL 0158 already ran against every real database (production and the
-- shared dev/CI-hosted project both), so their `resume_templates` rows still
-- carry `ats_safe = false` / `structure_schema.atsSafe = false` regardless of
-- what the reverted code file now says. Deleting 0158's file stops it running
-- again on a FRESH database (a new ephemeral CI stack, for instance) — it
-- does nothing for a database that already ran it. Without this migration,
-- every real database drifts from the reverted code, which
-- tests/billing/catalog-migration-parity.test.ts caught immediately: a real,
-- reproducible test failure (`AssertionError: DB structure_schema has
-- drifted from CATALOG_TEMPLATE_CONFIGS for these slugs: [...]`), not a
-- hypothetical.
--
-- WHY IT IS SAFE TO SET ats_safe BACK TO true, NOT JUST A MECHANICAL UNDO.
-- Verified directly, not assumed: after the Editorial revert, `bodyFont:
-- "body"` resolves to `--font-source-sans` again (Editorial's body font),
-- not the DM Sans that caused the original corruption. Rendered all 16
-- affected slugs to real PDFs via `/dev/template-skeletons/<slug>` (the
-- same route+mechanism e2e/ats-safety.spec.ts uses) and extracted their text
-- with the same `pdf-parse` package `/api/resume/parse` uses, checking
-- specifically for the kind of mid-word space the DM Sans defect inserted
-- (verified against real fixture words containing the same "ti" glyph pair
-- the original investigation named — "migration", "Certified", "Solutions").
-- Every word came through intact on every slug; `e2e/ats-safety.spec.ts`
-- itself (which asserts full marker ORDER, not just presence, for every
-- config claiming `atsSafe: true`) passes 21/21 against this migration's own
-- claim. The root cause was DM Sans's specific font metrics, not a
-- Chromium-wide defect independent of typeface — it does not follow the
-- design system back to Editorial.
--
-- GENERATED, NOT HAND-TRANSCRIBED. Each `structure_schema` blob below is
-- `JSON.stringify(CATALOG_TEMPLATE_CONFIGS[slug])` (or
-- `CLEAN_PROFESSIONAL_CONFIG` for `clean-professional`, which is sourced
-- from `skeletons/configs.ts` rather than the catalog map — see
-- `src/lib/billing/catalog.ts`'s own comment on that exception), read
-- directly from the reverted TypeScript source rather than retyped by hand,
-- for the same reason `structureSchemaFor()` itself exists: a manually
-- copied JSON blob is exactly how this class of drift happens in the first
-- place.
--
-- Column-only, no schema change — both `ats_safe` and `structure_schema`
-- already exist (0104), same as the migration this reissues.

update public.resume_templates set ats_safe = true where slug = 'structured-admin';

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
  "atsSafe": true
}'::jsonb
where slug = 'structured-admin';

update public.resume_templates set ats_safe = true where slug = 'ledger';

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
  "atsSafe": true
}'::jsonb
where slug = 'ledger';

update public.resume_templates set ats_safe = true where slug = 'business-memo';

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

update public.resume_templates set ats_safe = true where slug = 'care-plan';

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
  "atsSafe": true
}'::jsonb
where slug = 'care-plan';

update public.resume_templates set ats_safe = true where slug = 'civic-record';

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
  "atsSafe": true
}'::jsonb
where slug = 'civic-record';

update public.resume_templates set ats_safe = true where slug = 'compliance-brief';

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
  "atsSafe": true
}'::jsonb
where slug = 'compliance-brief';

update public.resume_templates set ats_safe = true where slug = 'filing-system';

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
  "atsSafe": true
}'::jsonb
where slug = 'filing-system';

update public.resume_templates set ats_safe = true where slug = 'foundation';

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

update public.resume_templates set ats_safe = true where slug = 'gazette';

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
  "atsSafe": true
}'::jsonb
where slug = 'gazette';

update public.resume_templates set ats_safe = true where slug = 'harvest';

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

update public.resume_templates set ats_safe = true where slug = 'help-desk';

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
  "atsSafe": true
}'::jsonb
where slug = 'help-desk';

update public.resume_templates set ats_safe = true where slug = 'manifest';

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
  "atsSafe": true
}'::jsonb
where slug = 'manifest';

update public.resume_templates set ats_safe = true where slug = 'offshore';

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

update public.resume_templates set ats_safe = true where slug = 'rounds';

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
  "atsSafe": true
}'::jsonb
where slug = 'rounds';

update public.resume_templates set ats_safe = true where slug = 'specification';

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

-- clean-professional (sourced from CLEAN_PROFESSIONAL_CONFIG, skeletons/configs.ts)
update public.resume_templates set ats_safe = true where slug = 'clean-professional';

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
  "atsSafe": true
}'::jsonb
where slug = 'clean-professional';
