# Talentrah — Project Context

This file is a persistent summary for AI coding sessions on this project. Full detail lives in two source docs — **read them, don't just this summary, before doing real spec or design work**:
- [talentrah-build-prompt.md](talentrah-build-prompt.md) — product spec, strategy, data model, phasing, monetization, all `[DECIDE]` open items.
- [talentrah-editorial-design-handoff.md](talentrah-editorial-design-handoff.md) — visual/design system, content rules.
- [Main-Editorial.dc.html](Main-Editorial.dc.html) / [JobFeed-Editorial.dc.html](JobFeed-Editorial.dc.html) — real working HTML/CSS reference markup (exact spacing/colors/type). Copy values from these, don't eyeball.
- Live click-through reference: https://claude.ai/code/artifact/d150ad75-1b0f-4b3b-bcfb-a00e17cac229 ("Editorial — Full Build" page)

The approved Phase 1 build plan (milestones, tech stack, data model) lives at `~/.claude/plans/adaptive-giggling-ember.md` — refer back to it during implementation rather than re-deriving scope.

## App scaffold

This repo root is also the Next.js app root (App Router + TypeScript + Tailwind, scaffolded via `create-next-app`). `AGENTS.md` is auto-generated/re-added by `next dev` — it points at `node_modules/next/dist/docs/` for version-specific API/convention docs and should be committed as-is, not deleted from diffs. Don't hand-edit `CLAUDE.md` back to a `@AGENTS.md` stub — that was the scaffolder's default and got overwritten with this file on first setup.

Supabase backend: project **"Talentrah"** already exists in the connected Supabase org (`Bayo-1987's Org`), project id `nytwbbzfpytctjsoczzq`, region `eu-north-1`. Reuse it — don't create a new project. It free-tier-pauses when idle; `restore_project` before running migrations/queries if `get_project` shows `INACTIVE`.

**Migrations 0001–0025 are not in this repo** — they were applied straight to the project through the MCP connector, so the project's own `schema_migrations` table is the only history. From 0026 on, write the SQL into `supabase/migrations/` **first** so a policy change can be reviewed in a diff, then apply it. See [supabase/migrations/README.md](supabase/migrations/README.md).

**There is no separate test/staging database.** The RLS suites, Playwright and `npm run seed` all run against the live project. They namespace and clean up their own throwaway users, but assume nothing else about isolation.

## Current build state

**Phase 2 has started.** Auto-Apply shipped as its first milestone — review-queue
gated, Excellent-only, server-capped, credits beyond a free weekly allowance.
Read [docs/auto-apply.md](docs/auto-apply.md) before touching it; the two things
most likely to be got wrong are that its threshold is re-read live at confirm
time (not from the queue row's snapshot) and that its cap is atomic in Postgres
because a read-then-act cap is not a cap. **Auto-Apply never submits to external
postings** — there is no ATS integration, so external matches are handed off to
the source site and marked `handed_off`, never `applied`.

Phase 1 is feature-complete except for the employer side. Read [docs/phase-1-summary.md](docs/phase-1-summary.md) before assuming any feature's status — it is kept current and lists what shipped, what is deferred, and the open defects with their evidence. Two that shape most decisions:

- **The employer side now exists, in its Phase 1 subset only**: org onboarding, Company Profile, free job posting, Jobs Posted. Ad Campaigns, billing and analytics are Phase 2 and are deliberately **absent from the employer nav** rather than stubbed — don't add placeholder pages for them, and don't describe them as shipped. Building this surface is what exercised the org RLS policies for the first time and found the third hole in them (0028).
- **Anything that gates on a counted or compared value must check and act in ONE database statement.** A read-then-write in JS is not a gate: `spendCredits` looked correct for months and let two concurrent spends both succeed at `balance == cost`, because the ledger trigger overwrites `credits_balance` absolutely rather than decrementing it. The pattern to copy is `spend_credits_atomic` (0035) — a conditional `UPDATE … WHERE balance >= amount` — or `auto_apply_claim_submission` (0034) where several conditions must hold together under one lock.
- **`hired` is terminal on `applications` except → `archived`** (0037), enforced by a trigger rather than in the Server Action, because the owner-only `FOR ALL` policy makes any app-layer rule reachable around via a direct PATCH. Deliberately narrow: every other stage correction stays allowed, because the tracker is the user's own record and blocking mis-click fixes would be a worse product than the bug.
- **The test suites create a lot of auth users and can hit Supabase's auth request rate limit** when run back-to-back. A run that fails with `AuthApiError: Request rate limit reached` is not a real failure — wait a few minutes and re-run.
- **RLS row policies do not restrict columns.** Supabase grants `ALL ON ALL TABLES` to `authenticated`, so a permissive UPDATE policy lets the owner rewrite *every* column on their own row. Any column carrying trust, money or identity needs a Postgres column grant, not a policy — `revoke update on <table> from authenticated`, then `grant update (<safe columns>)`. The order matters: a table-level grant overrides a column-level revoke. This produced four live findings (0026, 0027, 0028, 0030); `tests/rls/column-privileges.test.ts` is the standing check, and adding a value-bearing column to a user-writable table should fail it until you decide deliberately.
- **If an RLS policy calls a function, every role that evaluates that policy needs `EXECUTE` on it — including `anon`.** Postgres evaluates a policy as the calling role, and a policy with no `TO` clause applies to `public`. Revoking a grant to "tidy up" is a denial-of-service on your own public surface: 0027 did exactly that and made `job_postings` error for signed-out visitors until 0032 restored it.
- **An organisation's job postings only reach the public feed once `organizations.verified` is true** (0027), and **no client can write `verified`** (0028) — it is set server-side from the session user's confirmed work-email domain, and nowhere else. Anything that surfaces internal postings must not work around that gate, and anything that grants verification must not do it from user input.
- **This repo is PUBLIC. Never commit a working credential, and never assume deleting one later undoes it** — anything pushed is permanently exposed, so rotation is the only real fix. The demo account's password comes from `DEMO_PASSWORD`; the seeded referral accounts get a random password per run. Both are re-asserted on every seed run, so rotating the source actually retires the old value. A full history sweep is written up in [docs/secrets-audit.md](docs/secrets-audit.md).
- **Production runs Gemini on a free-tier key** (20 req/day, shared). A billed key is a founder/account action, not a code change.

Verification convention this repo holds itself to, visible throughout its PR history: **check real current state before building; prove a fix by first proving the test catches the bug.** Several milestones caught real defects specifically by re-testing what earlier work had assumed — an RLS policy that had never been run, a retry heuristic that looked like model behaviour, an OAuth name mapping where the intuitive fix would have repaired the wrong provider, and an org-membership policy that read as safe and was not. That last one is also the standing example of a second habit: after fixing a policy, ask what *else* grants the same privilege — the first fix closed one route and, in doing so, opened a second.

---

## What Talentrah is

An AI-powered career platform for job seekers in Nigeria/Africa, with a self-serve employer side. Two-sided:
- **Job seekers**: AI-matched job feed, paste-a-job-link → instant tailored resume + cover letter, application tracking, resume builder, referrals, human mentorship (deferred).
- **Employers**: post jobs, company profile, self-serve ad campaigns.

**Farah** is the AI copilot — a named, consistent-voice persona (encouraging, direct, practical) threaded through the whole seeker experience, not a bolted-on chatbot. Never call her "the AI" or "the bot."

**Core differentiation thesis**: Jobright/LinkedIn/Indeed are US-centric and underserve Nigerian/African job seekers — real gap, but a *hypothesis to validate* with real users, not an assumed fact. Talentrah's actual product-level differentiators vs. AI-only competitors:
1. Real human **Mentorship** marketplace (not just AI "coaching") — deferred until core loop proves retention.
2. **Auto-Apply** positioned as a trust/quality feature (review-before-submit default, conservative match threshold) — not a spam-driving volume feature.
3. Lower visual density than incumbents (see Design System below) — calm/editorial, not sales-driven SaaS.
4. Diaspora expansion (UK/US/Canada Nigerians) as a natural Tier-1 hard-currency market — NOT competing head-on for US/UK job seekers generally.

## Strategic prioritization (don't build all bets at once)

**Load-bearing for launch:**
- Localization validation + execution
- Job supply/liquidity via aggregation (§6.12 of build prompt) — product is useless without real jobs
- Core AI tailoring loop (JD import → gap analysis → tailored resume) — the actual "aha moment"

**Explicitly deferred until core loop proves retention:**
- Mentorship marketplace (§6.11) — second cold-start problem; if forced to pick the next big bet, **Talent Directory & Verification (§6.13) comes before Mentorship** (monetizes both local + global employers, no separate marketplace bootstrap).
- Deep virality/shareable mechanics (job search is often confidential — private-by-default).
- Outcome-data matching moat (too noisy with small early user base).

## Build phasing (see build-prompt §9 for full detail)

- **Phase 1 (MVP)** — currently being built, see the plan doc referenced above: auth/onboarding, resume upload/parse, job aggregation pipeline, match-scored feed, manual apply, Job Tracker, Resume Builder (subset templates), JD paste-text tailoring, Farah chat panel, free org job posting, Refer & Earn (credits-only), Credits + Prepaid Passes with mobile-money-native payment rails (Paystack).
- **Phase 2**: Auto-apply, full template library, Ad Campaign Manager (flat-rate → CPC), employer billing, URL-scraping JD import, "claim your listing" flow, diaspora currency/billing.
- **Phase 3**: Talent Directory & Verification, internships, Mentorship marketplace, CPA billing, referral leaderboard, proactive Farah nudges.
- **Phase 4**: Managed Services commercial launch (recruitment/staffing/outsourcing) — lead-capture only, manual sales. In-house dev-project outsourcing is **explicitly cut from the roadmap entirely** (it's a different business).

## Information architecture

**Job seeker nav** (masthead, not icon sidebar): Jobs · Job Tracker · Resume Builder · Refer a Friend · Mentorship (deferred) · Feedback · Settings. Persistent: global search, notifications, language selector, "Post Job" shortcut, credits/upgrade CTA, profile menu, docked Farah panel on key screens.

**Employer nav**: Jobs Posted · Company Profile · Ad Campaigns · Billing · Analytics.

## Key feature specs (see build-prompt §6 for full detail on each)

- **6.1 Landing/onboarding**: interactive JD-tailoring demo embedded pre-signup (rate-limited, one free run/session/IP), no invented social proof/stats, no hero video for v1. Footer carries employer links, legal/trust, WhatsApp + Telegram community links. No region/currency selector in v1.
- **6.2 Job feed**: tabs (Recommended/External/Most Recent/Saved), removable filter chips, Auto-Apply toggle (conservative default: capped, review-before-submit, activity log), job cards show Match Score prominently + "Ask Farah" quick action, restrained badge density. Clearly distinguish internal vs. aggregated/external jobs.
- **6.3 JD import → tailoring**: paste URL or text → parse → Farah gap analysis → tailored resume + cover letter → ATS score + specific fixes → export PDF/DOCX. First tailoring run + first cover letter are one-time free trial; everything after draws from Credits.
- **6.4 Resume Builder**: template gallery by industry → editor (drag-reorder, AI bullet rewriting) → preview/finalize. Free tier = limited templates; more via credits/pass.
- **6.5 Farah**: docked panel (job feed, resume builder) with quick actions (CV Builder, Interview Prep, Career Advisor, Cover Letter, Salary Negotiation) + free-text chat. Farah's coaching stays informational/scalable (benchmarking, talking points, practice Q&A) — routes to human Mentorship for high-stakes/judgment situations (real offer, real interview, real negotiation). Farah is the on-ramp to Mentorship, not a competitor to it.
- **6.6 Job Tracker**: Saved → Applied → Interviewing → Offer → Rejected/Archived. Manual entries allowed. Marking "Hired" triggers the post-success lifecycle flywheel (referrer/mentor invite prompts).
- **6.7 Refer & Earn**: unique link, WhatsApp-priority sharing, funnel tracking (invited→signed up→activated→reward), anti-abuse (self-referral detection, activation-gated payout). Prefer credit rewards over cash (avoids KYC/payout infra).
- **6.8 Employer ads**: sponsored listings (build first) → banner/display → featured employer profile. Pricing model: flat-rate first, then CPC, CPA deferred (needs reliable attribution). Employer billing via Paystack/Flutterwave.
- **6.9 Monetization**: free/uncapped for zero-AI-cost actions (browsing, tracker, algorithmic scoring). One-time free AI trial at signup, not renewable. **Talentrah Credits** for all AI actions beyond that (tailoring, cover letters, bullet rewriting, premium templates, auto-apply beyond free cap). **Passes** (7-day/30-day): auto-renew if paid by card (Paystack/Flutterwave token or Stripe for diaspora), stay prepaid/non-renewing if paid via mobile money wallet. Mentor sessions are NOT a credits action — paid directly, real cash pass-through. Multi-rail payments (mobile money + card) required from day one, not retrofitted. Pricing anchors: credit ≈ ₦150; packs ₦2,500/₦6,000/₦12,500; passes ₦2,000 (7-day) / ₦6,500 (30-day); diaspora subscription $9.99/mo — all researched anchors, **not validated**, need a real pricing test before locking in.
- **6.10 Notifications**: transactional (immediate: status change, referral conversion, ad milestone, pass renewal reminder) vs. digest (batched: new match digest). Voice by sender: Farah-voiced for relationship-y notifications (matches, referrals), neutral system voice for factual/B2B ones. Voice by channel: in-app terse, email structured, WhatsApp conversational. Template-variable based copy, not hardcoded.
- **6.11 Mentorship** *(deferred)*: real human mentors, clear line vs. Farah's shortcuts (mentors = high-stakes/judgment: mock interviews, negotiation for a specific offer). Profiles, discovery, booking, session lifecycle, vetting/approval queue. Payments direct (not credits); free/volunteer mentors are a permanent option, not just bootstrap. Session pricing ₦5k–₦100k+ by tier; **platform commission 15% flat**.
- **6.12 Job supply/liquidity**: aggregate via ATS APIs (Greenhouse, Lever, Workday, etc.) + schema.org JobPosting data + regional board partnerships (Jobberman, MyJobMag, Fuzu). Avoid scraping ToS-prohibited platforms (LinkedIn, Indeed). "Claim your listing" employer conversion flow. Dedup/freshness pipeline. UI must clearly distinguish aggregated vs. direct jobs.
- **6.13 Talent Directory & Verification** *(deferred, recommended next major bet after core loop)*: searchable verified talent pool sold to 3 buyers — global/diaspora employers (primary FOREX surface), local employers (trust/anti-fraud), job seekers themselves (competitive edge, paid via credits). Skills verification (AI-graded + paid human review tier), portfolio surfacing, remote-readiness metadata.
- **6.14 Managed Services** *(deferred, own "Business Services" page, not seeker-facing)*: tech recruitment + client-managed outsourcing (first wave, once directory has supply), general HR staffing, internships (cheap, do early — good directory cold-start lever). Partner (don't build) EOR/payroll via Deel/Remote/local PEO. **In-house dev outsourcing is cut entirely — treat as out of scope, not just deferred.**

## Data model (see build-prompt §7 for full field-level detail)

Core entities: User, Resume, JobPosting, Application, MatchScore, Organization, AdCampaign, AdEvent, Referral, CreditLedger, PaymentTransaction (tracks rail + auto-renewal state separately from product), Mentor*, MentorshipSession*, VerificationCredential†, PortfolioItem†, TalentDirectoryAccess†.
(* = Phase 2+, † = Phase 3+)

The Phase 1 subset of this schema (actual table list being migrated into Supabase) is spelled out in the plan doc referenced above.

## Non-functional requirements (build-prompt §8)

- Encrypt PII (resumes/JDs) at rest, ownership-restricted access, support account/data deletion.
- Cache parsed JDs, avoid redundant LLM calls, loading states for anything >~2s.
- Auto-apply: never silent-submit without opt-in; auditable log of what/where/when.
- Ad billing: dedupe/attribute impression/click/apply events reliably before billing touches them.
- Multi-rail payments (mobile money + card) from day one.
- Aggregation pipeline runs as background jobs, not blocking request path.
- **Device/bandwidth accessibility is a real constraint**: target market skews low-end Android + expensive mobile data. Keep payloads light, treat visual density as a performance/cost issue, not just aesthetic.

---

## Design system ("Editorial")

Newspaper/magazine metaphor — deliberately not rounded/blue/card-heavy SaaS. **No border-radius** anywhere except small circular affordances (avatars, notification dots, toggle switches). **No drop shadows** except one deliberate soft lift on the hero's input box.

### Colors (oklch CSS custom properties — see either .dc.html file for the exact block)

```css
--paper: oklch(97% 0.014 85);       /* page background */
--paper-alt: oklch(94.5% 0.018 80); /* alternating section background */
--ink: oklch(20% 0.018 50);         /* primary text, borders, dark buttons */
--ink-soft: oklch(38% 0.02 50);     /* secondary/body text */
--ink-line: oklch(30% 0.02 50);     /* footer dividers on dark bg */
--rust: oklch(52% 0.14 40);         /* brand accent — links, active states, CTAs on hover */
--rust-hover: oklch(45% 0.14 40);
--rust-soft: oklch(91% 0.03 40);    /* accent tint backgrounds, highlighted text */
--line: oklch(78% 0.02 60);         /* hairline dividers on paper background */
--green: oklch(48% 0.1 152);        /* "Excellent" match tier */
--amber: oklch(52% 0.12 70);        /* "Fair" match tier */
--card: oklch(99% 0.006 85);        /* white-ish card/box background */
```

**Match-tier system — exactly three tiers, used everywhere a score appears, never a 4th tier or bespoke wording:**
- Excellent (~80%+) → `--green`
- Good (~70–79%) → `--rust`
- Fair (~60–69%) → `--amber`

### Typography

- Headings (h1–h3): **Newsreader** (serif), weight 500 normal / 600 for card h3s. `Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;1,6..72,400`
- Body/UI: **Source Sans 3**, weights 400–700.
- Eyebrow labels: Source Sans 3, 11–12px, weight 700, `letter-spacing: 0.14em`, uppercase, `--rust`. Must literally describe the section/element directly below it — no decorative/invented mythology.
- Italic Newsreader = quiet/secondary asides (placeholders, captions, taglines).

### Components

- **Buttons**, all `border-radius: 0`, min-height 44px: Primary (`--ink` bg → hovers `--rust`), Secondary (transparent, 1.5px `--ink` border → hovers rust), Ghost (no border, hovers rust text).
- **Bordered box/card**: 1.5–2px solid `--ink`, no radius, `--card` background. Hero input box is the *only* element with a shadow.
- **Classifieds-row list** (landing page job preview only): border-bottom `--line`, no card chrome, large serif match % on left.
- **Dashboard job cards** (JobFeed — intentional, do not revert to rows): 1.5px `--ink` border box on `--card`, 44×44px square `--ink`-bg two-letter company badge (never a brand color — would look like a 4th match tier), circular 40×40px icon buttons for Save/Share, `.btn-text` for "Ask Farah", `.btn-primary` for "Apply".
- **Masthead doubles as app nav** — no icon sidebar, ever. Same component signed-out and signed-in, just marketing links swapped for Jobs/Job Tracker/Resume Builder/Mentorship/Refer a Friend.
- **Farah panel** = marginalia (280px right column, `border-left: 1px solid var(--line)`, no card bg) — never a boxed chat widget.
- **Every interactive element** must have a real ≥40×40px hit target, even small ones (was a real shipped bug — icon glyph sized ≠ clickable area sized).
- No emoji as icons — inline SVG only. No stock photography / fake human avatars for Farah — she's the abstract two-overlapping-circles mark only. No profile-completion bar / gamification meter anywhere (hard rule, ties to build-prompt §2.5's anti-gamification retention stance).

### Layout

- Max content width 1120px, `padding: 0 40px`.
- Section rhythm: 88–96px vertical padding, alternating paper/paper-alt with hairline border between (always pair divider + bg change, never just one).
- Grids use explicit `gap`, never margin-spaced siblings.

### Content/copy rules

- Never put unmeasured specific time estimates on AI output ("10 seconds") — broken promises cost more trust than vague ones.
- Scope every "free"/"no account" claim precisely at the point the claim is made (match score + preview = no account; export/save/apply/interview-prep = account + possibly credits).
- One term per concept everywhere: "create a free account" (never "sign up"/"sign in" in body copy); "Resume" not "CV"; don't invent jargon like "JD Tailoring" as a public label.
- Match-tier wording must agree across every screen (Excellent/Good/Fair — no "a good match" prose bypassing the system).
- Don't repeat the same sentence verbatim in two sections — vary phrasing or cross-reference.

---

## Open decisions still needing founder input

See build-prompt §10 for the full numbered list (20 items). Highlights not to silently assume:
- Real user validation of the Nigeria/Africa localization bet before heavy investment.
- Replace the reference design's real-public-figure testimonial with a fictional persona (legal/IP risk as-is).
- Exact referral reward trigger/value, ad pricing model choice, mobile-money provider/country scope for v1, whether a true subscription exists and for which segment.
- All pricing (credits, passes, ads, mentor sessions, Talent Directory fees) is researched-anchor only, not tested — needs a real pricing experiment before launch lock-in.
- Legal review needed: schema.org data redistribution, multi-jurisdiction (tax/KYC/GDPR) compliance before diaspora billing.
- Still open: scholarship source legal review (§10 item 19) — required before any *scraped* scholarship source is relied on commercially. M10 ships a hand-curated set precisely to avoid this.

**Resolved, don't re-litigate:**
- **§10 item 20, scholarship geographic scope** — settled: listing scope is *eligibility-relevant, not geography-restricted*. A programme belongs in the catalog if it's realistically open to and relevant for Nigerian/African applicants, wherever it's hosted (DAAD/MEXT/Erasmus/Commonwealth all qualify). Per-applicant filtering lives in the eligibility-check Farah action; the catalog is **not** an enforcement layer and no geographic filter exists in ingestion or browse — deliberately. Chosen as the cheapest-to-reverse default; revisit on real user signal rather than on a schedule.

## Deliverable expectations for a build

Per build-prompt §11: working full-stack app (or live Lovable-style preview) covering at least Phase 1 MVP, README with setup/env/architecture-decision notes, seed/demo data (mixed internal + external jobs, a fake org, a demo user), and an end-of-build summary of what was built vs. deferred and which `[DECIDE]` items were assumed vs. still open.
