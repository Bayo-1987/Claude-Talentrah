-- 0078 — give the builtin roles the `blog` permission 0076 created.
--
-- Separate from 0076 because Postgres will not let a new enum value be used in
-- the transaction that adds it (55P04). See 0077's header.
--
-- Both builtin roles, matching how 0075 seeded every other content area: Super
-- Admin gets the whole enum, Standard Admin everything except `operators`.
-- Blog is a content area, not a privilege escalation, so it belongs in both.
--
-- CUSTOM roles get nothing here, deliberately. Their permission sets were
-- chosen by a person, and silently widening them would make "this role can do
-- exactly these things" untrue the moment a new area ships. A super admin
-- grants it from Operators — one click, and the decision the model exists to
-- make explicit.

-- ── RENUMBERED FROM 0076, AND CI RECORDS THE OLD NAME ─────────────────────
--
-- Applied to the CI project as `0076_blog_permission` before
-- `0076_admin_create_operator` landed on main. Both were legitimately 0076 at
-- the moment each was written; main's arrived first, so this one moved.
--
-- The applied record is NOT rewritten to match. This repo's position, stated
-- in three migration headers, is that an applied migration is history —
-- 0061 documents the same mismatch as "cosmetic and deliberate" and says in
-- capitals not to re-apply it to fix a name. scripts/audit-migrations.ts has a
-- KNOWN_ALIASES map for exactly this, and both names are registered there so
-- the audit does not report a false MISSING.
--
-- Production has not had this applied yet, so it will record the correct name.
-- The two projects therefore disagree on the label and agree on the schema,
-- which is the same state 0061 left behind.

insert into public.admin_role_permissions (role_id, permission)
select r.id, 'blog'::public.admin_permission
from public.admin_roles r
where r.is_builtin and r.name in ('Super Admin', 'Standard Admin')
on conflict do nothing;
