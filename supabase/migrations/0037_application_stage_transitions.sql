-- 0037 — Stop a hired application being silently un-hired.
--
-- ---------------------------------------------------------------------------
-- The gap
-- ---------------------------------------------------------------------------
-- `updateStageAction` casts the submitted stage straight to the enum with no
-- validation, so `hired -> saved` succeeds. The client confirms *entering*
-- "hired" and nothing guards *leaving* it. That erases the milestone the
-- referral-prompt flywheel keys off, and leaves `application_stage_events`
-- holding a history that no longer matches the row.
--
-- Enforced as a TRIGGER rather than a check in the Server Action, for the
-- reason 0028/0030/0031 all landed on: `applications` has a permissive
-- owner-only FOR ALL policy, so anything the action refuses can still be done
-- with a direct PATCH from the browser's own session. A rule that only the
-- happy path respects is not a rule.
--
-- ---------------------------------------------------------------------------
-- What is and isn't restricted — a deliberately narrow rule
-- ---------------------------------------------------------------------------
-- ONLY this: once an application is `hired`, it can go to `archived` or stay
-- put. Nothing else.
--
-- Strict funnel adjacency was considered and rejected. The brief lists
-- `offer -> applied` as an arbitrary jump, and mechanically it is — but the
-- Job Tracker is the user's own private record of their own job search, and
-- correcting a mis-clicked dropdown is a completely legitimate thing to want.
-- Forbidding backwards moves in general would turn one real bug into a steady
-- stream of "why won't it let me fix this", which is a worse product than the
-- bug. `saved -> offer` is legitimate too: people start tracking a job late.
--
-- So the line is drawn at the one transition that destroys information rather
-- than corrects it. `hired` is the success milestone; everything else is just
-- where you currently think you are.
--
-- service_role deliberately bypasses this. Support correcting a genuine
-- mistake, and the test suites setting up fixtures, both need to be able to
-- write any stage; the rule exists to constrain the *product surface*, which
-- is what `authenticated` reaches it through.

create or replace function public.enforce_application_stage_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.stage is not distinct from new.stage then
    return new;
  end if;

  -- Server-side tooling and support corrections are not the product surface.
  if coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;

  if old.stage = 'hired' and new.stage <> 'archived' then
    raise exception
      'A hired application can only be archived, not moved back to %', new.stage
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_application_stage_transition() from public;
grant execute on function public.enforce_application_stage_transition() to postgres, service_role;

drop trigger if exists applications_enforce_stage_transition on public.applications;
create trigger applications_enforce_stage_transition
  before update of stage on public.applications
  for each row
  execute function public.enforce_application_stage_transition();
