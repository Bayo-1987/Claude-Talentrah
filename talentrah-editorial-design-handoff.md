# Talentrah — Sunbird Design System Handoff

Reference doc for whoever (or whichever AI coding tool) builds the real Talentrah application. Pair this with `talentrah-build-prompt.md` (the product spec) — this doc covers *how it should look and read*, not *what it should do*.

Design-direction canvas (6 directions reviewed, Direction E/Sunbird chosen): https://claude.ai/code/artifact/f939960c-d188-4cb0-8a32-69a16e8b90ff — artboards `SunbirdFeed.dc.html` and `SunbirdDetail.dc.html`.

Static source for exact markup/spacing: `Main-Sunbird.dc.html` (landing page) and `JobFeed-Sunbird.dc.html` (signed-in job dashboard) — real, working HTML/CSS, not a mockup image. Copy layout values (padding, gaps, font sizes) directly from these rather than eyeballing a screenshot. `Main-Sunbird.dc.html` has no approved artboard of its own (the canvas only produced Feed/Detail pairs for each of the 6 directions) — it was composed from Sunbird's established tokens/type/component language, consistent with what `SunbirdFeed.dc.html`/`SunbirdDetail.dc.html` show, rather than copied from an already-approved mockup.

This replaced "Editorial" (newspaper/magazine metaphor, no border-radius, no shadows) wholesale in a single PR, not phased in. History of that swap — and the real gap found and fixed along the way — is in §2 below.

---

## 1. Visual identity

**Name:** "Sunbird" — the opposite of Editorial's hard rules, deliberately: fully rounded cards and pills, a soft drop shadow on every card, geometric shape accents (circles, a triangle) as decoration instead of Editorial's hairline borders.

**Brand mark:** a solid circle in `--coral`. Source files are in `logo/`:
- `talentrah-mark.svg` — icon alone, ink + coral, transparent background, for light/paper surfaces.
- `talentrah-mark-reversed.svg` — same shape in `--bg` + coral, for placing on `--ink` or other dark surfaces.
- `talentrah-horizontal.svg` — mark + "Talentrah" wordmark lockup (DM Serif Display, same treatment as the masthead) for headers/nav bars.
- `talentrah-mark-{16,32,48,180,512}.png` and `favicon.ico` — rasterized icon-only versions for browser tabs and app icons.

Usage rules: never recolor the mark outside `--ink`/`--coral`/`--bg`, never stretch it non-uniformly, keep clear space around it roughly equal to its own radius, and below ~24px only the icon (not the horizontal lockup) is legible — use `talentrah-mark.svg` alone at small sizes.

## 2. Color tokens

Defined as CSS custom properties in oklch(). Use these values directly if your stack supports oklch (Tailwind v4, modern CSS); convert to hex/hsl if it doesn't.

```css
--bg: oklch(98% 0.015 55);          /* page background */
--card: oklch(100% 0.005 55);       /* card/box background */
--ink: oklch(22% 0.02 30);          /* primary text, dark buttons */
--ink-soft: oklch(42% 0.02 30);     /* secondary/body text */
--ink-faint: oklch(58% 0.015 40);   /* tertiary text, timestamps */
--coral: oklch(63% 0.19 35);        /* primary accent — CTAs, links, active states */
--coral-hover: oklch(55% 0.19 35);
--teal: oklch(55% 0.11 195);        /* secondary accent — Farah panel, info, "Good" match tier */
--teal-soft: oklch(92% 0.03 195);
--gold: oklch(78% 0.14 85);         /* decorative accent — shapes, highlights only */
--green: oklch(55% 0.13 150);       /* "Excellent" match tier */
--green-soft: oklch(92% 0.04 150);
--amber: oklch(45% 0.1 70);         /* "Fair" match tier */
--amber-soft: oklch(93% 0.03 85);
--line: oklch(89% 0.015 55);        /* hairline dividers, thin borders */
```

Three tokens carried over from Editorial with no Sunbird-artboard equivalent, because the app has real structural uses for the roles they played even though neither `SunbirdFeed.dc.html` nor `SunbirdDetail.dc.html` needed them. Each is derived using the same lightness/chroma relationship its Editorial equivalent had to its own base color, recomputed at Sunbird's hues:

```css
--bg-alt: oklch(95.5% 0.019 50);    /* alternating section background */
--coral-soft: oklch(93% 0.04 35);   /* tinted backgrounds, highlighted text */
--ink-line: oklch(32% 0.02 30);     /* footer dividers on a dark --ink background */
```

**Match-tier color mapping (used consistently everywhere a score appears):**
- **Excellent** (~80%+) → `--green` / `--green-soft`
- **Good** (~70–79%) → `--teal` / `--teal-soft`
- **Fair** (~60–69%) → `--amber` / `--amber-soft`

Do not invent a fourth tier or a different color mapping elsewhere in the app — this exact three-tier system is the only one used across the landing page and dashboard.

**A real bug, found and fixed during the swap, worth recording so it isn't reintroduced.** The Sunbird artboards themselves got this wrong: `SunbirdFeed.dc.html`'s Fair-tier badge (64%) used an undefined one-off inline `oklch(93% 0.03 85)`/`oklch(45% 0.1 70)` pair instead of a real token, and `SunbirdDetail.dc.html`'s 72% "Good match" was colored with `--green` — the same token an 81%/77% Excellent score uses on the Feed page, making a Good score render visually identical to an Excellent one. Both are fixed above, not carried into production: Fair now has its own real `--amber`/`--amber-soft` pair (the values above ARE the artboard's own inline Fair colors, made into real tokens rather than replaced), and Good uses `--teal`.

**Good deliberately does NOT reuse `--coral`,** unlike Editorial's equivalent precedent (Good reused `--rust`, Editorial's primary accent, there). `--coral` is Sunbird's own CTA/action color, rendered directly beside match badges on the same card — a job card's "Apply" button, or the job detail page's "Apply on company site" sitting right next to the score badge. A coral Good-tier badge would blur "this is clickable" with "this is a score" in exactly the spot that matters most. `--teal` already carries a calm, informational register on these screens (the Farah panel, skill-tag pills) rather than an actionable one, so it takes over Good's role instead — checked against how the badge actually reads with real content before locking this in, not assumed from the color wheel alone.

## 3. Typography

- **Display/headings (h1–h3):** DM Serif Display, weight 400 (its only cut — there is no 500/600 to step up to for card-level h3s the way Newsreader had). Google Fonts: `DM+Serif+Display` (normal + italic, both come free with the family).
- **Body/UI:** DM Sans, weights 400–700. Google Fonts: `DM+Sans:wght@400;500;600;700`
- Small caps "eyebrow" labels (section kickers, status tags) use DM Sans, 11–12px, weight 700, `letter-spacing: 0.08em`, `text-transform: uppercase`, colored `--coral`.
- Italic DM Serif Display is used for quiet/secondary asides (placeholder text, captions, taglines) — same role Editorial's italic Newsreader played.

## 4. Core components

**Buttons** — three variants, all `border-radius: 999px` (fully rounded/pill), min-height 44px:
- Primary: `background: var(--coral); color: white`, hovers to `--coral-hover`.
- Secondary: transparent, `1px solid var(--line)` border, hovers to coral border+text.
- Ghost: no border, ink text, hovers to coral text. Used for "Log in" and inline nav-adjacent actions.

**Eyebrow label:** the small-caps coral kicker described above. Every major section on the page has one, and it must be a literal, functional description of the section below it — never a decorative flourish with no real referent (see §6 content rules).

**Card:** rounded corners (14–20px radius — 16px is the common default; the Farah panel and detail-page card go up to 18–20px), `background: var(--card)`, a soft shadow on every card by default: `box-shadow: 0 4px 16px oklch(30% 0.05 35 / 0.08)`. This is the opposite of Editorial's `BorderedCard`, which reserved a shadow for exactly one element (the hero's input box) — under Sunbird, that box just gets the same shared card shadow everyone else does, at a larger radius.

**Company badges are circular, not square** — 40–56px depending on context (Feed row: 42px; dashboard card: 44px; detail page: 56px), `background: var(--ink); color: white`, two-letter initials, DM Sans bold. Kept off any brand/tier color (same reasoning Editorial had for its square version): that space sits visually adjacent to the match-tier badge, and a colored badge risks reading as a fourth tier.

**Classifieds-row list pattern** (used for job listings on the landing preview only): each row is `border-bottom: 1px solid var(--line)`, no card chrome, match % in large DM Serif Display on the left, content center, tier label eyebrow on the right — unchanged in spirit from Editorial, just recolored.

## 5. Layout conventions

Direction-agnostic — carried over from Editorial unchanged, because these are UX/accessibility invariants, not a look-and-feel choice:

- Max content width: 1120px, `padding: 0 40px`.
- Section vertical rhythm: 88–96px top/bottom padding, alternating `--bg` / `--bg-alt` backgrounds with hairline `--line` borders between them (never a divider *and* a background change with no border — pick one, we use both together consistently).
- Grids: `problem-row` (3-col), `steps-row` (4-col, 2-col at mobile), `footer-cols` (4-col, 2-col at mobile), all with explicit `gap`, never margin-spaced siblings.
- Hit targets: every interactive element (buttons, nav links, tabs, filter chips, icon buttons) is a real ≥40px target, even the small ones in the dashboard sidebar/topbar. Sunbird's own pill buttons and icon circles meet this in the static markup — re-verify it holds once real components are built, rather than assuming a static mockup proves it under real content.

## 6. Content/copy rules (learned the hard way — keep these)

Direction-agnostic, unchanged from Editorial:

- **Never overclaim speed or completion.** Don't put specific time estimates on AI-generated output (e.g. "10 seconds") unless the actual latency is measured and guaranteed — a broken promise here costs more trust than no promise.
- **Scope every "free"/"no account" claim precisely to what it actually covers.** The real boundary: checking your match score and previewing a tailored resume need no account; exporting, saving, applying, and interview prep need a free account and may cost credits. State that boundary exactly where the claim is made, not just in the FAQ.
- **One term per concept, everywhere.** Account creation is always "create a free account" — never "sign up" or "sign in" in body copy (button labels like "Get started for free" / "Log in" are fine as the punchier CTA form). "Resume" not "CV" or "JD" (job description is fine spelled out once, but don't introduce recruiter jargon like "JD Tailoring" as a label).
- **Match-tier language must agree between every screen that shows a score** — the same three-tier Excellent/Good/Fair system from §2, not a bespoke sentence like "a good match" in one place and a badge in another.
- **Don't repeat the same sentence in two sections.** If a fact (e.g. "Farah hands off to a human mentor for negotiation") needs to appear twice, say it differently the second time or reference back to where it was already explained.
- **Every eyebrow label must describe the real thing directly below it** — no invented mythology and no promising content (like "your report") that isn't what actually follows.

## 7. Signed-in dashboard patterns (`JobFeed-Sunbird.dc.html`)

The landing page (§1–6) is the marketing shell; this section covers the patterns specific to the signed-in job dashboard.

**Masthead doubles as the app nav — no icon sidebar.** The signed-in header reuses the exact same masthead component as the marketing site (wordmark as a real link, a hairline `--line` bottom border, same size/letter-spacing as the landing page wordmark), just with a text nav in place of marketing links: Jobs / Job Tracker / Resume Builder / Mentorship / Refer a Friend, using `.masthead-link` / `.masthead-link.active` (coral text + coral underline) exactly as on the landing page. Utility actions (language, notifications, "Post a job," credits balance, avatar) sit on the right of the same bar. There is no vertical icon-and-label sidebar anywhere in this system.

**Job listings are rounded cards with a soft shadow and a circular company badge.** Each listing is a `border-radius: 16px` box on `var(--card)` background with the shared card shadow, and a circular company-initial badge (§4) to the left of the title. Save and Share are circular 40×40px icon buttons (`.icon-btn` — 1px solid `var(--line)`, coral on hover), "Ask Farah" is a `.btn-text`, "Apply" is `.btn-primary` (pill).

**Tabs, filters, and the Auto-Apply row stay quiet.** View tabs (Recommended / External / Recent / Saved) are underlined-on-active text, not pill buttons or a segmented control. Active filter tags are pill-shaped chips (`border-radius: 999px`) with a small inline-SVG × to remove (never a Unicode ✕ or emoji glyph — §8 still applies inside the app). The Auto-Apply toggle sits in a plain row with a dashed top/bottom border and one sentence of copy — not a colored promotional banner.

**Farah's panel is drawn as a full elevated card on the artboards** — rounded-2xl, `background: var(--card)`, the same shared card shadow — a real departure from Editorial's flat "never a boxed chat widget" marginalia rule. **The shipped `src/components/app-shell/farah-panel.tsx` has NOT yet adopted this**; it is flagged, not silently fixed, in that file's own header comment as a deliberate scope decision for whichever PR takes on restructuring its sticky/scroll shell and re-verifying the Farah e2e specs that depend on its current geometry. Treat this doc's description as the target, and that file's comment as the current, known-divergent state.

**Every control needs a real hit target, even small ones.** This was an actual bug, not a hypothetical: the first dashboard build shipped filter-tag chips, Save/Share links, the toggle switch, and the Farah send button all under 40px because only the *visible* glyph was sized, not the *clickable* area. Pad the interactive element itself to ≥40×40px (e.g. the send button is 44×44px to match the landing page's own send button) — don't rely on a small icon or short text label to define the tap target.

## 8. What's NOT part of this design system

- No profile-completion bar / gamification meter anywhere (hard product rule — see build-prompt §2.5).
- No stock photography or fake human avatars for Farah — she's represented by the abstract two-overlapping-circles mark only.
- No emoji as icons anywhere — inline SVG only, same rule as Editorial.

## 9. Known gaps this swap did not close

Recorded here rather than silently left implicit, so a future pass has a real starting list instead of re-discovering these from scratch:

- **~59 files still hardcode an ad-hoc bordered box** (`border-[1.5px] border-ink` or similar) instead of using the shared `Card` primitive — mostly page-level forms and panels built before `Card` existed, spanning admin, employer, mentorship, resume-builder and talent-directory screens. None of them are visually *wrong* (they still use current tokens), just not yet carrying the rounded-corner/shadow treatment `Card` gives everything that does use it. A dedicated sweep converting these to `Card` (or documenting a deliberate exception per file) is the natural next PR.
- **The Farah panel's marginalia-vs-card treatment** (§7 above) — flagged, not fixed, pending a decision on restructuring its sticky/scroll shell.
- Several transactional/notification email templates (`src/lib/digest/template.ts` and siblings) use hardcoded hex approximations of the token values above, since email clients don't support `oklch()`. Recomputed for Sunbird as part of this swap, but if the palette changes again, those files need updating by hand — they cannot read `globals.css`.
