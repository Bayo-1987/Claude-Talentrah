# QA accounts: what they are, where they are hidden, where they deliberately are not

QA accounts are owner-authorised test accounts that live on production (QA Seeker, QA Employer, QA Mentor: `hello+qa-*@talentrah.com`). Real people must never see them, and the numbers employers and the team read must not count them. This page is the one place that says how, so a new surface is added the same way.

## The rule (one definition)
An account is a QA account when its **email contains `+qa-`** (case-insensitive) **or** a name is exactly `QA` or **starts with `QA `** (first name, full visible name = first + last, a mentor's `display_name`, the referral-leaderboard handle). Code: `isQaAccount` and `isQaName` in `src/lib/profile/qa-account.ts`; tests: `tests/profile/qa-account.test.ts`.
- The name match is **case-sensitive on purpose**: a real "Qa Hoang" or "Qasim" must never disappear from a list. "QAnon", "QA-Team" and "Qatar Airways" are not QA names (the prefix is "QA" and a space).
- Trimming is **spaces only** (U+0020), exactly like Postgres `btrim`: a name that starts with a tab, a newline or a no-break space is not a QA name. The SQL twin `public.is_qa_account` (migration 0240, S3-21) must keep the same rule; the cases in `tests/profile/qa-account.test.ts` are its fixture list.
- Known limits: `profiles.email` is a copy taken at signup (no re-sync trigger), and a session client can never read another user's email, so a list read with a session client can only use the name rule. A real user who plus-addresses a mailbox as `name+qa-something@...` would match; that is the owner's chosen rule.

## Where it applies
| surface | how | where |
|---|---|---|
| signed-in mentor list (`/mentorship`) | by name, in memory (the names are already fetched) | `browseMentors`, `src/lib/mentorship/queries.ts` |
| public mentor price range and "some mentors offer free sessions" | email and name, in the existing service-role query | `src/lib/mentorship/public-price-range.ts` |
| product analytics (PostHog) | a cached lookup by user id inside the deferred callback | `captureEvent`, `src/lib/analytics/posthog.ts` |
| ad analytics (`ad_events`: impressions, clicks, applies) | the same lookup, in the two writers | `src/lib/ads/promoted.ts` |
| Talent Directory (list, candidate, preview, the "N of 10" count, the Subscribe gate), referral leaderboard | SQL: one predicate in `talent_directory_listed_ids()` and the other functions that repeat it, and in `referral_leaderboard` | migration 0240 (S3-21); see the migration register for its status |

The lookup by id (`isQaUserId`, `src/lib/profile/qa-account-server.ts`) costs at most one indexed primary-key select of three columns per distinct user per 10 minutes per server instance (cached in memory, bounded), runs after the response where the caller allows it, and **fails open**: a read error, a missing row or a missing client never drops a real user's event, and an error is not cached.

## Where it deliberately does NOT apply, and why
- **`credit_gate_events`, `farah_session_events`, `country_default_events`, `resume_builder_start_events`, `application_stage_events`**: operational evidence of money and gate decisions (the 0236 verification counts `credit_gate_events`; QA's journeys and post-merge checks read them). Dropping QA rows would blind the checks the QA accounts exist for. They are not analytics a customer or the public sees.
- **A mentor's own profile page and booking, read by id** (`/mentorship/<mentor id>`): not a listing, and QA's booking journeys reach their QA mentor through the direct link. The list hides QA mentors; the page does not.
- **Vercel Analytics and Speed Insights**: client-side page-view beacons, not tied to a user, so they cannot be excluded on the server.
- **Admin-only counts** (signups, finance, ops): not public; they still include QA accounts unless the owner asks otherwise (each would need one `.not("email", "ilike", "%+qa-%")`).

## Adding a surface
1. Decide whether it is public or analytical (hide it) or operational evidence (leave it).
2. Where the code holds the fields, call `isQaAccount`; where it only holds a user id, call `isQaUserId` (server, after the response if you can). Where the data is read through SQL, use `public.is_qa_account`, never a TypeScript post-filter on a list that is limited or paged in SQL (it breaks the limit, the ranks and the counts).
3. Write the test first: a QA account is hidden or skipped, and a normal account still shows (see `tests/mentorship/qa-account-exclusion.test.ts`, `tests/analytics/posthog-qa-exclusion.test.ts`, `tests/ads/qa-ad-events.test.ts`).
4. State the per-request cost in the PR text.
5. Add the surface to the tables above.
