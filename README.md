# Talentrah

An AI-powered career platform for job seekers in Nigeria and across Africa. Job matching, resume tailoring, a resume builder, application tracking, scholarship discovery, and **Farah** — a named AI copilot threaded through the seeker experience.

Product spec: [`talentrah-build-prompt.md`](talentrah-build-prompt.md). Design system: [`talentrah-editorial-design-handoff.md`](talentrah-editorial-design-handoff.md) plus the two `.dc.html` reference files, which are the literal source of truth for spacing, colour and type. Working context for AI sessions: [`CLAUDE.md`](CLAUDE.md).

## Setup

```bash
npm ci
cp .env.example .env.local   # then fill it in — see below
npm run dev
```

Then seed demo data (needs the dev server running — the seed drives the real ingestion routes over HTTP rather than importing them, so it doubles as a check that those routes work):

```bash
npm run seed
```

That creates a demo account, `demo@talentrah.dev`, with a base resume, tracker entries, referral data, real ingested jobs, and scholarships. Its password comes from `DEMO_PASSWORD` and is **not** committed — this repo is public, and that account owns the demo organisation whose postings appear in the job feed, so a published password meant anyone could sign in and rewrite them. Set `DEMO_PASSWORD` in `.env.local` before seeding; re-running the seed re-asserts it on the existing account.

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
| `INGEST_SECRET` | admin routes | Guards the manual `POST` triggers. |
| `RESEND_API_KEY` | contact form, reminders | Optional; email silently no-ops without it. |

## Commands

```bash
npm run dev            # dev server
npm run build          # production build
npm run seed           # demo data (dev server must be running)
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

**Aggregation is curated, not a general crawler.** Job ingestion uses Greenhouse/Lever public APIs; scholarships are a hand-curated set. Broad scraping waits on legal review of source reuse terms (build-prompt §10 items 10 and 19) — the accuracy stakes are real, since a wrong scholarship deadline costs someone a once-a-year opportunity.

## Project state

Phase 1 is largely shipped. Known gaps, tracked rather than hidden:

- **M8 — employer side is not built.** No org onboarding, job-posting form, or employer login. Legal and marketing copy has been corrected so it no longer implies otherwise.
- **M2 — the schema.org/JSON-LD crawler was never built.** Greenhouse/Lever ingestion works; the crawler half does not exist.
- **No golden-path e2e test.** The Playwright suite covers form-reset behaviour and nav, not the signup → tailor → track journey.
- **JD text over 8,000 characters is silently truncated** in the tailoring path, with no user-visible indication.

See [`docs/phase-1-summary.md`](docs/phase-1-summary.md) for the full shipped-vs-deferred accounting.
