# Talentrah — Handoff Status

Single-file record of what has shipped and how it was verified. Kept current
after every merge, so state is reconstructable from this file alone.

> **This file was created on 2026-08-25 16:00 UTC.** The priority backlog that
> asked for it to be "updated the same way it's been maintained so far"
> referred to a file that did not exist in this repo or anywhere under
> `~/Desktop`, `~/Documents` or `~/Downloads`. Neither did any of the other
> documents that backlog cites — see [Missing input documents](#missing-input-documents).
> Everything below is therefore reconstructed from the git history, the live
> Supabase project and live production probes, not copied forward from a
> previous version.

---

## Verification standard

This project has been burned by reported-but-untrue merge claims. The standard
now is: **a merge is not confirmed until it has been checked by a method a
second party could reproduce, against live state.** For every merge recorded
below that means all four of:

1. `GET /repos/:owner/:repo/pulls/:n` reporting `merged: true` with a
   `merged_at` and `merge_commit_sha`.
2. A **fresh shallow clone** of `main` — not the local working copy, which can
   be stale or dirty — with the expected files asserted present.
3. Where the change is observable from outside, a **live production probe**.
4. The full test suite run against merged `main`.

Un-pinned `raw.githubusercontent.com` fetches and cached GitHub web pages have
both served stale content in this project's history. Don't rely on either.

---

## Handoff log (one file per merged PR)

Each merged PR has its own file under `docs/handoff/` (`<yyyy-mm-dd>-pr-<n>.md`). Entries written before this format are under `docs/handoff/legacy/`. A PR adds its own file in the same PR, so two PRs cannot conflict on the record. **Copy [`docs/handoff/TEMPLATE.md`](docs/handoff/TEMPLATE.md)** (PR number and title, merge SHA and merged-at UTC, the four-part verification, flakes and reruns, follow-ups, and for a migration the apply record: where, UTC time, sha256) so entries have the same shape. `tests/docs/handoff-format.test.ts` enforces the shape.

There is deliberately **no list of entries here**: a list in this file would be a shared insertion point again, and every PR would conflict on it, which is the problem this layout removes. Browse the directory instead (`ls docs/handoff`, the date and PR number are in each name; older entries are in `docs/handoff/legacy/`).

---
## Operational 2026-09-30 — production scholarship row `b78fa6f6-…` unpublished (database change, #594, found during send-480)

| What | Where | When (UTC) | Row |
|------|-------|------------|-----|
| one guarded `UPDATE public.scholarships SET moderation_status = 'pending'` | production (`nytwbbzfpytctjsoczzq`), via the Supabase connector | about 18:13 on 2026-09-30, after the owner's explicit yes for exactly this one write | `id b78fa6f6-85d4-496a-9b60-d950abf7f416` ("2027 Innovation and Technology Scholarship (Mastercard Foundation Scholars Program at ASU)") |

**Why.** The row was `verified` with no `application_deadline` and a **698-character `deadline_note` holding internal reviewer instructions**
(the column has no length limit and nothing separates internal from public text). That text was already public on its own detail page and in
`sitemap.xml` before #595, so this was a production fix, not only a merge blocker: #595's landing would have shown "See the official listing for
the deadline" for it (the ≤ 140-character guard), but the detail page still printed the note.

**Checked before writing (read-only).** No triggers, publications, rules, `pg_net` or `pg_cron` on `public.scholarships`; the only functions
mentioning the status are `admin_moderate_scholarship` and `scholarship_landing_facet_counts`; **0** rows in `scholarship_saves` for it and 0
reminders sent (the deadline-reminder sender also skips anything not `verified`), so nothing could notify anyone; the row is not in the repo's
seed/`sources.config.ts`, so the nightly ingest cannot re-publish it.

```sql
update public.scholarships set moderation_status = 'pending'
 where id = 'b78fa6f6-85d4-496a-9b60-d950abf7f416' and moderation_status = 'verified'
returning id, moderation_status, application_deadline, length(deadline_note) as deadline_note_len,
          moderation_note, moderated_at, moderated_by;
```
A primary-key match, so it can change at most one row. It returned exactly one: `moderation_status = pending`; `deadline_note` still 698
characters; `moderation_note` null; `application_deadline` null; `moderated_at` (`2026-09-09 09:02:53+00`) and `moderated_by` unchanged. Nothing else was written.

### Verification (the four, adapted: no repo change, so no merge)
1. **The database's own answer:** the `RETURNING` row above.
2. **Repo / fresh clone:** not applicable; the SQL above is the durable record.
3. **Live probe:** at 18:14:18 UTC the detail page returned **404** signed out and the id was absent from a freshly generated `sitemap.xml`
   (`x-vercel-cache: MISS`). Re-checked at 20:57 UTC on the post-merge production deployment: detail page 404, id absent.
4. **Full suite:** not applicable (no code).

### Not covered / still open
- The row now sits in the admin pending-review queue. **It has not been fixed and re-verified**: someone has to move the reviewer text out of `deadline_note` and re-verify it (or leave it pending).
- **#594 stays open:** nothing stops reviewer text being saved into the public `deadline_note` column, and the landing's 140-character guard does not catch a short one.
- The pre-change status is recoverable only from this record (`verified`); there is no row-history table.

---

## Operational 2026-09-30 — production blog post `ai-job-search-tools-nigeria-africa` rewritten to match the /vs pages (database change, send-478 follow-up)

| What | Where | When (UTC) | Row |
|------|-------|------------|-----|
| one guarded `UPDATE` of `public.blog_posts.body` | production (`nytwbbzfpytctjsoczzq`), via the Supabase connector | executed 2026-09-30 09:47:23, result 09:47:27 (an `EXPLAIN` validating the statement ran at 09:01:09; nothing was written then) | `id 9a226072-885a-411b-8a6d-437956681f3c` |

**What it did.** The post made the same now-corrected claims as the /vs pages: that Jobright's site "nothing ... engages
with Nigeria", that FreshTalent's JobCopilot applies "fully automated" "up to 50 times a day", and that neither
competitor offers mentorship ("Neither Jobright nor FreshTalent offers anything equivalent"). Six exact substrings
were replaced so the post says what #588's pages now say: Jobright's US focus attributed to an independent review
(zPlatform, September 2026) and to the Jobright pages checked in September 2026; "FreshTalent JobCopilot" named
consistently with its pricing page linked and dated; its auto-apply described as up to 50 a day on the top plan
(5 and 20 on cheaper ones) with approval optional; and the mentorship line corrected (Jobright's Turbo plan is
reported to include live career-coach consultations; FreshTalent JobCopilot's Elite plan lists "AI offer negotiation
and career advisors"). Run after the founder's explicit "yes" to the dry run.

**The guard.** One atomic statement: it updates at most the one published row with that slug, only if EVERY old
snippet occurs exactly once in the body, and errors (writing nothing) unless exactly one row changed. **`updated_at`
was deliberately left alone** (only JSON-LD `dateModified` reads it; no visible "edited" label; no trigger).

```sql
-- send-478 — blog post ai-job-search-tools-nigeria-africa: match the new /vs page wording.
-- NOT RUN. Guarded, single statement (atomic): it changes at most one row, only if EVERY old snippet
-- occurs exactly once in the body, and it errors (writing nothing) unless exactly one row changed.
-- updated_at is deliberately left alone. Dry run (SELECT) results are in the PR thread: all six snippets
-- occur exactly once; result is 3,406 characters (2,899 + 507 before the sixth snippet).
with changed as (
  update public.blog_posts
     set body = replace(replace(replace(replace(replace(replace(body,
       $q$Its own job filters default to United States locations, its headline feature set includes H1B visa filtering, and nothing on the site engages with Nigeria, naira, or any African hiring market. That's not a flaw in Jobright — it was built for a different job seeker. It just means searching for African-market help and landing there won't get you very far.$q$,
       $q$An independent review ([zPlatform, September 2026](https://zplatform.ai/ai-reviews/jobright-ai/)) reports that its job search defaults to US listings and that it ships an H1B visa filter, and the Jobright pages we checked in September 2026 don't mention Nigeria or Africa. That's not a flaw in Jobright — it was built for a different job seeker. It just means it isn't designed around the Nigerian and African market.$q$),
       $q$## FreshTalent's JobCopilot: the closest local competitor$q$,
       $q$## FreshTalent JobCopilot: the closest local competitor$q$),
       $q$FreshTalent, built across 54 African countries, is the one product actually contesting this same ground — and its JobCopilot tool is a real, comprehensive AI job search suite: automated matching, tailored applications, an ATS resume checker, a resume builder, cover letter generation, and interview practice.$q$,
       $q$FreshTalent JobCopilot, which covers all 54 African countries, is the closest product contesting this same ground — a real, comprehensive AI job search suite: automated matching, tailored applications, an ATS resume checker, a resume builder, cover letter generation, and interview practice (some of it on paid plans, per [its pricing page](https://jobcopilot.freshtalent.africa/pricing), September 2026).$q$),
       $q$more about two specific things it doesn't do, and one it does differently.$q$,
       $q$more about two things it doesn't list on its public pages, and one it does differently.$q$),
       $q$JobCopilot's own pitch is applying "while you sleep," up to 50 times a day, fully automated. Talentrah's [Auto-Apply](/how-auto-apply-works) makes the opposite bet:$q$,
       $q$FreshTalent JobCopilot's own pitch is applying "while you sleep," with up to 50 applications a day on its top plan (5 and 20 on the cheaper ones), and its FAQ says you can choose to require approval before each submission. Talentrah's [Auto-Apply](/how-auto-apply-works) makes a different bet:$q$),
       $q$Neither Jobright nor FreshTalent offers anything equivalent.$q$,
       $q$As of September 2026, neither Jobright's nor FreshTalent JobCopilot's public pages describe a mentor marketplace; Jobright's Turbo plan is reported to include live career-coach consultations, and FreshTalent JobCopilot's Elite plan lists "AI offer negotiation and career advisors".$q$)
   where slug = 'ai-job-search-tools-nigeria-africa'
     and status = 'published'
     and (select bool_and((length(body) - length(replace(body, v.old, ''))) = length(v.old))
            from (values
              ($q$Its own job filters default to United States locations, its headline feature set includes H1B visa filtering, and nothing on the site engages with Nigeria, naira, or any African hiring market. That's not a flaw in Jobright — it was built for a different job seeker. It just means searching for African-market help and landing there won't get you very far.$q$),
              ($q$## FreshTalent's JobCopilot: the closest local competitor$q$),
              ($q$FreshTalent, built across 54 African countries, is the one product actually contesting this same ground — and its JobCopilot tool is a real, comprehensive AI job search suite: automated matching, tailored applications, an ATS resume checker, a resume builder, cover letter generation, and interview practice.$q$),
              ($q$more about two specific things it doesn't do, and one it does differently.$q$),
              ($q$JobCopilot's own pitch is applying "while you sleep," up to 50 times a day, fully automated. Talentrah's [Auto-Apply](/how-auto-apply-works) makes the opposite bet:$q$),
              ($q$Neither Jobright nor FreshTalent offers anything equivalent.$q$)
            ) as v(old))
  returning id, slug, updated_at, length(body) as new_len,
            position($q$fully automated$q$ in body) = 0 as fully_automated_gone,
            position($q$nothing on the site$q$ in body) = 0 as nothing_on_the_site_gone
), guard as (
  select 1 / (count(*) = 1)::int as ok from changed
)
select c.*, g.ok from changed c cross join guard g;
```

**What is and is not proven (do not over-read this).** The write is proven by the returned row and a later read. The
*wording* inherits #588's caveats: competitor facts were checked on 2026-09-30 and go stale, and no legal review has
been done. There is no row-history table, so the pre-change body is recoverable only from the six "old" snippets in
the SQL above (each appears verbatim in it).

### Verification (the four, adapted: no repo change, so no merge)

**1. The database's own answer** (the statement's `RETURNING`, 09:47:27):
```
[{"id":"9a226072-885a-411b-8a6d-437956681f3c","slug":"ai-job-search-tools-nigeria-africa",
  "updated_at":"2026-09-20 10:13:36.644989+00","new_len":3419,
  "fully_automated_gone":true,"nothing_on_the_site_gone":true,"ok":1}]
```
A separate read-only query (2026-09-30 ~18:25 UTC) still shows: `updated_at` `2026-09-20 10:13:36.644989+00` (unchanged),
`len` 3419 (was 2,899), 5 "FreshTalent JobCopilot" mentions and 5 "JobCopilot" mentions in total (none bare), old
"nothing on the site" gone, the new Turbo line present.

**2. Repo / fresh clone:** not applicable — nothing in the repo changed. The SQL above is the durable record.

**3. Live production probe.** The page revalidates hourly (`revalidate = 3600`). A fetch seconds after the write
(Date 09:47:54 GMT, `x-vercel-cache: HIT`) still served the old text; it was not forced. Later fetches showed the
new text, and at 2026-09-30 18:25:31 UTC: `GET /blog/ai-job-search-tools-nigeria-africa` 200, "zPlatform" citation: 2,
old "nothing on the site": 0, old "fully automated": 0, `age: 65`, `x-vercel-cache: HIT`.

**4. Full suite:** not applicable (no code). The matching page changes are covered by PR #588's guard test.

### Not covered / still open
- Blog posts are not covered by #588's guard test; a future edit to this post can reintroduce an absolute claim.

---

## Operational 2026-09-30 — production blog post `cover-letters-that-dont-sound-like-a-template`: in-body link moved off a login-gated page (database change, blog-links audit follow-up)

| What | Where | When (UTC) | Row |
|------|-------|------------|-----|
| one guarded `UPDATE` of `public.blog_posts.body` | production (`nytwbbzfpytctjsoczzq`), via the Supabase connector | executed 2026-09-30 06:38:43, result 06:38:46 | `id 7ed1362e-506a-4a78-91a9-2ecc50a30e28` |

**What it did.** The post linked "(/tailor?coverLetter=1)" in its body. `/tailor` is behind the seeker gate
(`PROTECTED_PATH_PREFIXES`), so a signed-out reader of a public blog post who clicked it landed on `/login`. The link now
points at the public `/ai-resume-tailoring`. One substring replaced; `updated_at` deliberately left alone. Run after the
founder's explicit "yes".

```sql
with changed as (
  update public.blog_posts
     set body = replace(body, '(/tailor?coverLetter=1)', '(/ai-resume-tailoring)')
   where slug = 'cover-letters-that-dont-sound-like-a-template'
     and status = 'published'
     and body like '%(/tailor?coverLetter=1)%'
  returning id, slug, updated_at,
            body like '%(/ai-resume-tailoring)%' as has_new_link,
            body not like '%(/tailor?coverLetter=1)%' as old_link_gone
), guard as (
  select 1 / (count(*) = 1)::int as ok from changed
)
select c.*, g.ok from changed c cross join guard g;
```

**What is and is not proven (do not over-read this).** Only the in-body link was changed. The page still renders a
**page-chrome** link to `/tailor?coverLetter=1` ("Write your cover letter with Farah", from `RELATED_LINKS` in
`src/lib/blog/related-links.ts`); that is a known row on PR #590's gated-link allowlist (`main:/blog/* ->
/tailor?coverLetter=1`, owner `prompt-2`), not something this change touched. There is no row-history table; the old
text is recoverable from the `replace()` arguments above.

### Verification (the four, adapted: no repo change)

**1. The database's own answer** (`RETURNING`, 06:38:46):
```
[{"id":"7ed1362e-506a-4a78-91a9-2ecc50a30e28","slug":"cover-letters-that-dont-sound-like-a-template",
  "updated_at":"2026-09-18 06:45:44.489227+00","has_new_link":true,"old_link_gone":true,"ok":1}]
```
A separate read-only query (2026-09-30 ~18:25 UTC): `updated_at` still `2026-09-18 06:45:44.489227+00` (unchanged), `len`
2,427, the `/ai-resume-tailoring` link present, the old in-body link gone.

**2. Repo / fresh clone:** not applicable — the SQL above is the record.

**3. Live production probe** (2026-09-30 18:25:31 UTC): `GET /blog/cover-letters-that-dont-sound-like-a-template` 200; two
anchors to `/ai-resume-tailoring` ("Farah can help you find your own version of …" in the body, and the related-links
"Resume Tailoring"); the one remaining `/tailor?coverLetter=1` anchor is the page-chrome "Write your cover letter with
Farah" described above.

**4. Full suite:** not applicable (no code).

---

## Work chain: the `mentor_profiles_pkey` flake (PRs #562, #563, #574), 2026-09-29

Recorded together because the fix arrived in three steps and only the last one is a root-cause fix.
- **#562** — per-file: `reviewer-claim-race.test.ts` bare inserts → `upsert`.
- **#563** (commit `e682f16`) — per-file: `dual-role-isolation.test.ts` the same.
- **#574** — root cause: `reset_test_pool_user` now clears a former mentor's/mentee's mentorship rows
  child-first (migration `0201`; see the #574 entry below for the mechanism and its four-part
  verification, including the production apply).
- **Empirical check, and its limit.** A recount of the CI history found **6 pkey-class failures on
  2026-09-29** (`dual-role-isolation` ×5, `display-name` ×1), **all before `0201` merged**
  (latest 20:43:05 UTC; `0201` merged 21:23:40 UTC). Since the merge, **0 of the 6** unit-job attempts
  that started failed this way. **Six clean attempts is far too few to claim the flake is gone**
  (rule of three: a 95% upper bound of ~50%); what proves the *mechanism* is the deterministic
  regression test, written red-first. Treat the absence of recurrence as encouraging, not as proof.

---

## Set up 2026-08-26 — CI runs against a second Supabase project

Not a PR. Infrastructure, recorded because it changes what every entry below
this one means: a test run can no longer damage production.

| | Project | Role |
|---|---|---|
| Production | `nytwbbzfpytctjsoczzq` | Vercel points here. Untouched by the repoint |
| CI | `dozaffzgqkbarxtlclsj` — "Talentrah CI", eu-north-1, free tier | GitHub Actions secrets point here |

**Cost: $0/month.** Free tier allows 2 active projects. Pro ($25/mo) buys
per-PR branch isolation at $0.01344/branch/hour — deferred until there is a
second concurrent contributor, since #57's per-ref concurrency already
serialises the one-at-a-time case.

**The costed argument, including the part that weakened it.** The case was
originally put as "seven infra defects today, all downstream of testing against
production". On honest re-count that was overstated: roughly **three of eight**
were genuinely shared-database (borrowed fixtures, auth rate limits, residue
landing in production). The rest — the `listUsers()` pagination class, the
ingest route's 200-on-total-failure, the unchecked deletes — would have
happened anywhere. A staging database makes their consequences harmless; it
does not prevent them.

### No workflow change was needed

`ci.yml` hardcodes no project ref — it reads `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` from secrets.
Updating the secret values IS the repoint. Checked rather than edited.

### How the schema got there, and what to trust

All 26 migrations replayed through the MCP connector — there is no PAT in this
repo, `psql` is not installed and the Supabase CLI is not either, so
`supabase db push` was not available. Verified against production rather than
assumed:

```
tables 28 = 28      policies 36 = 36      functions 25 = 25
public/auth triggers 7 = 7                public enums 25 = 25   (identical names)
authenticated UPDATE column grants        BYTE-IDENTICAL
```

That last line is the one that matters — every `revoke`/`grant (cols)` from
0028, 0030, 0033, 0041 and 0047 reproduced exactly, with `farah_messages`,
`referral_shares` and `match_scores` correctly absent from both. The count gaps
that looked alarming (12 vs 11 triggers, 37 vs 35 enums) were Supabase-managed
`storage`/`realtime` objects.

One deliberate textual deviation: 0045 embeds literal zero-width characters in
a regex, and transcribing those blind is how the JS/SQL drift bug happened in
the first place. Written with `\uXXXX` escapes instead and proved equivalent
across all 11 cases, each of U+200B/200C/200D/2060/180E/FEFF included.

### Proved in both directions

A snapshot before the first green run, and the same query after:

```
production @ 17:15:53Z   35 auth users, 2 orgs, 166 postings, 11 templates
production after run 206 35, 2, 166, 11   — and 0 test-shaped users created since
CI project after run 206 3 seed accounts, 1 org, 149 postings, 8 scholarships
```

Test data landed in CI; production did not move a row. That is the
confirmation, not the green tick — if CI were still pointed at production those
throwaway rows would have appeared there.

### What the first run found, which is the point of doing it

Two hidden dependencies on ambient production data, invisible for as long as
the only database anyone used already had it:

* `template-registry.test.ts` — the CI project had only 0042's four templates.
  seed lists all eleven; it had simply never run there.
* `cross-user.test.ts` — crashed at file level reading `.id` of null. It
  borrows a SCHOLARSHIP the same way it used to borrow a job posting, and a
  fresh project has none. Third and fourth instance of that class, after #59
  and #60 — the sweep those PRs ran covered `job_postings` and not every shared
  table.

### Standing caveats

- **A LOCAL run still hits production.** The isolation is CI-only; `.env.local`
  is unchanged.
- **Both projects need every migration**, and they are deliberately allowed to
  diverge while a PR is in review — CI on write, production on merge.
- **Reference data was bootstrapped by hand** (templates, scholarships, credit
  packs, passes). [PR #61](https://github.com/Bayo-1987/Claude-Talentrah/pull/61) teaches seed the two catalogs it never knew, but
  the ordering problem remains: unit tests run before seed, so a fresh project
  still fails its first run until its reference data exists.

---

## Investigated 2026-08-26 — "the production crons aren't running". They are.

Recorded in full because **this file carried the wrong conclusion for part of
the afternoon**, and because the way it went wrong is more reusable than the
answer.

### The claim, and why it was wrong

I reported that Vercel crons were not firing, so the billing loop was "closed in
code and open in production". The evidence was that
`job_postings.last_checked_at` showed no batch at the 05:00 cron hour across
eight days.

**`last_checked_at` is LAST-WRITE-WINS PER ROW, not an audit log.** Every ingest
overwrites all 146 external postings with the current timestamp, so at any
moment exactly ONE batch timestamp exists — the latest run — plus stragglers
from tests that touched single rows. CI runs the ingest against production
constantly, so the 05:00 cron's timestamps were overwritten later the same day,
every day. The absence of an 05:xx batch was not evidence of anything.

Demonstrated rather than argued: running the pipeline moved all 146 rows to
`14:12`, and the `13:30` batch that had been there minutes earlier was simply
gone.

### What is actually true, from the Vercel dashboard

| Cron | Schedule | Invocations (12h) | Status | Real work |
|---|---|---|---|---|
| `ingest-jobs` | `0 5 * * *` | 1 | **2XX**, 0% error | workable ×21, greenhouse ×1, supabase ×4 |
| `renew-passes` | `0 6 * * *` | 1 | — | 2.69s |
| `ingest-scholarships` | `0 7 * * *` | 1 | — | 2.59s |
| `charge-campaigns` | `0 8 * * *` | 5 | **4XX** | none — these are manual curls |

Cron Jobs is **Enabled**; all four registered. `ingest-jobs` returning 2XX means
`requireCronSecret` PASSED, so **`CRON_SECRET` is set and correct** — closing a
carried-forward founder item that had been open since the API contract work.

`charge-campaigns` merged at ~11:30 UTC, after that day's 08:00 slot, so its 5
invocations are all 4XX from manual probes and its first scheduled run is the
following 08:00 UTC. The mechanism and the secret are proven on a sibling route,
so **the billing loop is closed in production too**.

### Two hypotheses that were wrong, and one retraction

* **Plan cap.** Ruled out: Vercel lifted Hobby's cron limit to 100/project on
  2026-01-20 and this project declares four.
* **SSO / deployment protection.** `ssoProtection` IS enabled at
  `all_except_custom_domains` and the project has no custom domain, so this was
  a reasonable read — but the primary production alias is exempt in practice.
  `claude-talentrah.vercel.app/` serves the app (200) and
  `/api/admin/charge-campaigns` returns the app's OWN
  `401 {"error":"Unauthorized"}`, while the two team-scoped aliases 302 to
  `vercel.com/sso-api`. Crons hit the exempt one.
* **RETRACTED: "zero runtime log entries in 24h".** Worthless as evidence.
  **Hobby runtime log retention is ONE HOUR** — the Logs timeline offers only
  "Last 30 minutes" and "Last hour", with "Last 12 hours" and "Last day" gated
  behind Pro. Cron-hour logs were never retrievable. This was presented as
  supporting evidence and should not have been.

### Where cron history actually lives on this plan

Not in Logs. **Observability → Cron Jobs** (`/observability/cron-jobs`) keeps
invocation counts and status classes for 12 hours, and each route drills into
per-route external-API calls. That is the only view on Hobby that answers "did
this cron run and what happened", and it is worth going to first next time.

### What did come out of it

[PR #59](https://github.com/Bayo-1987/Claude-Talentrah/pull/59) — `ingestAllSources` catches per source and records the reason in
`results[].error`, correctly, so one dead board cannot stop the others. But the
reason travelled only in a **200 response body**, and nothing reads a body:
Vercel records the status code, so a run where EVERY source failed was
indistinguishable from a quiet day. Same shape as the four cleanup bugs found
the same day — resolves without throwing, result never checked, failure reads as
success. Nothing had gone wrong; the route simply could not have told us either
way, which is why this took a dashboard rather than a log line. Total failure now
answers 500, partial stays 200.

### The lesson worth keeping

The repo's standard is to verify against live state. That was followed — and
still produced a confident wrong answer, because **the instrument was
misunderstood rather than the state misread**. A column that is overwritten in
place cannot answer a question about history, however carefully it is queried.
Before treating a measurement as evidence, check that it can distinguish the two
outcomes being tested: `last_checked_at` looks identical whether the 05:00 cron
ran and was overwritten, or never ran at all.

---

## Standing CI defect found 2026-08-26 — a PR can have NO CI and still be mergeable

**FIXED by [PR #57](https://github.com/Bayo-1987/Claude-Talentrah/pull/57)** (merged 13:01:30, `53286ee`) — see that entry above. Left here in full
because it explains why any "CI green" claim recorded EARLIER in this session
is weaker evidence than it appears.

`ci.yml` uses `concurrency: { group: talentrah-shared-supabase,
cancel-in-progress: false }` — a constant key, correct in intent, since what
runs contend over is the one shared Supabase project rather than git history.
But GitHub keeps only the **newest pending run** in a concurrency group and
cancels the others, and it does not re-create them. So a PR's queued run is
discarded whenever anything else queues behind it, and **no check ever reports**.

Observed three times today:
- PR #53's first run (`32963733680`) cancelled after 1m14s when a push to main
  queued behind it; the PR sat with only Vercel's checks and was mergeable.
- PR #51 initially showed no CI run at all, same cause.
- PR #50 has a `cancelled` run in its history for the same reason.

The recovery used was an empty commit. `workflow_dispatch` is **not** available
— the token returns `403 Resource not accessible by personal access token`.

Why it matters: `gh pr checks` on such a PR lists only the Vercel entries and
every one of them passes, so the PR looks green. Anyone merging on that signal
merges untested code. A real fix probably means replacing GitHub's
`concurrency` with a queueing mutex that waits rather than discards, since
discarding is inherent to how `concurrency` resolves pending runs.

---

## Operational 2026-08-26 — production purged of 324 leaked test organisations

Not a merge. A **production data change**, recorded here because it is not
reconstructable from the git history and because it changes what the PR #51
cron will report on its first run.

### The finding

The premise investigated was "ad-campaigns.test.ts has no teardown". It has
one. So do the other six suites that create organisations. **None of them has
ever worked.**

```
afterAll(async () => {
  if (createdOrgs.length)
    await admin.from("organizations").delete().in("id", createdOrgs);
});
```

`job_postings.organization_id` is **NO ACTION, not CASCADE**, so Postgres
refuses the delete — and supabase-js reports that by *resolving* with
`{ data: null, error }` rather than throwing. The error was discarded at all
seven call sites. Reproduced against the live project before anything was
changed:

```
attempting delete of: Campaign Co 8bc26a91
error: { code: '23503',
         details: 'Key (id)=(b32bf622-…) is still referenced from
                   table "job_postings".' }
rows deleted: null
still present after delete? true
```

So the leak rate was **100% per run**, not intermittent — which is why the
count reached 324 organisations, 318 ad_campaigns, 192 ad_wallets and 385
ledger rows.

**Two mistakes, and the second is the one to remember.** Getting the FK order
wrong is ordinary. *Discarding the error* is what let it survive across seven
files for months. A teardown that fails loudly gets fixed the same afternoon;
one that fails silently fills a production database.

### Why it was urgent rather than untidy

117 of the leaked campaigns were `active`. PR #51's cron selects exactly that,
so its first scheduled run would have charged and paused 117 fixtures, and
every future run summary would have reported fake activity as real.

### State before and after, by SQL rather than by the script that did it

| | before | after |
|---|---|---|
| organizations | 326 | **2** |
| — fixtures | 324 | **0** |
| ad_campaigns | 318 | **0** |
| — `active` | 117 | **0** |
| ad_wallets | 192 | **0** |
| ad_wallet_ledger | 385 | **0** |

The two survivors are both real: **Zaria Digital** (`scripts/seed.ts`'s demo
org; the golden-path e2e runs against its postings) and **Fatishcakes** (a real
signed-up employer). Neither owned a single campaign or wallet, so **no real ad
data existed to lose** — checked before deleting, not asserted after.

### The guard that made the delete safe, proven rather than assumed

Selection is an **allowlist** of fixture patterns, so an organisation created by
a future feature is safe by default rather than safe by having been remembered.
On top of that a protected-name assertion aborts the whole run. Mutating the
pattern to the tempting shortening `%.example` gives:

```
ABORTED: fixture patterns matched protected organisations:
Zaria Digital (zariadigital.example)
```

Zaria's own domain is a `.example`, so "just match `.example`" was a real trap,
not a hypothetical one.

### One thing that went wrong, and the check that caught it

The first `--apply` pass deleted 315 of 324 and left 9. The script's closing
self-check refused to report success, which is what it is for. It now converges
over bounded passes, so a partial pass self-heals instead of depending on an
operator noticing. Re-running is a no-op.

### The fix needed two layers, and the first one alone was not enough

A per-suite teardown was the obvious answer and it is only half of one. Both
halves measured, on the branch, rather than reasoned about:

| configuration | leaked |
|---|---|
| `ad-campaigns.test.ts` alone | **0** — 23 organisations before, 23 after |
| 4 org-creating suites, 2 rate-limit failures, sweep disabled | **0** |
| full 33-file run, **all files reported passing** | **21** |
| full 33-file run, rate-limited | **42** |

The delete itself is proven correct at the exact shape and scale that leaks: 21
organisations each with a blocking `job_posting`, removed in 1.7s, 0 remaining
by direct SQL. And the leak is always a whole file's worth (20 orgs + 1
outsider = one run of ad-campaigns.test.ts), which says the hook did not
complete rather than that it deleted the wrong rows.

**What is NOT established is why it fails to complete at full parallelism.**
PostgREST row caps and `db_max_rows` were checked and ruled out. The runs that
would narrow it further are themselves rate-limited by the auth API this suite
hammers, so the question is open.

That unknown argues *for* the backstop, not against it. There is no staging
database; a teardown that silently does not run fills a production table, which
is exactly how 324 organisations accumulated. A sweep that runs once at the
end, unconditionally, does not need the mechanism explained to be correct.

So the fix is two layers:

1. **`deleteTestOrgs`** in each of the seven suites — deletes in FK order and
   **throws**, so a broken teardown fails the suite.
2. **`tests/support/global-teardown.ts`**, wired as vitest `globalSetup` —
   sweeps once after the whole run by a shared allowlist. A safety net, not the
   mechanism: a straggler on a *clean* run means a suite is missing layer 1, and
   the sweep says so loudly. It does not fail the run on finding residue (that
   is the case it exists for) but does fail if it cannot delete.

Proven by planting an organisation with a blocking `job_posting`:

```
[global-teardown] 1 fixture organisation(s) survived their suite's afterAll — sweeping.
[global-teardown] swept 1; 0 remaining.
```

### The sweep immediately found a leaker vitest cannot reach

`E2E Employer Co Vd9de0ad7`, from the **Playwright** suite.
`e2e/employer.spec.ts` had the identical bug a third time: delete postings by
title pattern, then organisations, both errors discarded. Its own comment
correctly noted that organisations do not cascade from their creator and missed
that `job_postings` is what refuses the delete. Now routed through
`deleteOrgsCascade`.

Fixture patterns now live in `tests/support/fixture-orgs.ts` so the three
consumers — per-suite teardown, global sweep, one-time script — cannot drift,
and the protected-name assertion guards all three rather than only the script.

### Follow-up, open not merged

All of the above is in **[PR #55](https://github.com/Bayo-1987/Claude-Talentrah/pull/55)**
(`fix/test-org-teardown`), together with `npm run cleanup-test-orgs`. Until it
merges, every interrupted suite run leaks again.

---

## The 2026-08-26 sweep — what it was actually about

Four items closed in one pass (#44 dedup, #45 org-domain, #46 name-guard, plus
0041 re-confirmed). Read as four tickets they look unrelated. They are not, and
the two things they share are the part worth carrying forward.

### 1. Verify against live data BEFORE designing the fix — it changed the answer twice

Not a process nicety. In two of the four it changed what got built:

* **#44 dedup.** Ranked highest on impact *on the assumption it was firing*.
  Measured: 127 postings, 127 distinct fingerprints, **0 dropped**, and no
  company under two sources. Real mechanism, no live instance. That reframed
  the deliverable from "fix an outage" to "make an invisible failure
  discoverable", and the ranking that drove the ordering of work was simply
  wrong.
* **#45 org-domain.** The brief offered two fixes and **both would have
  failed**. `Fatishcakes` claims `fatishcakes.com` from a **gmail.com**
  address, so it can never verify and holds the domain permanently. A bare
  `unique (domain)` would have locked the genuine employer out of *both* paths
  — create rejected by the index, join rejected because
  `joinOrganizationAction` gates on `verified` server-side — and made domain
  squatting a one-line attack. The naive fix was worse than the bug, and only
  the live row showed it.

The counter-case matters too: **#46 and #41 both checked clean** (no polluted
names in production; 0041's grants intact through four later migrations). The
check is cheap and worth running even when it confirms rather than overturns.

### 2. The recurring root cause is a Postgres grant the app layer forgot about

CLAUDE.md already names this — *"RLS row policies do not restrict columns"* —
and #45 and #46 are both fresh instances of it, from opposite directions:

* **#46** is the textbook case. `signUpSchema` validated names, but `0030`
  grants `update (first_name, last_name, …)` to `authenticated`, so a client
  PATCHes the column and **never executes the validation**. Confirmed live:
  U+200B, U+2060 and a plain space all wrote successfully. The Zod fix alone
  would have changed nothing for anyone not using the signup form.
* **#45** is the same lesson worn differently: `createOrganizationAction` had
  no uniqueness check *and* no constraint behind it, so nothing anywhere
  enforced one-org-per-domain.

The rule that keeps proving itself: **if a client holds a grant on a column,
application validation is UX, not a gate.** The gate has to be in the database
— a CHECK, a constraint, a column grant, or an atomic statement. Every fix in
this sweep that mattered put it there and left the app-layer check in place
only for the error message.

### 3. Two bugs found in the tooling, not the product

Worth their own line because both would have kept costing time:

* **The CI secret scanner reported its own download failure as a leak** (#43).
  Fixed and then *validated by contrast*: on #46 gitleaks genuinely ran and
  genuinely found a hardcoded test password. The two cases are now tellable
  apart from the message alone.
* **The `e2e/employer.spec.ts` flake was concurrent CI runs sharing one
  Supabase project** (#43), not the spec. Root-caused rather than patched.

---

## Confirm-only 2026-08-26 — premium-template gate (0041) still closed

Re-checked rather than re-diagnosed, per the brief. `0041`'s grants survive four
subsequent migrations: `resumes` has **no table-wide UPDATE** and only
`title, structured_content, source, updated_at` granted, so `template_id`
remains unwritable — the gate itself. Its regression suite passes **27/27**,
including `MONEY: cannot apply a premium template by writing template_id
directly`. The companion revokes on `farah_messages` and `referral_shares` are
also intact with no column grants.

One thing that looks alarming and is not: `resume_templates` still reports
`table_wide_update = true`. It has RLS enabled with a single `SELECT` policy and
**no write policy**, so the row policy refuses before the grant is consulted —
the inverse arrangement to `resumes`, established and pinned by tests in 0042.
Do not "fix" it.

---

## Post-merge: test teardown fix (`fix/teardown-timeout`)

The full suite on merged `main` reported a failed *file* while all 209 tests
passed — `tests/credits/spend-race.test.ts`'s `afterAll` blew vitest's 10s hook
budget deleting its throwaway accounts one round-trip at a time. The timeout
aborts the loop partway, so the hook leaks exactly the accounts it exists to
remove, into the shared project, because **there is no staging database**.

Deletions are now parallel with an explicit 60s hook timeout, in that suite and
in `tests/api/rate-limit.test.ts` which had the same shape. Suite is 209/209
green.

Two orphaned accounts from earlier runs remain (`rls-*`, `employer-*`) against
7 real users. Not enough to slow anything; recorded so the number can be
watched rather than rediscovered.

---

## Environment variables the founder must set

Not code changes — these need someone with account access.

| Variable | Where | Why it matters now |
|----------|-------|--------------------|
| `INGEST_SECRET` | Vercel **Production** | **New and load-bearing after #37.** The admin routes now fail closed, which is the point — but every manual admin trigger answers 401 until this is set. Also needed in `.env.local`, because `npm run seed` drives the real ingestion route over HTTP. |
| `CRON_SECRET` | Vercel **Production** | Unconfirmed. Three crons now depend on it (job ingestion 05:00, Pass renewal 06:00, scholarship ingestion 07:00 UTC). No cron has ever been *observed* firing. |
| `GEMINI_API_KEY` | Vercel **Production** | The key on file is free-tier: 20 requests/day, shared. AI features hard-fail past that. |

Leaked-password protection remains a Supabase **dashboard-only** toggle with no
MCP or CLI path. Carried forward, deliberately not worked around.

---

## Missing input documents

The priority backlog dated 2026-08-25 refers to roughly fifty prompt files in
this directory. **None of the following exist** — checked in the repo root and
across `~/Desktop`, `~/Documents` and `~/Downloads`:

- `handoff-status.md` (this file now stands in for it)
- `schema-org-job-ingestion-prompt.md` — backlog item 2
- `test-scenarios-job-feed-matching-prompt.md`
- `test-scenarios-external-api-integrations-prompt.md`
- `test-scenarios-employer-prompt.md`
- `test-scenarios-scholarships-prompt.md`
- `test-scenarios-resume-builder-prompt.md`
- `test-scenarios-tailoring-credits-payments-prompt.md`
- `test-scenarios-auth-onboarding-prompt.md`
- `talentrah-gtm-brief.md`, `competitive-landscape-brief.html`,
  `pricing-validation-prep-prompt.md`

Present and readable: `CLAUDE.md`, `talentrah-build-prompt.md`,
`talentrah-editorial-design-handoff.md`, `Main-Editorial.dc.html`,
`JobFeed-Editorial.dc.html`, and the plan at
`~/.claude/plans/adaptive-giggling-ember.md`.

The backlog's one-line summaries of each missing brief are enough to *work
from* — but not enough to honour instructions like "read its §0/§1 before
touching a source," which for the schema.org brief carries the source-eligibility
rules. Those need the real files.

---

## Open backlog

1. ~~Merge #35, #36, #37~~ — **done**, verified above.
2. ~~schema.org/JobPosting ingestion~~ — **done**, PR #39, see above. Arrived
   as a patch rather than being built here. One pilot source
   (`jobs.workable.com/search/nigeria`); `hotnigerianjobs.com`, `jobberman.com`,
   `myjobmag.com` and `fuzu.com` all checked and rejected, Fuzu's ToS
   independently re-verified. Broader reliance still gated on §10 item 10.
3. ~~**Test-coverage briefs**~~ — **all closed.** The 2026-08-26 sweep took the
   five scoped to it (dedup, org-domain, premium-template, zero-width, employer
   flake), plus Paystack earlier and the empty-200 guard after. Kept below as
   the record of what each was and how it was closed:
   - ~~Cross-source dedup hash collisions destroying a posting's apply link~~
     — **done**, PR #44. Mechanism real but not firing; fixed and made
     discoverable via `IngestSourceResult.collided`.
   - ~~A transient empty-200 ingest response mass-closing a source's live
     postings~~ — **done**, PR #47. Was the last item outstanding; the guard
     refuses to close when a fetch is empty but open postings exist, on both
     the company-scoped and source-scoped paths, and reports the skip.
   - ~~A Paystack blip being indistinguishable from a real decline~~ — **done**,
     PR #42 / migration 0043. Also closed the "no external call anywhere sets a
     timeout" item outright: those were the last untimed calls in the repo.
   - ~~Duplicate org names/domains unguarded~~ — **done**, PR #45 / migration
     0044. Scoped to VERIFIED orgs only; a bare unique index would have locked
     real employers out behind unverifiable squatters.
   - ~~Premium-template gate bypassable via a direct `PATCH` to
     `resumes.template_id`~~ — **done**, PR #40 / migration 0041. Confirmed live
     and fixed; the sweep also found and fixed the Farah rate-limit bypass.
   - ~~A zero-width character defeating the "no name yet" guard~~ — **done**,
     PR #46 / migration 0045.
   - ~~`e2e/employer.spec.ts` flake~~ — **closed**, PR #43. Root-caused to
     concurrent CI runs sharing one Supabase project and fixed with a
     constant-key concurrency group; the spec itself needed no change.

Items already closed that these briefs still describe as open — confirm, don't
re-diagnose: the ingestion trigger's fail-open (#37), the `spendCredits` race
and the scholarship credit try/catch gap (#34), and the resume-builder
credit-spend race (#34).

---

## Next: employer billing (Phase 2)

No backlog items remain. The next piece of roadmap work is **employer billing**,
chosen over Ad Campaign Manager because it is the prerequisite — you cannot
charge for a campaign without it — and because the Paystack rails and
decline/indeterminate handling are freshly hardened and well understood after
PR #42.

A design brief exists at [docs/employer-billing-plan.md](docs/employer-billing-plan.md)
and is **a proposal, not a decision**. No code and no migrations have been
written. It covers: what is genuinely reusable from the Pass machinery versus
what only looks reusable (`runPassRenewalJob`'s fixed-price/fixed-date shape does
not map onto metered ad spend); an atomic wallet decrement modelled on
`spend_credits_atomic` from the first commit rather than hardened later; the
zero-balance policy (campaigns **pause**, they do not run negative and get
invoiced) with the reasoning written out; and rail-as-data so a top-up's rail is
a property of the transaction even though v1 wires only Paystack NGN.

Four questions in it need a founder answer before schema exists. The sharpest is
**refunds**: if an unspent balance must be withdrawable, that is payouts and KYC
— exactly what §6.7 avoided for referrals by choosing credits over cash.
