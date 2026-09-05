# Talentrah

An AI-powered career platform for job seekers in Nigeria and across Africa. Job matching, resume tailoring, a resume builder, application tracking, scholarship discovery, and **Farah** — a named AI copilot threaded through the seeker experience.

Product spec: [`talentrah-build-prompt.md`](talentrah-build-prompt.md). Design system: [`talentrah-editorial-design-handoff.md`](talentrah-editorial-design-handoff.md) plus the two `.dc.html` reference files, which are the literal source of truth for spacing, colour and type. Working context for AI sessions: [`CLAUDE.md`](CLAUDE.md).

## Setup

```bash
npm ci
cp .env.example .env.local   # then fill it in — see below
npm run db:local             # your own database (needs Docker)
npm run dev
```

### Your own database

`npm run db:local` starts an ephemeral Supabase stack for this checkout, applies
every migration from scratch, and writes the four connection variables into your
`.env.local` — leaving the rest of that file alone. It is the same
`supabase start` + `supabase db reset` shape CI uses
(`.github/actions/local-supabase/action.yml`), so a local run reproduces what CI
ran. Run it again whenever you want a clean database.

**Why this is the default.** Several sessions work in this repo at once, and
every local run reads `.env.local`. While that pointed at one hosted project,
those runs created and deleted each other's fixtures — a suite asserting on a
global count could fail because of something another session did a second
earlier. CI stopped sharing in #214, when each job started getting its own
stack; this is the local half of that.

**Every run says which database it used.** Tests and the seed print a line
before doing anything:

```
[test suite] ✓ database: local ephemeral stack (http://127.0.0.1:54321)
[seed]       ! database: the shared hosted project (dozaffzgqkbarxtlclsj)
```

That exists because "it works locally" is unfalsifiable when the sentence does
not say which database "locally" meant — which is how a shared default went
unnoticed.

**Hosted projects are opt-in, by hand.** The test suite refuses both:

| target | to use it anyway |
|---|---|
| production `nytwbbzfpytctjsoczzq` | `ALLOW_TESTS_AGAINST_PRODUCTION=yes-i-mean-it` |
| shared hosted `dozaffzgqkbarxtlclsj` | `ALLOW_TESTS_AGAINST_HOSTED=yes-i-mean-it` |

Both have real uses — reproducing something that only happens on a live
project. Neither is reachable by drift.

Then seed demo data (needs the dev server running — the seed drives the real ingestion routes over HTTP rather than importing them, so it doubles as a check that those routes work):

```bash
npm run seed
```

That creates a demo account, `demo@talentrah.dev`, with a base resume, tracker entries, referral data, real ingested jobs, and scholarships. Its password comes from `DEMO_PASSWORD` and is **not** committed — this repo is public, and that account owns the demo organisation whose postings appear in the job feed, so a published password meant anyone could sign in and rewrite them. Set `DEMO_PASSWORD` in `.env.local` before seeding. Re-running the seed will *not* change an existing account's password — rotating one is deliberate: `SEED_ROTATE_PASSWORDS=1 npm run seed`.

## Working in a git worktree

A worktree needs two things the main checkout already has, and neither is
obvious from the failure it causes.

```bash
git worktree add ../my-branch -b my-branch origin/main
cd ../my-branch
ln -s <path-to-main-checkout>/.env.local .env.local   # worktrees do not get ignored files
npm ci                                                # required — see below
PORT=3100 npm run dev                                 # a port of your own
```

**`.env.local` does not come with the worktree.** `git worktree add` copies
tracked files only, and `.env.local` is gitignored. Without it every script and
test fails at client construction with `supabaseUrl is required`. A symlink to
the main checkout's copy keeps one file to rotate.

**`npm ci` is required per worktree — a symlink will not do.** Observed, in
order:

| `node_modules` in the worktree | result |
|---|---|
| absent | `next dev` serves 500s: `ENOENT … .next/dev/server/pages/_app/build-manifest.json` |
| symlinked to the root's | Turbopack refuses: `Symlink [project]/node_modules is invalid, it points out of the filesystem root` |
| real install (`npm ci`) | serves normally |

**Vitest and the dev server disagree about whether you need one**, which is
what makes this confusing. Vitest runs fine with no install in the worktree —
Node walks up and resolves the root's packages — so unit tests pass while the
dev server 500s, and it looks like the app is broken rather than the
environment. Vitest also writes `node_modules/.vite` into the worktree, so
after running tests `node_modules` exists but contains only that cache
directory. It is not an install, and `next dev` fails the same way as if it
were absent.

**`preview_start` uses the ROOT `.claude/launch.json`.** It starts the dev
server with the main checkout as its working directory, not your worktree, so
the page it serves is the other checkout's code. Verify before trusting a
preview:

```bash
lsof -a -p "$(lsof -ti :3000 | head -1)" -d cwd   # which checkout is being served
```

Run your own server on a port of your own instead. It also avoids fighting
other sessions for `:3000`.

## Environment variables

Every variable is documented inline in [`.env.example`](.env.example); this is the short version of what you actually need.

| Variable | Needed for | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | everything | Project `nytwbbzfpytctjsoczzq`. Free tier pauses when idle — restore it before running migrations. |
| `SUPABASE_SERVICE_ROLE_KEY` | seed, ingestion, ledger writes | Bypasses RLS. Server-side only, never in a client bundle. |
| `LLM_PROVIDER` | Farah, tailoring | `gemini` (default) or `groq`. **Use `groq` locally and in CI** — Gemini's free tier is 20 requests/day *shared*, and exhausting it blocks everyone. |
| `GEMINI_API_KEY` | production LLM | ⚠️ The key in use is **free-tier** (20 req/day). A billed key is required before launch or AI features hard-fail. |
| `GROQ_API_KEY` | dev/CI LLM | Free. |
| `PAYSTACK_SECRET_KEY` / `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY` | credits, passes | Use `sk_test_` keys locally. |
| `CRON_SECRET` | scheduled jobs | Name is fixed by Vercel — it sends this automatically as `Authorization: Bearer …` on cron invocations. Must be set in Vercel Production or the crons 401. |
| `INGEST_SECRET` | admin routes, **seeding** | The one credential for every manual admin `POST` trigger, sent as `x-admin-secret`. **Required, including locally** — these routes fail closed, so unset means the whole admin surface answers 401 and `npm run seed` cannot run the ingestion step. (They used to skip the check when it was unset, which left all five reachable unauthenticated in production.) `PASS_RENEWAL_SECRET` is retired; `ADMIN_API_SECRET` is an optional alias checked first. |
| `RESEND_API_KEY` | contact form, reminders | Optional; email silently no-ops without it. |

## Commands

```bash
npm run dev            # dev server
npm run build          # production build
npm run seed           # demo data (dev server must be running, with the same INGEST_SECRET)
npm run test           # Vitest — includes the RLS cross-user security gate
npm run test:e2e       # Playwright (app must be running)
npm run lint
npm run estimate-costs # real LLM unit-economics measurement; spends live API budget
```

## Architecture decisions

**Next.js App Router + Server Components by default.** The target market skews low-end Android on expensive mobile data, so shipping less JavaScript is a product requirement, not a preference. Filters, tabs and pagination are plain links that rewrite the URL and re-render on the server; client components are used only where interaction genuinely demands them.

**No component kit.** The Editorial design system forbids border-radius and shadows; shadcn/ui and friends default to both. Six primitives were hand-built to the reference HTML's exact values instead of fighting a kit's defaults.

**Supabase with RLS as the actual authorization boundary.** Ownership is enforced by database policy, not by application code remembering to filter. Two consequences worth knowing:
- Privileged writes (credit ledger, payments, scholarship moderation) go through the service-role client, and the corresponding tables deliberately have **no** owner write policy — a user cannot grant themselves credits or publish an unreviewed listing even by crafting a request.
- The scholarship moderation gate lives in RLS, *not* as a `.eq("moderation_status", "verified")` filter in page code. A query-layer filter is one forgotten call site away from leaking an unreviewed listing.

This is verified, not assumed: [`tests/rls/cross-user.test.ts`](tests/rls/cross-user.test.ts) runs two real authenticated users against each other on every CI run.

**One `LLMProvider` abstraction, two implementations.** Gemini and Groq sit behind a single interface; no call site knows which is active. Provider choice is a deploy-time env var.

**Scheduled jobs are Vercel Cron → authenticated route handlers.** Vercel invokes crons with `GET` and its own `Authorization: Bearer <CRON_SECRET>` header — both fixed by the platform, neither configurable. Jobs are written to tolerate missed *and* duplicated runs, since Vercel delivery is best-effort and never retried. This deviates from the original plan's Postgres-queue + Edge Functions design, which was more infrastructure than Phase 1 needs.

**Aggregation is curated, not a general crawler.** Job ingestion uses Greenhouse/Lever public APIs plus one vetted schema.org/JobPosting source (Workable's aggregated job search — see `docs/phase-1-summary.md`'s *schema.org ingestion* section for the per-source diligence trail, including why three other candidates were disqualified); scholarships are a hand-curated set. Broader scraping, or relying on schema.org as a primary supply channel, waits on legal review of source reuse terms (build-prompt §10 items 10 and 19) — the accuracy stakes are real, since a wrong scholarship deadline costs someone a once-a-year opportunity.

## Project state

Phase 1 is largely shipped. Known gaps, tracked rather than hidden:

- **M8 — employer side is not built.** No org onboarding, job-posting form, or employer login. Legal and marketing copy has been corrected so it no longer implies otherwise.
- **M2 — schema.org/JSON-LD ingestion is a single pilot source, not a general crawler.** Greenhouse/Lever plus Workable's aggregated job search are live; broader reliance on this mechanism is still gated on legal review (build-prompt §10 item 10).
- **No golden-path e2e test.** The Playwright suite covers form-reset behaviour and nav, not the signup → tailor → track journey.
- **JD text over 8,000 characters is silently truncated** in the tailoring path, with no user-visible indication.

See [`docs/phase-1-summary.md`](docs/phase-1-summary.md) for the full shipped-vs-deferred accounting.
