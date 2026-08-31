-- 0077 — give the builtin roles the `blog` permission 0076 created.
--
-- Separate from 0076 because Postgres will not let a new enum value be used in
-- the transaction that adds it (55P04). See 0076's header.
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

insert into public.admin_role_permissions (role_id, permission)
select r.id, 'blog'::public.admin_permission
from public.admin_roles r
where r.is_builtin and r.name in ('Super Admin', 'Standard Admin')
on conflict do nothing;
