-- 0059 — how many people have applied to an internal posting.
--
-- WHY A NEW FUNCTION RATHER THAN 0029's. `org_application_counts` answers the
-- same arithmetic for a different audience: it is scoped to one organisation
-- and exists so an EMPLOYER can see their own postings' numbers. Reusing it
-- here would mean either relaxing that scope — turning a deliberately
-- org-gated function into a general one, and changing what every existing
-- caller is allowed to see — or passing an org id the seeker's feed does not
-- have. Two audiences, two functions, and 0029 keeps its narrower grant.
--
-- WHY SECURITY DEFINER AT ALL. `applications` is owner-only under RLS, so a
-- seeker joining it directly gets their own rows and nothing else — a feed
-- would show "1 applicant" on every job they had applied to and "0" on the
-- rest, which is worse than no number because it looks like real data. The
-- definer's rights are what make the count a count.
--
-- WHAT IS EXPOSED, AND WHAT IS NOT. An aggregate, and only for postings this
-- platform hosts. No identity, no per-user rows, no way to ask "did X apply".
-- Job boards show this number as a matter of course; it is the applicant's
-- competitive context, which §6.2 is about giving them.
--
-- INTERNAL ONLY, enforced HERE rather than by the caller. An external posting
-- is advertised on somebody else's site and applied to there — this table sees
-- only the fraction of applicants who happened to route through Talentrah and
-- then told us. Publishing that as "3 applicants" would be a number with no
-- relationship to the truth, and a confidently wrong one is worse than an
-- absent one. The feed says "Applicant count unavailable" for those instead.
-- Putting the filter in SQL means a future caller cannot get it wrong.
--
-- NEVER FROM "MARK AS APPLIED" ON AN EXTERNAL CARD. That button records what
-- ONE user says they did, for their own tracker. Aggregating self-reports
-- across users and printing the total next to a job would invent a statistic
-- out of a personal note.
--
-- WHY `applied_at is not null` AND NOT `stage <> 'saved'`. Saving a job is a
-- bookmark, not an application, and counting bookmarks as applicants would be
-- a lie the number's whole value depends on not telling. `applied_at` is the
-- moment someone actually applied and it SURVIVES later stage changes —
-- counting by stage would drop anyone who archived a job they had applied to.
-- Verified against production before choosing: applied_at is set on all 9 rows
-- at applied-or-beyond and null on all 3 saved rows.
--
-- A COUNT OF PEOPLE, not of rows: `applications` is unique on
-- (user_id, job_posting_id), so one row is one person by construction.
--
-- TAKES THE FEED'S IDS AS A PARAMETER rather than returning every internal
-- posting's count. The feed already holds its result set, so this is one
-- lookup for the page it is rendering — not a table scan whose size grows with
-- the board while the caller uses a slice of it.

create or replace function public.internal_applicant_counts(p_job_ids uuid[])
returns table (job_posting_id uuid, applicant_count bigint)
language sql
security definer
set search_path = ''
stable
as $$
  select a.job_posting_id, count(*)::bigint
  from public.applications a
  join public.job_postings j on j.id = a.job_posting_id
  where a.job_posting_id = any(p_job_ids)
    and j.source_type = 'internal'::public.job_source_type
    and a.applied_at is not null
  group by a.job_posting_id;
$$;

-- Granted to `authenticated` generally — this is seeker-facing, on the feed
-- every signed-in user sees. `anon` is deliberately left out: the feed is
-- authenticated-only, and a signed-out caller has no reason to enumerate
-- application volumes.
revoke all on function public.internal_applicant_counts(uuid[]) from public, anon;
grant execute on function public.internal_applicant_counts(uuid[]) to authenticated, service_role;

comment on function public.internal_applicant_counts(uuid[]) is
  'Applicant counts for INTERNAL job postings only, keyed on the ids the caller is rendering. Counts people who actually applied (applied_at is not null), never people who merely saved. External postings are excluded in SQL because our number would only be the fraction who routed through us.';
