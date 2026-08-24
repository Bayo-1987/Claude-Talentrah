# Talentrah Phase 1 — end-of-build summary

Required by build-prompt §11 and the plan doc's M10. Written 2026-08-24 against `main`.

Milestone names below follow **the plan doc** (`~/.claude/plans/adaptive-giggling-ember.md`), not the PR labels — those diverged partway through, which is itself worth knowing (see *Numbering drift*).

## What shipped

| Plan milestone | State | Notes |
|---|---|---|
| **M0** Foundation & design system | done | Next.js/TS/Tailwind v4; six hand-built primitives; 23 tables, RLS on every one |
| **M1** Auth & onboarding | done | Email/password + Google + LinkedIn OIDC; fictional testimonial persona (open decision #2 is a legal requirement, not polish) |
| **M2** Job supply & aggregation | **partial** | Greenhouse + Lever live, with dedup and freshness sweep. **schema.org/JSON-LD crawler never built** |
| **M3** Job feed & matching | done | Algorithmic match scoring, cached; server-rendered feed; manual apply both paths |
| **M4** Resume Builder | done | 7 templates, drag-reorder, credit-gated AI bullet rewriting, print-to-PDF |
| **M5** JD tailoring + Credits/Passes | done | Paste-text tailoring, one-time free trial, Paystack checkout + webhook, pass auto-renewal |
| **M6** Farah chat panel | done | Docked marginalia panel, quick actions, persisted history, one shared voice module |
| **M7** Job Tracker | done | Stage tracking, manual entries, Hired → referral prompt |
| **M8** Employer side | **not started** | Tables exist; **zero product surface** |
| **M9** Refer & Earn | done | Two-step reward, share surfaces, anti-abuse |
| **M10** Cross-cutting polish | **partial** | RLS verification and README done; golden-path e2e outstanding |
| *(added later)* Scholarship Discovery | done | Not in the plan doc; added to build-prompt §6.15 mid-build |

## Numbering drift

The repo's PR labels stopped matching the plan doc partway through: "M8" shipped Refer & Earn (plan M9), "M9" shipped Resume Builder (plan M4), and "M10" shipped Scholarship Discovery — colliding with the plan's M10, *Cross-cutting polish & delivery*.

That collision is why two whole milestones went unnoticed as unbuilt: something called "M10" shipped, so the list looked finished. Worth fixing the labels or the plan doc before Phase 2 repeats it.

## Deferred, deliberately

- **M8, employer side.** The whole self-serve employer product. Legal/marketing copy has been corrected so it no longer claims otherwise.
- **schema.org crawler** (M2) — blocked on legal review of source reuse terms (§10 item 10).
- **Auto-apply, ad campaigns, URL-based JD import, mentorship, talent directory** — Phase 2/3 by design.

## Assumptions made where the founder hasn't decided

Each stands in for an open `[DECIDE]` item and should be revisited, not inherited:

| Assumption | Open item |
|---|---|
| Email verification gates Apply/Tailor, not browsing | §6.1 |
| Referral rewards: +20 signup / +50 activation / +20 welcome | #4 |
| Employer verification = work-email domain only | — |
| 7 resume template categories | plan M4 |
| Paystack as the only rail | #7 |
| All pricing is a researched anchor, never tested | #18 |

**Resolved during the build:** §10 item 20 (scholarship geographic scope) — listing scope is eligibility-relevant, not geography-restricted.

## Known defects, not fixed

1. **JD text over 8,000 characters is silently truncated** (`jdText.slice(0, 8000)`). The cap appears in neither the plan nor the spec, so silence was never a decision. On a long posting this discards ~60% of the content with nothing shown to the user, degrading tailoring quality on exactly the most detailed roles. **Highest-value item on this list.**
2. **`GEMINI_API_KEY` is a free-tier key** — 20 requests/day, and production is intended to run Gemini. A billed key is required before launch or AI features hard-fail almost immediately.
3. **Six footer links are dead `#` anchors** for features that *do* exist. Not a truthfulness problem; a UX/SEO one.
4. **Groq's JSON mode intermittently 400s** on the largest JDs. Dev/CI-only, but it means CI does not exercise the large-JD path.

## Verification actually performed

- **RLS cross-user gate** (`tests/rls/cross-user.test.ts`) — two real authenticated users, 13 owned tables, reads *and* writes, in CI. Proven to fail when RLS is weakened, not merely observed passing.
- Vitest unit coverage for resume sanitization and the tailoring retry heuristic.
- Live end-to-end payment verification: real Paystack test-mode purchases on card and bank rails, plus a real scheduled pass renewal.
- Real measured LLM unit economics (`npm run estimate-costs`) — every credit action clears ~98–99% margin.
- Moderation gate verified at the database layer: 8 scholarships present, only verified ones visible to a normal user.

**Not performed:** the golden-path e2e journey, and a mobile/low-bandwidth payload check. Both are plan-doc M10 items still outstanding.
