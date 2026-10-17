-- 0261 (number assigned by the owner, 17 Oct 2026): TEMPLATE-COST0-DB-1. A premium resume template must cost at least 1 credit to unlock, enforced by the table itself.
--
-- WHY. unlockTemplateAction (src/lib/resume-builder/actions.ts) claims the unlock row and then calls spendCredits(userId, template.unlock_cost_credits, ...). spend_credits_atomic (0035) refuses an amount of 0 or less
-- ("amount must be positive"), and the action gives the claim back on any error. So a premium template at cost 0 (or below) can never be unlocked by anyone: nothing is charged, the person just sees a failure. The two seeders
-- already refuse such a definition before they write (assertValidTemplateDefinitions in src/lib/billing/catalog.ts, #944); this is the same rule in the table, so a hand-written row, a future writer or a stray UPDATE cannot get round it.
--
-- WHAT IT DOES. One CHECK on public.resume_templates: not is_premium or unlock_cost_credits >= 1. A free template (is_premium false) is not constrained here: it may cost 0, and nothing in this migration says what a free template
-- must cost. Both columns are NOT NULL, so the expression is never NULL. NO ROW IS TOUCHED: no insert, update or delete, and no existing value is changed. A do-block first reads the table and, if any premium row is already below 1, stops
-- with a message that names the slugs (the CHECK would also refuse, but with a message that names no row). Production's read-only count on 17 Oct 2026 found 65 templates, 56 of them premium, all 56 at cost 10 and none below 1
-- (reports/S3-21/2026-10-17-money-counts-run-q7-q1.md, handoff folder; migration 0110 is what set them), so the precheck is expected to pass there.
--
-- LOCK. ALTER TABLE ... ADD CONSTRAINT takes an ACCESS EXCLUSIVE lock on resume_templates while it checks every existing row. The table holds 65 rows, so the check takes microseconds; NOT VALID followed by VALIDATE CONSTRAINT would buy nothing
-- on a table this size and is not used. The hosted apply sets lock_timeout and statement_timeout in its own wrapper, so a busy table makes it fail fast and apply nothing instead of queueing.
--
-- WHO WRITES THIS TABLE (searched across the repo two ways, 17 Oct): scripts/seed-catalog.ts (upsert) and scripts/seed.ts (update and insert), both fed only from RESUME_TEMPLATES and validated first; migrations 0042, 0104, 0105, 0106, 0110, 0111
-- and 0158 (all earlier than this one, so already applied in any chain); and tests that write through the service role. No application route, server action or admin screen writes it, and authenticated users hold no write grant on it
-- (tests/rls/cross-user.test.ts, tests/rls/column-privileges.test.ts). So no deployed code can be refused by this constraint.
--
-- ORDER. Under supabase/migrations/README.md a tightened constraint counts as destructive (deploy first, apply after), because it breaks deployed code the instant it applies. Here nothing deployed writes the table, so there is
-- no deployed code to break and the order against any merge does not matter for correctness; the owner's instruction is to apply it to production BEFORE the code merges, which is also what a CI database built from this
-- directory already does. The exact undo is supabase/rollbacks/0261_template_unlock_cost_check.rollback.sql.

do $precheck$
declare
  v_bad text;
begin
  select string_agg(slug, ', ' order by slug) into v_bad
    from public.resume_templates
   where is_premium and unlock_cost_credits < 1;
  if v_bad is not null then
    raise exception '0261: premium resume template(s) already below cost 1, cannot add resume_templates_premium_unlock_cost_check: %', v_bad;
  end if;
end
$precheck$;

alter table public.resume_templates
  add constraint resume_templates_premium_unlock_cost_check
  check (not is_premium or unlock_cost_credits >= 1);

comment on constraint resume_templates_premium_unlock_cost_check on public.resume_templates is
  '0261: a premium template must cost at least 1 credit to unlock (spend_credits_atomic refuses an amount of 0 or less, so a premium template at cost 0 could never be unlocked). Free templates may cost 0.';
