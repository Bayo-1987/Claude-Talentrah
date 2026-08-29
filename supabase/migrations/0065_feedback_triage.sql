-- 0065 — give the write-only mailbox a triage state, without opening it.
--
-- 0054 ends by naming its own gap: "no admin UI, no read path... Reading this
-- table is a service-role job, which today means a SQL query by an operator.
-- That is a real limitation — feedback nobody reads is feedback nobody acts on
-- — and it is the next thing to build here." This is that.
--
-- ── THE CONSTRAINT THAT SHAPES EVERYTHING BELOW ─────────────────────────
--
-- The write-only design does not change. `feedback` is other people's words
-- about the product, their employer, and sometimes us; 0054's argument for
-- revoking SELECT rather than merely leaving it unpolicied is unaffected by
-- an operator wanting a queue. Admin reads go through requireAdmin() and the
-- service role, exactly like the other three moderation queues — no SELECT
-- grant is added here, to anyone.
--
-- ── THE ACTUAL RISK IN THIS MIGRATION, AND IT IS NOT THE ONE 0064 TAUGHT ─
--
-- 0064's lesson was about UPDATE: a table-level grant overrides a column-level
-- revoke. That lesson does not apply here, because 0054 already revoked UPDATE
-- from `authenticated` and `anon` at table level, so the new columns below
-- inherit that and are not updatable by any client. Measured before writing
-- this, against the CI project:
--
--   has_table_privilege('authenticated','feedback','update')  -> false
--   has_table_privilege('authenticated','feedback','select')  -> false
--   has_table_privilege('authenticated','feedback','insert')  -> TRUE     <--
--   has_table_privilege('anon',         'feedback','insert')  -> TRUE     <--
--
-- INSERT is the hole, and it is the verb nobody has been watching. The only
-- policy on this table checks `user_id = auth.uid()` — who you file AS. It
-- says nothing about WHICH COLUMNS you may set, and a policy cannot: that is
-- a grant's job. `authenticated` holds INSERT on the whole table.
--
-- So the moment `status` and `triaged_by` exist, a signed-in user can file:
--
--   insert into feedback (user_id, category, message, status, triaged_by,
--                         triage_note)
--   values (auth.uid(), 'bug', '…', 'resolved', '<any profile id>',
--           'Looked into it, working as intended');
--
-- and the row arrives in the operator's queue already marked resolved, signed
-- with somebody else's name. That is not a leak — it is a forgery, and it
-- would be indistinguishable from a real triage decision because the columns
-- are the only record of one. An attribution column that anyone can write is
-- worse than the honest absence it replaced; that argument is 0064's, and it
-- applies to whichever verb happens to reach the column.
--
-- The fix is 0030's order, applied to INSERT instead of UPDATE: take the
-- table-level grant away FIRST, then grant back only the columns a person
-- legitimately supplies. Reversing those two lines silently does nothing.
--
-- `id` and `created_at` are deliberately not granted back either. They have
-- defaults, so nothing needs to send them, and a user-chosen `created_at`
-- would let someone place their submission anywhere in an operator's
-- chronology.

create type public.feedback_status as enum (
  'new',
  'in_review',
  -- 'resolved' and 'declined' are BOTH here on purpose, and the fourth state
  -- is the one that earns its keep. Without `declined`, an operator who has
  -- read something and decided not to act on it must either mark it resolved —
  -- making the queue's own data a lie, and "resolved" mean two different
  -- things — or leave it open forever, so the queue silts up with items nobody
  -- will ever action. Both failures make the queue less trustworthy the more
  -- it is used.
  'resolved',
  'declined'
);

alter table public.feedback
  add column status public.feedback_status not null default 'new',
  add column triaged_by uuid references public.profiles(id) on delete set null,
  add column triaged_at timestamptz,
  add column triage_note text;

-- Points at `profiles`, not `admin_users` — the same choice as 0064, for the
-- same reason: one id space for "a person did this", and an operator whose
-- admin rights are later revoked still resolves to a person here rather than
-- dangling. ON DELETE SET NULL because §8 requires account deletion to be
-- real, and a triage decision must outlive the person who made it; it
-- degrades to a null, which is visibly missing.

-- A row that has been triaged must say BY WHOM. Without this, `status` and
-- `triaged_by` can disagree — a resolved row attributed to nobody — and the
-- disagreement is invisible until someone asks who closed something. The
-- database is the only place this can be guaranteed, because the app is not
-- the only writer: the service role is, and a future backfill would be too.
alter table public.feedback
  add constraint feedback_triaged_rows_name_an_operator
  check (status = 'new' or triaged_by is not null);

-- ── Close the INSERT hole. ORDER MATTERS; see above. ────────────────────

revoke insert on public.feedback from anon, authenticated;

-- Exactly what src/lib/feedback/actions.ts sends, and nothing else. `anon` is
-- not granted anything back: the policy already refuses a signed-out visitor
-- because auth.uid() is null, and now the privilege refuses them too — which
-- is the difference between a rule and an enforced rule.
grant insert (user_id, category, message, page_path)
  on public.feedback
  to authenticated;

-- The queue reads "open items, newest first"; the second index answers "what
-- has this operator triaged", the first question anyone asks of an
-- attribution column.
create index feedback_status_idx on public.feedback (status, created_at desc);
create index feedback_triaged_by_idx
  on public.feedback (triaged_by) where triaged_by is not null;

comment on column public.feedback.status is
  'Triage state. Rows arrive `new`; everything else is set by an admin through the dashboard. Not settable by any client — INSERT is granted per-column (0065) and UPDATE is revoked outright (0054).';
comment on column public.feedback.triaged_by is
  'The admin who last changed this row''s status. Null while `new`, and enforced non-null otherwise by feedback_triaged_rows_name_an_operator.';
