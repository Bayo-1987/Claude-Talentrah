-- 0105 — Template library PR 3 of 3: 54 new resume_templates rows, and real
-- structure_schema for the 4 slugs that shipped in PR2 free but unstyled.
--
-- ---------------------------------------------------------------------------
-- WHERE THIS JSON CAME FROM. GENERATED, NOT HAND-TYPED.
-- ---------------------------------------------------------------------------
-- Every `ats_safe`/`structure_schema` value below was produced by running a
-- one-off script against this PR's own `src/lib/billing/catalog.ts`
-- (`RESUME_TEMPLATES`, which itself reads every value from
-- `src/components/resume-builder/skeletons/catalog-configs.ts`) and printing
-- the resulting SQL. That means this migration and `RESUME_TEMPLATES` started
-- from the same source and cannot have transcription errors between them on
-- the day this was written — but nothing stops the two from being hand-edited
-- apart LATER, which is exactly the bug class `structure_schema` already hit
-- once (see catalog.ts's own header on the PR2 incident this is the second
-- occurrence of). `tests/billing/catalog-migration-parity.test.ts` re-parses
-- this file's own SQL text and deep-compares it against `RESUME_TEMPLATES` on
-- every run, specifically so a future edit to one side alone fails loudly
-- instead of silently reintroducing the drift.
--
-- ---------------------------------------------------------------------------
-- WHY AN INSERT FOR THE 54 NEW ROWS, AND UPDATEs FOR THE 4 FIXED ONES.
-- ---------------------------------------------------------------------------
-- The 54 new templates do not exist yet on any database this migration is
-- applied to — `insert ... on conflict (slug) do nothing`, same idiom 0042
-- used for its own four new templates, so a re-run is a no-op rather than a
-- duplicate-slug error. `structured-admin`, `product-tech`, `field-notes` and
-- `ledger` already exist (0042) with `ats_safe` set true by 0104 (inherited
-- from the column default, which happened to be correct for their PRE-PR3
-- rendering — literally clean-professional's DOM) and `structure_schema` at
-- the column default `{}` — those four get UPDATEs, per-slug, the same shape
-- 0104 used for `clean-professional`'s own first real `structure_schema`.
--
-- `product-tech`'s `ats_safe` moves from `true` to `false` here. That is a
-- real reclassification, not a slip: it previously inherited `true` only
-- because its unstyled fallback rendered as `clean-professional`
-- (single-column, `ats_safe = true`). Its real PR3 layout uses `header-band`,
-- which is unconditionally `false` (see that skeleton's own file header) —
-- keeping the stale `true` after giving it a real banded-header layout would
-- be the exact kind of unverified ATS claim this column exists to prevent.
-- The other three keep `true`: their real PR3 layouts use `single-column`,
-- `compact-dense` and `timeline`, all of which are `true` baselines, and none
-- of their content configs restructures a skeleton's shape (see
-- `catalog-configs.ts`'s own header on why no config here needed an
-- individual PDF-extraction check beyond one representative per skeleton).
--
-- Not a value a client can write, same as 0104: `resume_templates` has RLS
-- enabled with no update policy, so `authenticated` cannot touch either
-- column regardless of the table-wide grant Supabase hands out.
--
-- Fail loudly rather than half-apply, same convention as 0042/0104.

insert into public.resume_templates
  (name, slug, industry_category, is_premium, unlock_cost_credits, ats_safe, structure_schema)
values
  ('Boardroom', 'business-boardroom', 'Business', true, 10, false, '{
  "skeleton": "sidebar-left",
  "styleTokens": {
    "displayFont": "modern-serif",
    "bodyFont": "humanist",
    "accent": "ink",
    "ruleWeight": "hairline",
    "headingTreatment": "rule-under",
    "density": "comfortable",
    "nameScale": "lg",
    "contactLayout": "stacked"
  },
  "content": {
    "sectionOrder": [
      "skills",
      "certifications",
      "experience",
      "education",
      "projects"
    ],
    "sectionLabels": {
      "experience": "Leadership Experience"
    },
    "showLinksInHeader": false,
    "showSummary": true
  },
  "atsSafe": false
}'::jsonb),
  ('Memo', 'business-memo', 'Business', false, 0, true, '{
  "skeleton": "single-column",
  "styleTokens": {
    "displayFont": "display",
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
}'::jsonb),
  ('Front Office', 'front-office', 'Administration', true, 10, false, '{
  "skeleton": "rail-right",
  "styleTokens": {
    "displayFont": "humanist",
    "bodyFont": "humanist",
    "accent": "ink",
    "ruleWeight": "medium",
    "headingTreatment": "small-caps",
    "density": "comfortable",
    "nameScale": "md",
    "contactLayout": "split"
  },
  "content": {
    "sectionOrder": [
      "experience",
      "education",
      "projects",
      "skills",
      "certifications"
    ],
    "sectionLabels": {
      "skills": "Office Software"
    },
    "showLinksInHeader": false,
    "showSummary": true
  },
  "atsSafe": false
}'::jsonb),
  ('Filing System', 'filing-system', 'Administration', false, 0, true, '{
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
}'::jsonb),
  ('Stack Trace', 'stack-trace', 'Technology', true, 10, false, '{
  "skeleton": "grid-modules",
  "styleTokens": {
    "displayFont": "geometric",
    "bodyFont": "humanist",
    "accent": "rust",
    "ruleWeight": "medium",
    "headingTreatment": "boxed",
    "density": "comfortable",
    "nameScale": "lg",
    "contactLayout": "split"
  },
  "content": {
    "sectionOrder": [
      "projects",
      "experience",
      "skills",
      "education",
      "certifications"
    ],
    "sectionLabels": {
      "projects": "Shipped Projects",
      "skills": "Stack"
    },
    "showLinksInHeader": true,
    "showSummary": true
  },
  "atsSafe": false
}'::jsonb),
  ('Terminal', 'terminal', 'Technology', false, 0, true, '{
  "skeleton": "compact-dense",
  "styleTokens": {
    "displayFont": "condensed",
    "bodyFont": "condensed",
    "accent": "ink",
    "ruleWeight": "hairline",
    "headingTreatment": "small-caps",
    "density": "compact",
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
      "skills": "Languages & Tools"
    },
    "showLinksInHeader": false,
    "showSummary": true
  },
  "atsSafe": true
}'::jsonb),
  ('Showcase', 'design-showcase', 'Design', true, 10, false, '{
  "skeleton": "grid-modules",
  "styleTokens": {
    "displayFont": "modern-serif",
    "bodyFont": "humanist",
    "accent": "ink",
    "ruleWeight": "heavy",
    "headingTreatment": "boxed",
    "density": "spacious",
    "nameScale": "xl",
    "contactLayout": "split"
  },
  "content": {
    "sectionOrder": [
      "projects",
      "experience",
      "skills",
      "education",
      "certifications"
    ],
    "sectionLabels": {
      "projects": "Selected Work"
    },
    "showLinksInHeader": true,
    "showSummary": true
  },
  "atsSafe": false
}'::jsonb),
  ('Studio Brief', 'studio-brief', 'Design', false, 0, false, '{
  "skeleton": "header-band",
  "styleTokens": {
    "displayFont": "modern-serif",
    "bodyFont": "humanist",
    "accent": "rust",
    "ruleWeight": "none",
    "headingTreatment": "boxed",
    "density": "comfortable",
    "nameScale": "xl",
    "contactLayout": "split"
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
      "projects": "Selected Work"
    },
    "showLinksInHeader": true,
    "showSummary": true
  },
  "atsSafe": false
}'::jsonb),
  ('Success Story', 'success-story', 'Customer Success', true, 10, true, '{
  "skeleton": "timeline",
  "styleTokens": {
    "displayFont": "display",
    "bodyFont": "humanist",
    "accent": "rust",
    "ruleWeight": "medium",
    "headingTreatment": "rule-under",
    "density": "comfortable",
    "nameScale": "lg",
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
      "experience": "Customer Wins"
    },
    "showLinksInHeader": false,
    "showSummary": true
  },
  "atsSafe": true
}'::jsonb),
  ('Help Desk', 'help-desk', 'Customer Success', false, 0, true, '{
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
}'::jsonb),
  ('Balance Sheet', 'balance-sheet', 'Banking & Finance', true, 10, false, '{
  "skeleton": "sidebar-left",
  "styleTokens": {
    "displayFont": "modern-serif",
    "bodyFont": "body",
    "accent": "ink",
    "ruleWeight": "hairline",
    "headingTreatment": "rule-under",
    "density": "comfortable",
    "nameScale": "md",
    "contactLayout": "stacked"
  },
  "content": {
    "sectionOrder": [
      "skills",
      "certifications",
      "experience",
      "education",
      "projects"
    ],
    "sectionLabels": {
      "certifications": "Professional Certifications"
    },
    "showLinksInHeader": false,
    "showSummary": true
  },
  "atsSafe": false
}'::jsonb),
  ('Compliance Brief', 'compliance-brief', 'Banking & Finance', false, 0, true, '{
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
}'::jsonb),
  ('Pitch Deck', 'pitch-deck', 'Sales & Marketing', true, 10, false, '{
  "skeleton": "header-band",
  "styleTokens": {
    "displayFont": "geometric",
    "bodyFont": "humanist",
    "accent": "rust",
    "ruleWeight": "none",
    "headingTreatment": "uppercase-tracked",
    "density": "comfortable",
    "nameScale": "lg",
    "contactLayout": "split"
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
      "experience": "Track Record",
      "projects": "Campaigns"
    },
    "showLinksInHeader": true,
    "showSummary": true
  },
  "atsSafe": false
}'::jsonb),
  ('Funnel', 'funnel', 'Sales & Marketing', false, 0, false, '{
  "skeleton": "rail-right",
  "styleTokens": {
    "displayFont": "geometric",
    "bodyFont": "humanist",
    "accent": "rust",
    "ruleWeight": "medium",
    "headingTreatment": "uppercase-tracked",
    "density": "comfortable",
    "nameScale": "md",
    "contactLayout": "inline"
  },
  "content": {
    "sectionOrder": [
      "experience",
      "projects",
      "education",
      "skills",
      "languages",
      "certifications"
    ],
    "sectionLabels": {},
    "showLinksInHeader": false,
    "showSummary": true
  },
  "atsSafe": false
}'::jsonb),
  ('Rounds', 'rounds', 'Healthcare', true, 10, true, '{
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
}'::jsonb),
  ('Care Plan', 'care-plan', 'Healthcare', false, 0, true, '{
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
}'::jsonb),
  ('Legal Brief', 'legal-brief', 'Legal', true, 10, true, '{
  "skeleton": "compact-dense",
  "styleTokens": {
    "displayFont": "modern-serif",
    "bodyFont": "humanist",
    "accent": "ink",
    "ruleWeight": "hairline",
    "headingTreatment": "small-caps",
    "density": "compact",
    "nameScale": "sm",
    "contactLayout": "stacked"
  },
  "content": {
    "sectionOrder": [
      "experience",
      "education",
      "certifications",
      "publications",
      "skills",
      "projects"
    ],
    "sectionLabels": {
      "experience": "Legal Experience",
      "publications": "Publications & Speaking"
    },
    "showLinksInHeader": false,
    "showSummary": true
  },
  "atsSafe": true
}'::jsonb),
  ('Chambers', 'chambers', 'Legal', false, 0, false, '{
  "skeleton": "sidebar-left",
  "styleTokens": {
    "displayFont": "modern-serif",
    "bodyFont": "humanist",
    "accent": "ink",
    "ruleWeight": "hairline",
    "headingTreatment": "rule-under",
    "density": "comfortable",
    "nameScale": "md",
    "contactLayout": "stacked"
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
}'::jsonb),
  ('Gantt', 'gantt', 'Project Management', true, 10, true, '{
  "skeleton": "timeline",
  "styleTokens": {
    "displayFont": "geometric",
    "bodyFont": "humanist",
    "accent": "rust",
    "ruleWeight": "medium",
    "headingTreatment": "uppercase-tracked",
    "density": "comfortable",
    "nameScale": "lg",
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
      "experience": "Programs Delivered",
      "certifications": "Certifications (PMP, Agile)"
    },
    "showLinksInHeader": false,
    "showSummary": true
  },
  "atsSafe": true
}'::jsonb),
  ('Sprint Board', 'sprint-board', 'Project Management', false, 0, false, '{
  "skeleton": "grid-modules",
  "styleTokens": {
    "displayFont": "geometric",
    "bodyFont": "humanist",
    "accent": "ink",
    "ruleWeight": "medium",
    "headingTreatment": "boxed",
    "density": "comfortable",
    "nameScale": "md",
    "contactLayout": "split"
  },
  "content": {
    "sectionOrder": [
      "projects",
      "experience",
      "skills",
      "education",
      "certifications"
    ],
    "sectionLabels": {
      "projects": "Delivered Programs"
    },
    "showLinksInHeader": false,
    "showSummary": true
  },
  "atsSafe": false
}'::jsonb),
  ('Gazette', 'gazette', 'Government & Public Sector', true, 10, true, '{
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
}'::jsonb),
  ('Civic Record', 'civic-record', 'Government & Public Sector', false, 0, true, '{
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
}'::jsonb),
  ('Blueprint', 'blueprint', 'Engineering', false, 0, true, '{
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
      "certifications": "Professional Certifications (COREN)",
      "projects": "Key Projects"
    },
    "showLinksInHeader": false,
    "showSummary": true
  },
  "atsSafe": true
}'::jsonb),
  ('Site Report', 'site-report', 'Engineering', true, 10, true, '{
  "skeleton": "timeline",
  "styleTokens": {
    "displayFont": "geometric",
    "bodyFont": "humanist",
    "accent": "ink",
    "ruleWeight": "medium",
    "headingTreatment": "small-caps",
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
      "experience": "Field Experience",
      "certifications": "Safety & Trade Certifications"
    },
    "showLinksInHeader": false,
    "showSummary": true
  },
  "atsSafe": true
}'::jsonb),
  ('Specification', 'specification', 'Engineering', true, 10, true, '{
  "skeleton": "compact-dense",
  "styleTokens": {
    "displayFont": "condensed",
    "bodyFont": "condensed",
    "accent": "ink",
    "ruleWeight": "hairline",
    "headingTreatment": "small-caps",
    "density": "compact",
    "nameScale": "sm",
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
      "skills": "Technical Skills"
    },
    "showLinksInHeader": false,
    "showSummary": true
  },
  "atsSafe": true
}'::jsonb),
  ('Schematic', 'schematic', 'Engineering', true, 10, false, '{
  "skeleton": "grid-modules",
  "styleTokens": {
    "displayFont": "geometric",
    "bodyFont": "humanist",
    "accent": "rust",
    "ruleWeight": "medium",
    "headingTreatment": "boxed",
    "density": "comfortable",
    "nameScale": "lg",
    "contactLayout": "split"
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
}'::jsonb),
  ('Curriculum Vitae', 'curriculum-vitae', 'Education & Academia', false, 0, true, '{
  "skeleton": "single-column",
  "styleTokens": {
    "displayFont": "modern-serif",
    "bodyFont": "humanist",
    "accent": "ink",
    "ruleWeight": "hairline",
    "headingTreatment": "rule-under",
    "density": "comfortable",
    "nameScale": "md",
    "contactLayout": "stacked"
  },
  "content": {
    "sectionOrder": [
      "education",
      "experience",
      "publications",
      "certifications",
      "skills",
      "projects"
    ],
    "sectionLabels": {
      "experience": "Teaching Experience",
      "publications": "Publications"
    },
    "showLinksInHeader": false,
    "showSummary": true
  },
  "atsSafe": true
}'::jsonb),
  ('Lecture Notes', 'lecture-notes', 'Education & Academia', true, 10, true, '{
  "skeleton": "compact-dense",
  "styleTokens": {
    "displayFont": "modern-serif",
    "bodyFont": "humanist",
    "accent": "ink",
    "ruleWeight": "hairline",
    "headingTreatment": "small-caps",
    "density": "compact",
    "nameScale": "sm",
    "contactLayout": "stacked"
  },
  "content": {
    "sectionOrder": [
      "education",
      "experience",
      "publications",
      "awards",
      "skills",
      "projects",
      "certifications"
    ],
    "sectionLabels": {
      "experience": "Academic Appointments",
      "awards": "Honours & Grants"
    },
    "showLinksInHeader": false,
    "showSummary": true
  },
  "atsSafe": true
}'::jsonb),
  ('Faculty Profile', 'faculty-profile', 'Education & Academia', true, 10, false, '{
  "skeleton": "sidebar-left",
  "styleTokens": {
    "displayFont": "modern-serif",
    "bodyFont": "humanist",
    "accent": "ink",
    "ruleWeight": "hairline",
    "headingTreatment": "rule-under",
    "density": "comfortable",
    "nameScale": "md",
    "contactLayout": "stacked"
  },
  "content": {
    "sectionOrder": [
      "skills",
      "languages",
      "certifications",
      "education",
      "experience",
      "publications",
      "awards",
      "projects"
    ],
    "sectionLabels": {},
    "showLinksInHeader": false,
    "showSummary": true
  },
  "atsSafe": false
}'::jsonb),
  ('Research Record', 'research-record', 'Education & Academia', true, 10, true, '{
  "skeleton": "timeline",
  "styleTokens": {
    "displayFont": "modern-serif",
    "bodyFont": "humanist",
    "accent": "rust",
    "ruleWeight": "medium",
    "headingTreatment": "rule-under",
    "density": "comfortable",
    "nameScale": "md",
    "contactLayout": "stacked"
  },
  "content": {
    "sectionOrder": [
      "education",
      "experience",
      "publications",
      "certifications",
      "skills",
      "projects"
    ],
    "sectionLabels": {
      "experience": "Research Positions"
    },
    "showLinksInHeader": false,
    "showSummary": true
  },
  "atsSafe": true
}'::jsonb),
  ('Field Mission', 'field-mission', 'NGO & Development', false, 0, true, '{
  "skeleton": "timeline",
  "styleTokens": {
    "displayFont": "humanist",
    "bodyFont": "humanist",
    "accent": "rust",
    "ruleWeight": "medium",
    "headingTreatment": "rule-under",
    "density": "comfortable",
    "nameScale": "md",
    "contactLayout": "stacked"
  },
  "content": {
    "sectionOrder": [
      "experience",
      "volunteering",
      "education",
      "certifications",
      "skills",
      "projects"
    ],
    "sectionLabels": {
      "experience": "Programme Experience",
      "volunteering": "Volunteer & Community Work"
    },
    "showLinksInHeader": false,
    "showSummary": true
  },
  "atsSafe": true
}'::jsonb),
  ('Impact Report', 'impact-report', 'NGO & Development', true, 10, true, '{
  "skeleton": "single-column",
  "styleTokens": {
    "displayFont": "display",
    "bodyFont": "humanist",
    "accent": "rust",
    "ruleWeight": "medium",
    "headingTreatment": "uppercase-tracked",
    "density": "comfortable",
    "nameScale": "md",
    "contactLayout": "inline"
  },
  "content": {
    "sectionOrder": [
      "experience",
      "volunteering",
      "projects",
      "education",
      "skills",
      "certifications"
    ],
    "sectionLabels": {
      "experience": "Development Experience",
      "projects": "Programmes Led"
    },
    "showLinksInHeader": false,
    "showSummary": true
  },
  "atsSafe": true
}'::jsonb),
  ('Grant Proposal', 'grant-proposal', 'NGO & Development', true, 10, false, '{
  "skeleton": "sidebar-left",
  "styleTokens": {
    "displayFont": "humanist",
    "bodyFont": "humanist",
    "accent": "ink",
    "ruleWeight": "hairline",
    "headingTreatment": "rule-under",
    "density": "comfortable",
    "nameScale": "md",
    "contactLayout": "stacked"
  },
  "content": {
    "sectionOrder": [
      "skills",
      "languages",
      "certifications",
      "experience",
      "volunteering",
      "education",
      "projects"
    ],
    "sectionLabels": {},
    "showLinksInHeader": false,
    "showSummary": true
  },
  "atsSafe": false
}'::jsonb),
  ('Byline', 'byline', 'Creative & Media', false, 0, true, '{
  "skeleton": "single-column",
  "styleTokens": {
    "displayFont": "modern-serif",
    "bodyFont": "humanist",
    "accent": "rust",
    "ruleWeight": "hairline",
    "headingTreatment": "rule-under",
    "density": "comfortable",
    "nameScale": "lg",
    "contactLayout": "split"
  },
  "content": {
    "sectionOrder": [
      "experience",
      "projects",
      "publications",
      "education",
      "skills",
      "certifications"
    ],
    "sectionLabels": {
      "projects": "Selected Work",
      "publications": "Bylines & Features"
    },
    "showLinksInHeader": true,
    "showSummary": true
  },
  "atsSafe": true
}'::jsonb),
  ('Reel', 'reel', 'Creative & Media', true, 10, false, '{
  "skeleton": "grid-modules",
  "styleTokens": {
    "displayFont": "geometric",
    "bodyFont": "humanist",
    "accent": "rust",
    "ruleWeight": "none",
    "headingTreatment": "boxed",
    "density": "spacious",
    "nameScale": "xl",
    "contactLayout": "split"
  },
  "content": {
    "sectionOrder": [
      "projects",
      "experience",
      "skills",
      "education",
      "certifications"
    ],
    "sectionLabels": {
      "projects": "Portfolio Reel"
    },
    "showLinksInHeader": true,
    "showSummary": true
  },
  "atsSafe": false
}'::jsonb),
  ('Press Kit', 'press-kit', 'Creative & Media', true, 10, false, '{
  "skeleton": "header-band",
  "styleTokens": {
    "displayFont": "modern-serif",
    "bodyFont": "humanist",
    "accent": "ink",
    "ruleWeight": "none",
    "headingTreatment": "boxed",
    "density": "comfortable",
    "nameScale": "xl",
    "contactLayout": "split"
  },
  "content": {
    "sectionOrder": [
      "experience",
      "projects",
      "publications",
      "skills",
      "education",
      "certifications"
    ],
    "sectionLabels": {
      "publications": "Press & Features"
    },
    "showLinksInHeader": true,
    "showSummary": true
  },
  "atsSafe": false
}'::jsonb),
  ('Harvest', 'harvest', 'Agriculture & Agribusiness', false, 0, true, '{
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
}'::jsonb),
  ('Field Season', 'field-season', 'Agriculture & Agribusiness', true, 10, true, '{
  "skeleton": "timeline",
  "styleTokens": {
    "displayFont": "humanist",
    "bodyFont": "humanist",
    "accent": "ink",
    "ruleWeight": "medium",
    "headingTreatment": "small-caps",
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
    "sectionLabels": {},
    "showLinksInHeader": false,
    "showSummary": true
  },
  "atsSafe": true
}'::jsonb),
  ('Value Chain', 'value-chain', 'Agriculture & Agribusiness', true, 10, false, '{
  "skeleton": "rail-right",
  "styleTokens": {
    "displayFont": "humanist",
    "bodyFont": "humanist",
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
      "projects",
      "education",
      "skills",
      "certifications",
      "languages"
    ],
    "sectionLabels": {},
    "showLinksInHeader": false,
    "showSummary": true
  },
  "atsSafe": false
}'::jsonb),
  ('Rig Report', 'rig-report', 'Oil & Gas / Energy', false, 0, true, '{
  "skeleton": "compact-dense",
  "styleTokens": {
    "displayFont": "condensed",
    "bodyFont": "condensed",
    "accent": "ink",
    "ruleWeight": "hairline",
    "headingTreatment": "small-caps",
    "density": "compact",
    "nameScale": "sm",
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
      "certifications": "Safety & HSE Certifications"
    },
    "showLinksInHeader": false,
    "showSummary": true
  },
  "atsSafe": true
}'::jsonb),
  ('Offshore', 'offshore', 'Oil & Gas / Energy', true, 10, true, '{
  "skeleton": "timeline",
  "styleTokens": {
    "displayFont": "geometric",
    "bodyFont": "humanist",
    "accent": "ink",
    "ruleWeight": "heavy",
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
      "certifications": "Safety & HSE Certifications"
    },
    "showLinksInHeader": false,
    "showSummary": true
  },
  "atsSafe": true
}'::jsonb),
  ('Wellhead', 'wellhead', 'Oil & Gas / Energy', true, 10, false, '{
  "skeleton": "sidebar-left",
  "styleTokens": {
    "displayFont": "geometric",
    "bodyFont": "humanist",
    "accent": "ink",
    "ruleWeight": "medium",
    "headingTreatment": "uppercase-tracked",
    "density": "comfortable",
    "nameScale": "md",
    "contactLayout": "stacked"
  },
  "content": {
    "sectionOrder": [
      "certifications",
      "skills",
      "languages",
      "experience",
      "education",
      "projects"
    ],
    "sectionLabels": {},
    "showLinksInHeader": false,
    "showSummary": true
  },
  "atsSafe": false
}'::jsonb),
  ('Network Ops', 'network-ops', 'Telecommunications', false, 0, true, '{
  "skeleton": "single-column",
  "styleTokens": {
    "displayFont": "geometric",
    "bodyFont": "humanist",
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
      "projects",
      "skills",
      "certifications",
      "education"
    ],
    "sectionLabels": {},
    "showLinksInHeader": false,
    "showSummary": true
  },
  "atsSafe": true
}'::jsonb),
  ('Signal', 'signal', 'Telecommunications', true, 10, false, '{
  "skeleton": "header-band",
  "styleTokens": {
    "displayFont": "geometric",
    "bodyFont": "humanist",
    "accent": "rust",
    "ruleWeight": "none",
    "headingTreatment": "uppercase-tracked",
    "density": "comfortable",
    "nameScale": "lg",
    "contactLayout": "split"
  },
  "content": {
    "sectionOrder": [
      "experience",
      "projects",
      "skills",
      "education",
      "certifications"
    ],
    "sectionLabels": {},
    "showLinksInHeader": true,
    "showSummary": true
  },
  "atsSafe": false
}'::jsonb),
  ('Uptime', 'uptime', 'Telecommunications', true, 10, false, '{
  "skeleton": "grid-modules",
  "styleTokens": {
    "displayFont": "geometric",
    "bodyFont": "humanist",
    "accent": "ink",
    "ruleWeight": "medium",
    "headingTreatment": "boxed",
    "density": "comfortable",
    "nameScale": "lg",
    "contactLayout": "split"
  },
  "content": {
    "sectionOrder": [
      "projects",
      "experience",
      "skills",
      "certifications",
      "education"
    ],
    "sectionLabels": {
      "projects": "Network Projects"
    },
    "showLinksInHeader": false,
    "showSummary": true
  },
  "atsSafe": false
}'::jsonb),
  ('Site Plan', 'site-plan', 'Construction & Real Estate', false, 0, true, '{
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
}'::jsonb),
  ('Foundation', 'foundation', 'Construction & Real Estate', true, 10, true, '{
  "skeleton": "timeline",
  "styleTokens": {
    "displayFont": "geometric",
    "bodyFont": "humanist",
    "accent": "ink",
    "ruleWeight": "heavy",
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
    "sectionLabels": {},
    "showLinksInHeader": false,
    "showSummary": true
  },
  "atsSafe": true
}'::jsonb),
  ('Property Portfolio', 'property-portfolio', 'Construction & Real Estate', true, 10, false, '{
  "skeleton": "grid-modules",
  "styleTokens": {
    "displayFont": "modern-serif",
    "bodyFont": "humanist",
    "accent": "ink",
    "ruleWeight": "heavy",
    "headingTreatment": "boxed",
    "density": "comfortable",
    "nameScale": "lg",
    "contactLayout": "split"
  },
  "content": {
    "sectionOrder": [
      "projects",
      "experience",
      "certifications",
      "education",
      "skills"
    ],
    "sectionLabels": {
      "projects": "Developments"
    },
    "showLinksInHeader": false,
    "showSummary": true
  },
  "atsSafe": false
}'::jsonb),
  ('Front Desk', 'front-desk', 'Hospitality & Travel', false, 0, true, '{
  "skeleton": "single-column",
  "styleTokens": {
    "displayFont": "humanist",
    "bodyFont": "humanist",
    "accent": "rust",
    "ruleWeight": "hairline",
    "headingTreatment": "rule-under",
    "density": "comfortable",
    "nameScale": "md",
    "contactLayout": "inline"
  },
  "content": {
    "sectionOrder": [
      "experience",
      "languages",
      "skills",
      "education",
      "certifications",
      "projects"
    ],
    "sectionLabels": {
      "skills": "Guest Service Skills"
    },
    "showLinksInHeader": false,
    "showSummary": true
  },
  "atsSafe": true
}'::jsonb),
  ('Concierge', 'concierge', 'Hospitality & Travel', true, 10, false, '{
  "skeleton": "rail-right",
  "styleTokens": {
    "displayFont": "modern-serif",
    "bodyFont": "humanist",
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
      "education",
      "projects",
      "skills",
      "languages",
      "certifications"
    ],
    "sectionLabels": {},
    "showLinksInHeader": false,
    "showSummary": true
  },
  "atsSafe": false
}'::jsonb),
  ('Itinerary', 'itinerary', 'Hospitality & Travel', true, 10, true, '{
  "skeleton": "compact-dense",
  "styleTokens": {
    "displayFont": "humanist",
    "bodyFont": "humanist",
    "accent": "rust",
    "ruleWeight": "hairline",
    "headingTreatment": "small-caps",
    "density": "compact",
    "nameScale": "sm",
    "contactLayout": "inline"
  },
  "content": {
    "sectionOrder": [
      "experience",
      "languages",
      "skills",
      "education",
      "projects",
      "certifications"
    ],
    "sectionLabels": {},
    "showLinksInHeader": false,
    "showSummary": true
  },
  "atsSafe": true
}'::jsonb),
  ('Manifest', 'manifest', 'Logistics & Supply Chain', false, 0, true, '{
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
}'::jsonb),
  ('Route Plan', 'route-plan', 'Logistics & Supply Chain', true, 10, true, '{
  "skeleton": "timeline",
  "styleTokens": {
    "displayFont": "condensed",
    "bodyFont": "humanist",
    "accent": "ink",
    "ruleWeight": "medium",
    "headingTreatment": "small-caps",
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
    "sectionLabels": {},
    "showLinksInHeader": false,
    "showSummary": true
  },
  "atsSafe": true
}'::jsonb),
  ('Supply Chain', 'supply-chain', 'Logistics & Supply Chain', true, 10, false, '{
  "skeleton": "sidebar-left",
  "styleTokens": {
    "displayFont": "condensed",
    "bodyFont": "humanist",
    "accent": "ink",
    "ruleWeight": "hairline",
    "headingTreatment": "small-caps",
    "density": "comfortable",
    "nameScale": "md",
    "contactLayout": "stacked"
  },
  "content": {
    "sectionOrder": [
      "certifications",
      "skills",
      "languages",
      "experience",
      "education",
      "projects"
    ],
    "sectionLabels": {},
    "showLinksInHeader": false,
    "showSummary": true
  },
  "atsSafe": false
}'::jsonb)
on conflict (slug) do nothing;

update public.resume_templates set ats_safe = true where slug = 'structured-admin';
update public.resume_templates set ats_safe = false where slug = 'product-tech';
update public.resume_templates set ats_safe = true where slug = 'field-notes';
update public.resume_templates set ats_safe = true where slug = 'ledger';

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

update public.resume_templates
set structure_schema = '{
  "skeleton": "header-band",
  "styleTokens": {
    "displayFont": "geometric",
    "bodyFont": "humanist",
    "accent": "rust",
    "ruleWeight": "none",
    "headingTreatment": "uppercase-tracked",
    "density": "comfortable",
    "nameScale": "lg",
    "contactLayout": "split"
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
    "displayFont": "condensed",
    "bodyFont": "condensed",
    "accent": "ink",
    "ruleWeight": "hairline",
    "headingTreatment": "small-caps",
    "density": "compact",
    "nameScale": "sm",
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
      "experience": "Customer Impact",
      "skills": "Tools & Platforms"
    },
    "showLinksInHeader": false,
    "showSummary": true
  },
  "atsSafe": true
}'::jsonb
where slug = 'field-notes';

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



do $$
declare v_missing text;
begin
  select string_agg(slug, ', ') into v_missing
  from (
    select unnest(array[
      'business-boardroom','business-memo','front-office','filing-system','stack-trace','terminal',
      'design-showcase','studio-brief','success-story','help-desk','balance-sheet','compliance-brief',
      'pitch-deck','funnel','rounds','care-plan','legal-brief','chambers','gantt','sprint-board',
      'gazette','civic-record','blueprint','site-report','specification','schematic',
      'curriculum-vitae','lecture-notes','faculty-profile','research-record',
      'field-mission','impact-report','grant-proposal','byline','reel','press-kit',
      'harvest','field-season','value-chain','rig-report','offshore','wellhead',
      'network-ops','signal','uptime','site-plan','foundation','property-portfolio',
      'front-desk','concierge','itinerary','manifest','route-plan','supply-chain'
    ]) as slug
  ) expected
  where expected.slug not in (select slug from public.resume_templates);

  if v_missing is not null then
    raise exception
      'Template library PR3 migration did not create expected template(s): %. Check for a slug typo or an ON CONFLICT that matched an unexpected existing row.',
      v_missing;
  end if;
end
$$;
