# Talentrah — Editorial Design System Handoff

Reference doc for whoever (or whichever AI coding tool) builds the real Talentrah application. Pair this with `talentrah-build-prompt.md` (the product spec) — this doc covers *how it should look and read*, not *what it should do*.

Live design reference (all screens, click-through): https://claude.ai/code/artifact/d150ad75-1b0f-4b3b-bcfb-a00e17cac229 — opens on the "Editorial — Full Build" page.

Static source for exact markup/spacing: `Main-Editorial.dc.html` (landing page) and `JobFeed-Editorial.dc.html` (signed-in job dashboard) — real, working HTML/CSS, not a mockup image. Copy layout values (padding, gaps, font sizes) directly from these rather than eyeballing the screenshot.

---

## 1. Visual identity

**Name:** "Editorial" — a newspaper/magazine metaphor, deliberately *not* a rounded, blue, card-heavy SaaS look. No border-radius anywhere except small circular affordances (avatars, notification dots, toggle switches). No drop shadows except one deliberate soft lift on the hero's input box.

## 2. Color tokens

Defined as CSS custom properties in oklch(). Use these values directly if your stack supports oklch (Tailwind v4, modern CSS); convert to hex/hsl if it doesn't.

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

Match-tier color mapping (used consistently everywhere a score appears):
- **Excellent** (~80%+) → `--green`
- **Good** (~70–79%) → `--rust`
- **Fair** (~60–69%) → `--amber`

Do not invent a fourth tier or a different color mapping elsewhere in the app — this exact three-tier system is the only one used across the landing page and dashboard.

## 3. Typography

- **Display/headings (h1–h3):** Newsreader (serif), weight 500 normally, 600 for card-level h3s. Google Fonts: `Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;1,6..72,400`
- **Body/UI:** Source Sans 3, weights 400–700. Google Fonts: `Source+Sans+3:wght@400;500;600;700`
- Small caps "eyebrow" labels (section kickers, status tags) use Source Sans 3, 11–12px, weight 700, `letter-spacing: 0.14em`, `text-transform: uppercase`, colored `--rust`.
- Italic Newsreader is used for quiet/secondary asides (placeholder text, captions, taglines) — gives the "editor's note" voice without extra color or weight.

## 4. Core components

**Buttons** — three variants, all `border-radius: 0`, min-height 44px:
- Primary: `background: var(--ink); color: var(--paper)`, hovers to `--rust`.
- Secondary: transparent, `1.5px solid var(--ink)` border, hovers to rust border+text.
- Ghost: no border, ink text, hovers to rust text. Used for "Log in" and inline nav-adjacent actions.

**Eyebrow label:** the small-caps rust kicker described above. Every major section on the page has one, and it must be a literal, functional description of the section below it — never a decorative flourish with no real referent (see §6 content rules).

**Bordered box/card:** `1.5px` or `2px solid var(--ink)`, no radius, `background: var(--card)`. The hero's input box is the only element with an added soft box-shadow (`0 24px 48px -28px oklch(20% 0.018 50 / 0.3)`) — used once, deliberately, for visual weight without needing animation.

**Classifieds-row list pattern** (used for job listings both on the landing preview and could extend to the real job board): each row is `border-bottom: 1px solid var(--line)`, no card chrome, match % in large Newsreader serif on the left, content center, tier label eyebrow on the right.

## 5. Layout conventions

- Max content width: 1120px, `padding: 0 40px`.
- Section vertical rhythm: 88–96px top/bottom padding, alternating `--paper` / `--paper-alt` backgrounds with hairline `--line` borders between them (never a divider *and* a background change with no border — pick one, we use both together consistently).
- Grids: `problem-row` (3-col), `steps-row` (4-col, 2-col at mobile), `footer-cols` (4-col, 2-col at mobile), all with explicit `gap`, never margin-spaced siblings.
- Hit targets: every interactive element (buttons, nav links, tabs, filter chips, icon buttons) is a real ≥40px target, even the small ones in the dashboard sidebar/topbar.

## 6. Content/copy rules (learned the hard way — keep these)

- **Never overclaim speed or completion.** Don't put specific time estimates on AI-generated output (e.g. "10 seconds") unless the actual latency is measured and guaranteed — a broken promise here costs more trust than no promise.
- **Scope every "free"/"no account" claim precisely to what it actually covers.** The real boundary: checking your match score and previewing a tailored resume need no account; exporting, saving, applying, and interview prep need a free account and may cost credits. State that boundary exactly where the claim is made, not just in the FAQ.
- **One term per concept, everywhere.** Account creation is always "create a free account" — never "sign up" or "sign in" in body copy (button labels like "Get started for free" / "Log in" are fine as the punchier CTA form). "Resume" not "CV" or "JD" (job description is fine spelled out once, but don't introduce recruiter jargon like "JD Tailoring" as a label).
- **Match-tier language must agree between every screen that shows a score** — the same three-tier Excellent/Good/Fair system from §2, not a bespoke sentence like "a good match" in one place and a badge in another.
- **Don't repeat the same sentence in two sections.** If a fact (e.g. "Farah hands off to a human mentor for negotiation") needs to appear twice, say it differently the second time or reference back to where it was already explained.
- **Every eyebrow label must describe the real thing directly below it** — no invented mythology (e.g. an "Issue No. 001" magazine-issue conceit that doesn't map to any real feature) and no promising content (like "your report") that isn't what actually follows.

## 7. Signed-in dashboard patterns (`JobFeed-Editorial.dc.html`)

The landing page (§1–6) is the marketing shell; this section covers the patterns specific to the signed-in job dashboard. Two structural elements were deliberately changed from the dashboard's first pass (icon sidebar, boxed AI-chat widget); the job-listing style below was tried as classifieds rows and then intentionally reverted back to cards by founder preference — noted here so a future build doesn't "fix" it back to rows.

**Masthead doubles as the app nav — no icon sidebar.** The signed-in header reuses the exact same masthead component as the marketing site (wordmark as a real link, `2.5px solid var(--ink)` bottom border, same size/letter-spacing as the landing page wordmark), just with a text nav in place of marketing links: Jobs / Job Tracker / Resume Builder / Mentorship / Refer a Friend, using `.masthead-link` / `.masthead-link.active` (rust text + rust underline) exactly as on the landing page. Utility actions (language, notifications, "Post a job," credits balance, avatar) sit on the right of the same bar. There is no vertical icon-and-label sidebar anywhere in this system — if a build tool's starter template includes one, remove it rather than reskin it.

**Job listings are bordered cards with a company-initial badge — this is intentional, keep it this way.** Each listing is a `1.5px solid var(--ink)` box on `var(--card)` background (no border-radius) with a 44×44px square badge (`background: var(--ink); color: var(--paper)`, two-letter initials, Newsreader) to the left of the title — do not use a decorative/brand color on the badge, since that space is visually adjacent to the match-tier eyebrow (Excellent/Good/Fair, §2 color mapping) and a colored badge risks reading as a fourth tier. Save and Share are circular 40×40px icon buttons (`.icon-btn` — 1px solid `var(--line)`, rust on hover), "Ask Farah" is a `.btn-text`, "Apply" is `.btn-primary`. An earlier pass changed this to a borderless "classifieds row" layout (matching the landing page's job preview) on the theory that cards + circular icon buttons read as generic SaaS chrome; the founder preferred the original card treatment and asked to keep it, so cards are the standing pattern for this screen. The landing page's own job preview (§4) still uses the classifieds-row pattern — that one hasn't changed.

**Tabs, filters, and the Auto-Apply row stay quiet.** View tabs (Recommended / External / Recent / Saved) are underlined-on-active text, not pill buttons or a segmented control. Active filter tags are bordered chips with a small inline-SVG × to remove (never a Unicode ✕ or emoji glyph — §8 still applies inside the app). The Auto-Apply toggle sits in a plain row with a dashed top/bottom border and one sentence of copy — not a colored promotional banner.

**Farah's panel is marginalia, not a chat widget.** The AI copilot lives in a 280px right-hand column with a `border-left: 1px solid var(--line)` and no card background — visually it's a column of notes beside the content, not a boxed app widget bolted onto the page. Structure top to bottom: signed-in user's name + "View profile" link, a `.eyebrow` reading "Farah — your co-pilot" with one italic Newsreader greeting line beneath it, quick actions as stacked underlined text links (`.quick-link` — CV Builder, Interview Prep, Career Advisor, Cover Letter, Salary Negotiation), then a simple bordered input line (not a rounded pill) with a square icon-only send button at the bottom.

**Every control needs a real hit target, even small ones.** This was an actual bug, not a hypothetical: the first dashboard build shipped filter-tag chips, Save/Share links, the toggle switch, and the Farah send button all under 40px because only the *visible* glyph was sized, not the *clickable* area. Pad the interactive element itself to ≥40×40px (e.g. the send button is 44×44px to match the landing page's own send button) — don't rely on a small icon or short text label to define the tap target.

## 8. What's NOT part of this design system

- No profile-completion bar / gamification meter anywhere (hard product rule — see build-prompt §2.5).
- No stock photography or fake human avatars for Farah — she's represented by the abstract two-overlapping-circles mark only.
- No emoji as icons — inline SVG only.
