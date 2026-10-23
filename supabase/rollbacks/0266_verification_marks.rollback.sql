-- ROLLBACK for 0266 (verification_marks). Not a migration: the exact undo, kept beside the file it undoes. Run as `postgres` in ONE transaction (it is written to be). To keep the schema ledger honest, record it as a NEW
-- migration row (do not delete 0266's row). `supabase/rollbacks/` is outside supabase/migrations, so neither the migration-numbering check nor `supabase db push` ever sees it.
--
-- REFUSES (and changes nothing) if any mark other than resume_reviewed exists: a later mark type (skills check, reference, ...) must never be dropped silently. In that case this is a different, manual decision.
-- WHAT IT DOES: restores resolve_talent_verification to its 0142 definition (so a passed review stops writing a mark), then drops the two read functions, the writer, the hash function, the table (its policy goes with it) and the
-- pure liveness function. profiles.talent_verification_* and talent_verifications are untouched: nothing a user sees today changes.

begin;

do $guard$
begin
  if exists (select 1 from public.verification_marks where mark_type <> 'resume_reviewed') then
    raise exception '0266 rollback refused: verification_marks holds marks other than resume_reviewed; do not drop them silently';
  end if;
end
$guard$;

create or replace function public.resolve_talent_verification(
  p_verification_id uuid,
  p_user_id uuid,
  p_verified boolean,
  p_score integer,
  p_feedback text,
  p_reviewer_id uuid default null,
  p_reviewer_notes text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_status text := case when p_verified then 'verified' else 'rejected' end;
  v_reviewer_payout_ngn integer := round(60 * 125 * 0.85);
  v_updated uuid;
begin
  update public.talent_verifications
     set status = v_new_status,
         ai_score = p_score,
         ai_feedback = p_feedback,
         decided_at = now(),
         reviewer_notes = coalesce(p_reviewer_notes, reviewer_notes),
         reviewer_payout_ngn = case when p_reviewer_id is not null then v_reviewer_payout_ngn else reviewer_payout_ngn end
   where id = p_verification_id
     and user_id = p_user_id
     and (
       (p_reviewer_id is null and status = 'pending')
       or (p_reviewer_id is not null and status = 'claimed' and reviewer_id = p_reviewer_id)
     )
  returning id into v_updated;

  if v_updated is null then
    return false;
  end if;

  update public.profiles
     set talent_verification_status = v_new_status,
         talent_verification_score = p_score,
         talent_verified_at = case when p_verified then now() else null end
   where id = p_user_id;

  return true;
end;
$$;

revoke all on function public.resolve_talent_verification(uuid, uuid, boolean, integer, text, uuid, text) from public, anon, authenticated;
grant execute on function public.resolve_talent_verification(uuid, uuid, boolean, integer, text, uuid, text) to service_role;

drop function public.employer_visible_marks(uuid[]);
drop function public.applicant_visible_marks(uuid);
drop function public.award_verification_mark(uuid, text, text, text, text, uuid, text, timestamptz);
drop function public.resume_content_hash(uuid);
drop table public.verification_marks;
drop function public.verification_mark_is_live(timestamptz, timestamptz);

commit;
