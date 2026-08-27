-- 0054 — in-product feedback. A write-only mailbox.
--
-- One table, one policy, and three explicit revokes. The revokes are the
-- substance: everything else here is a form.
--
-- WHY WRITE-ONLY, AND WHY THE REVOKES ARE SPELLED OUT.
--
-- Feedback is other people's words. "Your team is ignoring the bug I filed
-- about my employer" is a sentence someone might reasonably write here, and
-- there is no version of this product where another signed-in user gets to
-- read it. The obvious implementation — an owner-scoped SELECT policy so a
-- user can see their own submissions — is not built, because it would be the
-- only reason to grant SELECT at all, and a SELECT grant plus one wrong
-- policy edit later is a leak of every row.
--
-- Withholding a policy is NOT the same as withholding the privilege. This
-- repo has now been bitten four times (0026, 0027, 0028, 0030) by exactly one
-- confusion: RLS policies decide WHICH ROWS, grants decide WHICH COLUMNS and
-- WHICH VERBS, and Supabase hands `authenticated` and `anon` `ALL ON ALL
-- TABLES` in public by default. A table with no SELECT policy is unreadable
-- only for as long as nobody adds one. A table with no SELECT *grant* stays
-- unreadable even if someone does — the grant has to be restored on purpose,
-- in SQL, in a diff.
--
-- So both are done, and the revoke is the load-bearing half.
--
-- WHAT IS DELIBERATELY ABSENT. No admin UI, no read path, no notification.
-- Reading this table is a service-role job, which today means a SQL query by
-- an operator. That is a real limitation — feedback nobody reads is feedback
-- nobody acts on — and it is the next thing to build here, not something this
-- migration quietly pretends to have solved.

create type public.feedback_category as enum ('bug', 'idea', 'other');

create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  category public.feedback_category not null,
  message text not null,
  -- Where the person was when they hit Feedback, not where the form lives —
  -- "/feedback" for every row would be worthless. Stored only when it is a
  -- same-origin path (see src/lib/feedback/schemas.ts), because the client
  -- supplies it and an unvalidated one is an arbitrary attacker-chosen string
  -- rendered back to whoever reads the table.
  page_path text,
  created_at timestamptz not null default now(),

  -- An empty submission is noise that looks like signal. Cheaper to refuse in
  -- the database than to filter out of every future read.
  constraint feedback_message_not_blank check (length(btrim(message)) > 0)
);

-- ON DELETE CASCADE above, deliberately. If someone deletes their account
-- (§8 requires that we support it), their feedback goes with them: it is
-- their words, attached to their id, and there is no anonymised form of it
-- here to keep. Detaching it to a null user_id would keep the text while
-- destroying the only means of ever following up on it.

alter table public.feedback enable row level security;

-- The only policy. `user_id = auth.uid()` stops a signed-in user filing
-- feedback in someone else's name; `anon` fails it because auth.uid() is null.
create policy "users can file their own feedback"
  on public.feedback
  for insert
  to authenticated
  with check (user_id = auth.uid());

-- The half a missing policy does not cover.
revoke select, update, delete on public.feedback from authenticated, anon;

comment on table public.feedback is
  'Write-only. Users insert their own rows and nobody but the service role can read them: SELECT/UPDATE/DELETE are revoked from authenticated and anon, not merely unpolicied.';
