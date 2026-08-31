-- 0074 — blog posts move from files on disk into the database.
--
-- ── WHY ───────────────────────────────────────────────────────────────────
--
-- Publishing a post meant committing an .mdx file to src/content/blog and
-- shipping a deploy. No operator could publish anything, and nothing could be
-- corrected without an engineer. This table is what makes /admin/blog possible.
--
-- ── THE FOUR EXISTING POSTS ARE SEEDED HERE, IN FULL ──────────────────────
--
-- Their bodies are embedded below rather than copied by a throwaway script,
-- because after this migration the files are DELETED and this becomes the
-- permanent record of what they contained. A migration is checked into git
-- forever; a one-off script is not, and "where did the original posts go" is a
-- question that should have an answer in the same place as the schema change.
--
-- published_at is each post's original frontmatter `date`, so ordering on
-- /blog is unchanged by the move.
--
-- ── RLS: DRAFTS ARE NOT REACHABLE BY ANY CLIENT ───────────────────────────
--
-- The SELECT policy is `status = 'published'`, so a draft is invisible to anon
-- and to a signed-in seeker alike — not merely absent from a listing query,
-- but unreadable if someone asks for it by id. The public route filters on
-- status too; that is defence in depth, not the control.
--
-- Writes are REVOKED from anon and authenticated entirely, following 0061's
-- precedent for the course catalog: "which is what makes 'curated' true rather
-- than aspirational". Admin writes go through createServiceRoleClient() after
-- requireAdmin(), the same path every other admin mutation takes, so no policy
-- needs to grant them and no client role can reach the table.
--
-- ── WHY status IS A CHECK AND NOT AN ENUM ─────────────────────────────────
--
-- Two values that are unlikely to grow, and a check constraint can be widened
-- in one statement. A Postgres enum cannot have a value removed at all, which
-- is the wrong trade for something this small.

create table if not exists public.blog_posts (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique,
  title         text not null,
  description   text not null,
  author        text not null,
  body          text not null,
  status        text not null default 'draft' check (status in ('draft', 'published')),
  -- Null until it actually goes live. Set when status flips to published, and
  -- deliberately NOT cleared on unpublish: "when was this first live" survives
  -- a retirement, which is the point of unpublishing rather than deleting.
  published_at  timestamptz,
  created_by    uuid references public.admin_users(id) on delete set null,
  updated_by    uuid references public.admin_users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.blog_posts is
  'Blog content. Drafts are unreadable by any client role (RLS); all writes are service-role after requireAdmin(). See 0074.';

-- The public listing orders by published_at desc and filters on status; the
-- detail route looks up by slug. Both are covered.
create index if not exists blog_posts_published_idx
  on public.blog_posts (status, published_at desc);

alter table public.blog_posts enable row level security;

drop policy if exists "published posts are world readable" on public.blog_posts;
create policy "published posts are world readable"
  on public.blog_posts for select
  using (status = 'published');

-- No client role writes this table. Supabase grants ALL ON ALL TABLES to
-- anon/authenticated by default, and a row policy restricts rows, never
-- columns or verbs — the lesson 0026-0030 cost four findings to learn.
revoke insert, update, delete on public.blog_posts from anon, authenticated;

insert into public.blog_posts (slug, title, description, author, body, status, published_at)
values
  ('beating-the-ats', 'Beating the ATS: what actually matters in a tailored resume', 'Most applicant tracking systems aren''t the villain they''re made out to be — but they do reward specific habits.', 'The Talentrah Team', '"The ATS rejected me" is the most common explanation job seekers give for
silence after applying — and it''s usually only half the story. Applicant
tracking systems mostly parse and organize resumes for a human recruiter to
read; they rarely auto-reject outright. But a resume that parses badly, or
doesn''t speak to the specific role, gives that recruiter a worse first
impression before they''ve even started reading.

## Match the job description''s actual language

If a posting says "stakeholder management" and your resume says "worked
with cross-functional teams," a keyword scan — human or automated — may
miss the connection. This is exactly what Farah''s tailoring flow does: it
reads the job description and adjusts your resume''s language to mirror it,
without inventing experience you don''t have.

## Quantify, don''t just describe

"Managed a team" tells a recruiter what you did. "Managed a team of 6,
cutting release cycle time by 30%" tells them what changed because of you.
If you don''t have an exact number, a reasonable estimate ("roughly," "about")
is still far stronger than no number at all.

## Keep formatting parser-friendly

Multi-column layouts, text embedded in images, and creative graphic resumes
can look great to a human and parse badly for a machine. Stick to a single
column, standard section headers (Experience, Education, Skills), and plain
text — save the visual design for your portfolio, not your resume file.

## Tailor per application, not once

A resume tuned for one specific role will consistently outperform a single
"master resume" sent everywhere. This is the single highest-leverage thing
tailoring does — it''s also exactly why it''s built into the application flow
rather than left as a manual step you have to remember to do.

None of this guarantees an interview. It does mean the resume that reaches a
human recruiter''s eyes actually represents you accurately — which is the
most any resume can do.', 'published', '2026-07-18'::timestamptz),
  ('cover-letters-that-dont-sound-like-a-template', 'Cover letters that don''t sound like a template', 'The tell isn''t AI assistance — it''s genericness. Here''s how to keep the specific parts specific.', 'The Talentrah Team', 'Recruiters can usually spot a template cover letter within a sentence or
two — not because it was written with help, but because it could have been
sent to any company for any role. The fix isn''t avoiding a starting draft;
it''s making sure the specific parts stay specific.

## Start with what wouldn''t work for another company

A strong opening line references something true about this role or this
company specifically — a product you''ve actually used, a problem the job
description names directly, a reason this team''s work is interesting to
you. If your opening line would work unchanged in an application to a
competitor, rewrite it.

## Connect your experience to their stated need, explicitly

Don''t make the recruiter do the work of connecting your background to their
requirements. If the job description asks for experience scaling a support
team, say directly: "I scaled a support team from 3 to 12 people over 14
months" — not just "I have team leadership experience."

## Keep it short

Three to four short paragraphs is enough: why this role, why you fit,
one concrete example, a brief close. A cover letter''s job is to earn a
closer read of your resume, not to repeat it.

## Read it out loud before sending

The fastest way to catch a line that sounds generic, stiff, or obviously
templated is to hear it. If a sentence sounds like it belongs in a form
letter when read aloud, it probably reads that way to the person on the
other end too.

Starting from a draft — AI-assisted or otherwise — isn''t the problem.
Sending the draft unchanged is.', 'published', '2026-06-20'::timestamptz),
  ('reading-your-match-score', 'How to read your Match Score (and actually use it)', 'Farah''s Match Score isn''t a grade — it''s a map of where to spend your time before you hit apply.', 'The Talentrah Team', 'Every job card on Talentrah carries a Match Score — a single number, banded
into three tiers: **Fair** (under ~70%), **Good** (70–89%), and **Excellent**
(90%+). It''s easy to treat that number as a pass/fail grade. It''s more useful
as a map.

## What the score is actually measuring

The score compares the role''s requirements against your profile and resume
— skills, years of experience, seniority, and the specifics in the job
description itself. It''s a read on fit, not a prediction of whether you''ll
get the interview. A Fair match with a compelling story can beat an
Excellent match with a generic resume.

## Fair match: don''t skip it, adjust it

A Fair score usually means a real gap exists somewhere — not that the role
is out of reach. Open Farah''s gap analysis before you apply. If the gap is
something you can address in your resume (an underrepresented skill you
actually have, an achievement that isn''t quantified), tailor first, then
apply. If the gap is a genuine skills gap, that''s useful information too —
it''s often the moment Farah will point you toward a relevant course.

## Good match: this is where tailoring pays off most

Most of your applications will land here, and it''s the highest-leverage tier
to spend tailoring effort on. A Good match with a resume tuned to the
specific job description regularly out-competes an Excellent match with a
generic one, simply because most other applicants at "Good" aren''t
tailoring at all.

## Excellent match: don''t get complacent

A 90%+ score means the role and your profile line up well on paper. It
doesn''t mean the application writes itself — recruiters still read past the
keywords. Use the extra headroom to make your application stand out on
substance, not just fit.

The score is a starting point for a decision, not the decision itself. Pair
it with the gap analysis underneath it, and you''ll get more out of it than
the number alone.', 'published', '2026-08-01'::timestamptz),
  ('when-to-bring-in-a-mentor', 'When to bring in a mentor (and when Farah''s enough)', 'AI copilots and human mentors are good at different things. Knowing which moment you''re in matters.', 'The Talentrah Team', 'Farah handles the volume work of a job search well: scanning listings for
fit, tailoring your resume to a specific description, flagging skill gaps,
answering quick questions at 11pm when you''re rewriting a bullet point for
the fifth time. That''s most of a job search, by sheer number of moments. But
not all of it.

## Where AI does its best work

Anything repeatable, fast-turnaround, and low-ambiguity is Farah''s strength:
matching you against a fresh batch of listings, rewriting a resume section
against a new job description, drafting a first pass at a cover letter. The
value is speed and consistency across a lot of small decisions.

## Where a human mentor earns their place

Two moments in particular are worth a real person''s judgment, not just
Farah''s:

- **Offer negotiation.** Numbers, leverage, and reading a specific
  employer''s flexibility are things a mentor who''s actually negotiated
  offers before will handle better than a general framework can.
- **Final-round interview prep.** By the final round, the questions get more
  specific to the company and the role — a mock conversation with someone
  who''s sat in that kind of room has a different value than practicing
  answers alone.

## The handoff isn''t a downgrade

Talentrah''s mentor marketplace exists because these moments matter enough
to bring in a real person, not because AI falls short generally. Many
mentors offer free or low-cost sessions specifically for the moments above —
worth booking before a high-stakes conversation, not just when something''s
already gone wrong.

Use Farah for the volume of the search. Bring in a mentor for the few
conversations where the stakes are highest. Knowing which is which is most
of the skill.', 'published', '2026-07-05'::timestamptz)
on conflict (slug) do nothing;
