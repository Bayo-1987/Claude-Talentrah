-- 0104 — resume_templates.ats_safe, and the first real structure_schema row.
--
-- ---------------------------------------------------------------------------
-- RENAMED FROM 0103 AFTER IT WAS APPLIED. The applied name does not match.
-- ---------------------------------------------------------------------------
--
-- This shipped as `0103_resume_template_ats_safety.sql` and collided with
-- `0103_people_list_permission.sql`, which landed on main from a separate PR
-- (#268) merged while this branch was still in flight. Renumbered to 0104 so
-- the directory reads in one order again; 0103_people_list_permission kept
-- its number since it was already merged to main first.
--
-- The rename came AFTER the apply to CI, so what is recorded server-side
-- still says 0103 and always will:
--
--     CI   dozaffzgqkbarxtlclsj   version 20260907083448   name 0103_resume_template_ats_safety
--
-- Not applied to production — this PR was still under review at rename time.
--
-- That CI mismatch is cosmetic and deliberate. Supabase keys schema_migrations
-- on `version`, the timestamp — not on the NNNN_ prefix — so nothing is
-- ambiguous, double-applied, or pending. Same precedent as 0061's own rename
-- after colliding with 0060_admin_identity.
--
-- DO NOT re-apply this file to "fix" the CI name. It would either no-op or
-- fail on the existing objects, and the record it would write is the thing
-- that is already correct.
--
-- Template library PR 2 of 3 (layout-skeleton + style-token system —
-- src/components/resume-builder/skeletons/). Two things land here:
--
-- 1. `ats_safe boolean not null default true`. A real, per-template claim
--    about whether a resume built on it survives a PDF round-trip in a sane
--    top-to-bottom reading order — no sidebar, no banded/graphic header, no
--    CSS grid splitting unrelated sections side by side. It is not read from
--    application code as a computed value; it is set once here per the
--    verified classification in
--    `src/components/resume-builder/templates/index.tsx`'s
--    `TEMPLATE_ATS_SAFETY` map (the seven skeletons' own values are proven in
--    `e2e/ats-safety.spec.ts` — real PDF generation, real
--    text extraction, real reading-order assertions; the six bespoke
--    components below were classified against their real DOM structure).
--    Defaulting new rows to `true` matches `single-column` — the ATS-safe,
--    no-sidebar shape — so a template ADDED without an explicit value here
--    reads as the safe default rather than silently claiming safety for an
--    unreviewed layout the wrong way around would.
--
-- 2. `structure_schema` for `clean-professional` — the one existing template
--    moved onto the new skeleton system this PR. This is the FIRST non-`{}`
--    value that column has ever held (confirmed against current `main`
--    before this migration was written: PR1 left it unused in application
--    code). The JSON here is the exact `TemplateConfig` shape
--    `skeletons/configs.ts`'s `CLEAN_PROFESSIONAL_CONFIG` exports — the shape
--    PR3's 54 new catalog rows are expected to follow so a template becomes a
--    migration + a JSON payload rather than a deploy. The two are asserted to
--    stay in sync by `tests/resume-builder/template-registry.test.ts` (it
--    reads this column and deep-compares it against the source constant),
--    not just by this comment.
--
-- Not a value a client can write: `resume_templates` has RLS enabled with no
-- update policy (0042's note applies unchanged), so `authenticated` cannot
-- touch either column regardless of the table-wide grant Supabase hands out.

alter table public.resume_templates
  add column if not exists ats_safe boolean not null default true;

update public.resume_templates set ats_safe = true  where slug = 'clean-professional';
update public.resume_templates set ats_safe = true  where slug = 'statute';
update public.resume_templates set ats_safe = true  where slug = 'public-record';
update public.resume_templates set ats_safe = false where slug = 'clinical';
update public.resume_templates set ats_safe = false where slug = 'critical-path';
update public.resume_templates set ats_safe = false where slug = 'portfolio-grid';
update public.resume_templates set ats_safe = false where slug = 'pipeline';
-- The four "known unstyled free" slugs (template-registry.test.ts) render as
-- clean-professional today — literally the same DOM — so they inherit its
-- value rather than the column default coincidentally agreeing with it.
update public.resume_templates set ats_safe = true  where slug in ('structured-admin', 'product-tech', 'field-notes', 'ledger');

-- Fail loudly rather than half-apply, same convention as 0042.
do $$
declare v_missing text;
begin
  select string_agg(slug, ', ') into v_missing
    from public.resume_templates
    where slug not in (
      'clean-professional','statute','public-record','clinical','critical-path',
      'portfolio-grid','pipeline','structured-admin','product-tech','field-notes','ledger'
    );
  if v_missing is not null then
    raise exception
      'ats_safe migration is missing an explicit classification for template(s): %. Add one above rather than leaving it on the column default.',
      v_missing;
  end if;
end
$$;

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
    "sectionOrder": ["experience", "education", "skills", "projects", "certifications"],
    "sectionLabels": {},
    "showLinksInHeader": false,
    "showSummary": true
  },
  "atsSafe": true
}'::jsonb
where slug = 'clean-professional';
