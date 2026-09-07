-- 0106 — `blueprint`'s certifications label loses a real body it can't back up.
--
-- 0105 shipped `blueprint`'s (Engineering, premium) sectionLabels with
-- "Professional Certifications (COREN)" — COREN is the real Nigerian
-- engineering licensing body. Every template previews against the same one
-- shared PREVIEW_SAMPLE_RESUME (src/lib/resume-builder/preview-sample.ts,
-- a product manager's "Certified Scrum Product Owner" and Product School
-- certificate) — naming COREN specifically makes a claim that content
-- cannot back up. It reads as wrong to anyone who recognizes the body, not
-- as generic placeholder copy. Caught live on the deployed gallery.
--
-- Not the same bug class as the other category labels that also name real
-- terms ("Certifications (PMP, Agile)", "Safety & HSE Certifications",
-- "Logistics Certifications", "Regulatory Certifications") — checked, none
-- of those name a specific chartering/licensing body the way COREN does, so
-- this is isolated to `blueprint`. `tests/resume-builder/
-- catalog-configs-labels.test.ts` is the standing guard against this
-- reappearing on a future slug.
--
-- Column-only, no schema change: `structure_schema` and `ats_safe` already
-- exist (0104). This updates the one row's already-committed data to match
-- `src/components/resume-builder/skeletons/catalog-configs.ts`'s corrected
-- BLUEPRINT_CONFIG, so `tests/billing/catalog-migration-parity.test.ts`
-- (0105's own guard against catalog.ts/migration drift) stays green rather
-- than being weakened to tolerate this one row disagreeing.
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
