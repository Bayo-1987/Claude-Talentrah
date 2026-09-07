# Employer share link & verification — three things not built here

Stage 7 shipped the shareable job link (Copy link / WhatsApp / LinkedIn / X on
each row in `posted-job-row.tsx` and on the post-success surface,
`src/app/employer/jobs/page.tsx`) and fixed the unverified-org banner to state
the real reason (`evaluateDomainVerification`/`verificationMessage`,
`src/lib/employer/verification.ts`) instead of one hardcoded "add your
domain" string that was wrong for `domain_mismatch` and `consumer_email_domain`.

Three things came up while doing that work which are explicitly **not**
built — each is a real gap, each needs a founder call before code, and each
is written up here with what was actually found rather than left as a bare
"TODO founder decides."

---

## 1. `domain_mismatch` / `consumer_email_domain` have no path forward at all

**What's confirmed.** `updateCompanyProfileAction`
(`src/lib/employer/actions.ts`) only ever writes `name`, `domain`,
`description`, `logo_url` on the organisation. For two of the five
`VerificationOutcome` reasons, re-typing the same domain field can never fix
anything:

- **`domain_mismatch`** — the account's own email is at a different domain
  than the one claimed. Re-typing the domain doesn't change the account's
  email.
- **`consumer_email_domain`** — the account signed up with a personal
  provider (`gmail.com` and the rest of `CONSUMER_EMAIL_DOMAINS`).
  `isConsumerEmailDomain` blocks this structurally and permanently: no domain
  typed into the field will ever verify an account whose own email is on that
  list, because the rule requires the *account's* email to match the domain,
  and a personal-provider email can never match a company domain by
  definition.

Fatishcakes (production, real org, `@gmail.com` account) is currently in
exactly the second state — permanently, with the current tools.

**Two real paths, not mutually exclusive:**

**(a) Invite a teammate whose email matches the domain.** Confirmed there is
*no* existing organization-member invite UI anywhere in the app —
`organization_members` is only ever written by `createOrganizationAction`
(creator as `owner`) and `joinOrganizationAction` (joiner as `admin`), both in
`src/lib/employer/actions.ts`, neither exposed as an invite flow. Building
this for real means: an invite record (email + org + a token, or reusing
Supabase's own invite-by-email if that's viable for this schema), a
join-by-invite Server Action, and a decision on what a non-owner `admin` role
is actually allowed to do today (worth checking — this repo has never needed
that answer before because nothing ever created a second member). This is the
better long-term fix for `domain_mismatch` specifically (an account holder
who works at the company but signed up with a personal address, or a
recruiter managing the account from outside) — but it does nothing for
`consumer_email_domain` orgs where *nobody* on the account has a matching
work email yet.

**(b) A manual-review request.** A button that records "this org is asking a
human to look at their verification" — a new boolean or timestamp column on
`organizations` (e.g. `manual_review_requested_at`), an admin-side queue to
act on it (the admin dashboard already exists per `docs/admin-auth.md`, so
this would be a new admin surface, not new infrastructure), and a decision on
what "approved on manual review" actually means for the `verified` column —
does it get set the same way the automated path sets it, with the same
consequences? This is the one path that helps `consumer_email_domain` orgs
too, since it doesn't depend on anyone having a matching email at all.

**Not proposing which one, or both — that's the founder's call**, same as
`verification.ts`'s own header explicitly leaves "should domain ownership be
proven for real (DNS TXT, a postmaster@ email)" open rather than settling it.
Whichever is chosen, it's a real schema change (at minimum a new column on
`organizations` or a new invites table) and comes back for review under the
standing migration rule regardless of which PR it ships in.

---

## 2. The abuse surface of an "unlisted but linkable" visibility state

> **BUILT (0107, 0108).** This section was written as input to a founder
> decision. That decision was made — build it, with the mitigation this
> section proposed — so what follows is now the *rationale for what shipped*,
> not an open question. The abuse analysis below is unchanged and still the
> reason the gate exists; only its status has moved.
>
> What shipped: `job_postings.unlisted_at`, a service-role-only trust column,
> plus one new RLS branch making a stamped row readable by id whatever its
> org's verification state. Minting is per-posting, once, behind a **confirmed
> email** and a **5-per-24h** limit — exactly the "cheap mitigation" proposed
> at the end of this section, both halves of it. Per-posting and not per-org
> is load-bearing: "readable if the org is unverified but confirmed" would
> have exposed every posting of every unverified org the moment it held, which
> is the gate 0027 exists to keep shut.
>
> **The bullet below that says "not in the feed, search, or sitemap" named
> search from the start, and the build still missed it.** Widening the RLS
> policy silently opened every listing surface, because none of them ever
> filtered on `verified` themselves — they relied on RLS to hide unverified
> orgs for them. Fourteen PostgREST queries were updated for that reason. The
> fifteenth, `search_job_postings` (0100), is SQL rather than a client query,
> so nothing in the TypeScript diff pointed at it: an unlisted posting stayed
> out of the feed and came straight back the moment anyone typed a word from
> its title. Confirmed against a live database, then fixed in 0108. The
> lesson worth carrying: a surface enumerated in prose is not a surface the
> diff will remind you about.
>
> One deliberate exception to "not in the feed": **the posting's own org still
> sees it there.** Minting is automatic — it happens on the next Jobs Posted
> render, with no action from the employer — so excluding unlisted rows from
> everyone would make a job vanish from its own poster's feed moments after
> they posted it, for a reason invisible from either page. 0027's member
> clause already prevents that; the feed and 0108 both honour it rather than
> re-opening the hole above the database.

The founder decision this section was written for: should a job have a third
visibility state — not in the feed, search, or sitemap, but
reachable by whoever has the direct link — so an org mid-verification (or one
that will never verify, e.g. a one-off contract poster) can still send a link
to a specific candidate?

`src/lib/employer/job-visibility.ts` is written so this slots in as a third
value on `JobShareVisibility` without a rewrite — every caller already
switches on the named result rather than a boolean. That's as far as this PR
goes. Before building it, here's the real abuse surface, so the decision has
something to weigh against rather than just the upside:

- **"Unlisted" is not confidential.** A link is a link — once shared once
  (a WhatsApp group, a public Slack, a tweet), Google and everyone else can
  reach it exactly as if it were fully public, just without the courtesy of
  being *found* through this site's own search or sitemap. Any content-safety
  assumption resting on "it's not listed, so it's fine" is false the moment
  one recipient forwards it.
- **It's a moderation bypass, not just a discovery bypass.** Right now,
  "verified" is the only gate a posting has to clear before it's reachable by
  anyone outside the org. An unlisted state that requires *no* verification
  step at all would let a brand-new, entirely unvetted account generate a
  live, shareable, seemingly-legitimate Talentrah URL the moment they finish
  the posting form — before any human or automated check has looked at the
  content. That is a meaningfully lower bar than what a scammer needs today
  (currently: get verified first, which at minimum requires a real work email
  domain).
- **It's a distribution channel for recruitment scams specifically** — a
  known abuse pattern on job boards generally (fake-job / advance-fee scams,
  data-harvesting "apply here" forms) — because an unlisted link still
  carries this site's branding, JSON-LD structured data, and an "Apply"
  button that looks exactly as legitimate as a verified posting's. The
  feed/search/sitemap absence removes Talentrah's own visibility into which
  unlisted postings exist and how many candidates are visiting them, which is
  also exactly the visibility a trust-and-safety response would need.
- **A cheap mitigation, if this is built:** gate the unlisted state behind
  *some* minimum bar below full domain verification but above nothing —
  e.g. requiring a confirmed email (any domain, not necessarily a matching
  one) before an unlisted link can be generated at all, and/or rate-limiting
  how many unlisted links a single unverified account can mint. Neither
  closes the gap, both raise the cost of abusing it.

Built, with the mitigation, after the founder weighed the above against the
real legitimate use case (Fatishcakes-style orgs who have a real job and a
real candidate, just no path to full verification yet).

Two things this section got right that are worth keeping in view now that it
is live, because neither is fixed by shipping:

- **"Unlisted" is still not confidential.** Nothing built here changes that.
  A forwarded link is as reachable as a public one; the absence is from
  *discovery*, not from the web.
- **The trust-and-safety visibility gap is real and still open.** Keeping
  unlisted postings out of the feed, search and sitemap also keeps them out of
  Talentrah's own view of what exists and who is visiting. The confirmed-email
  gate raises the cost of minting one; it does not tell anyone that one was
  minted. If unlisted links are ever abused at volume, that is the thing that
  will be missing, and it is not in this build.

---

## 3. Application attribution needs a schema change — not built here

**The ask:** let an employer see how many applications arrived through their
shared link specifically, as opposed to organic feed discovery. That's the
number that makes an employer share again.

**Checked, not assumed, before concluding this needs new schema:**

- `applications.source` (`application_source` enum: `internal_apply` |
  `manual` | `auto_apply`) is fully consumed by *how* an applicant applied,
  not *how they found the posting* — and those are genuinely different
  dimensions. Someone who discovers a job via a shared link still applies
  through the exact same `internal_apply` mechanism as someone who found it
  browsing the feed. Overloading this enum with a fourth value like
  `shared_link` would conflate two orthogonal facts about one application
  rather than adding a real slot for the new one.
- `notes` is user-owned and user-editable (`tracker-actions.ts` lets the
  applicant overwrite it freely) — unsafe to carry a system-set attribution
  value an applicant could blank out or fake.
- `manual_job_snapshot` / `resume_snapshot` / `cover_letter_snapshot` each
  serve a distinct, already-documented purpose (surviving the underlying
  row being deleted) — repurposing any of them risks colliding with that
  contract the next time someone reads their own header comment and trusts
  it.
- No column on `job_postings` fits either — attribution is a property of the
  *application*, not the posting.

**Conclusion: a schema change is required.** The shape that would actually
work, modeled on 0099's own `referral_shares.surface` pattern but as a new
column rather than extending that table (per `ShareJobButton`'s own header
comment, a job share must never be written into `referral_shares` — that
table is the referral funnel a reward is paid against, and a job share is not
a referral):

```sql
-- NOT APPLIED — proposal only, for founder review under the standing
-- migration rule.
alter table public.applications
  add column discovered_via text;

alter table public.applications
  add constraint applications_discovered_via_check
  check (discovered_via is null or discovered_via = any (array['job_share'::text]));
```

This alone isn't sufficient, though — it's just where the signal would be
*stored*. Getting a value into it at all needs a capture mechanism, the same
shape PR #240 already built for referral capture: a query param on the share
link (e.g. `/jobs/[id]?src=share`), a short-lived cookie set on landing
(mirroring `src/proxy.ts`/`cookie.ts`'s existing `?ref=` capture), and a read
of that cookie at apply time in `applyInAppAction`
(`src/lib/applications/actions.ts`) to populate `discovered_via`. None of
that capture plumbing exists yet either — this is a two-part feature (schema
+ capture flow), not a one-line column add, and both parts are being flagged
together rather than the column landing alone with nothing to ever populate
it.

Not building any of this here, per the explicit instruction: a migration
comes back for founder approval regardless of CI, and this whole feature is
schema-first.
