import type { StructuredResume } from "@/lib/resume/types";

/**
 * Template library PR 2 of 3 — a template as a CONFIGURATION, not a component.
 *
 * See docs referenced from the PR description for the full architecture. In
 * one sentence: a "template" from here on is a `TemplateConfig` value — a
 * skeleton key plus a bundle of style tokens and content configuration — and
 * a `SkeletonRenderer` interprets that value against a `StructuredResume`.
 * Fifty-plus bespoke components would be thousands of lines of TSX and a
 * deploy per template; this is the alternative PR3's 54-row library is built
 * to consume without either.
 *
 * WHY TOKENS ARE FINITE DISCRIMINATED UNIONS, NOT FREEFORM STRINGS OR
 * NUMBERS. Tailwind (v4, `@tailwindcss/postcss`) generates CSS by scanning
 * this repo's source text for candidate class-name substrings — it does not
 * evaluate JavaScript. A class name assembled at runtime by interpolating a
 * variable into an arbitrary-value bracket, e.g. `` `text-[${size}px]` ``,
 * never appears as that literal substring anywhere in the source, so
 * Tailwind never generates the rule for it — the class exists in the DOM at
 * runtime and does nothing. Every mapping in `token-classes.ts` therefore
 * goes through a `switch`/lookup whose *cases* are complete literal class
 * strings; the token controls WHICH case runs, never what a case contains.
 * That keeps the option set finite (which is also the point of a token
 * system: a bounded set of good combinations, not infinite bespoke tweaking)
 * while staying compatible with how the build actually generates CSS.
 */

/** The seven layout skeletons, each written once. */
export type SkeletonKey =
  | "single-column"
  | "sidebar-left"
  | "rail-right"
  | "header-band"
  | "timeline"
  | "compact-dense"
  | "grid-modules";

/**
 * Every section a template's content configuration can place, order, relabel
 * or omit. `summary` and `links` are handled by the header/intro area on most
 * skeletons rather than appearing in `sectionOrder` — see each skeleton file.
 */
export type SectionKey =
  | "summary"
  | "experience"
  | "education"
  | "skills"
  | "projects"
  | "certifications"
  | "links"
  | "languages"
  | "awards"
  | "publications"
  | "volunteering"
  | "customSections"
  | "references";

/**
 * Six typefaces total: the app's own two (`display`/`body`, Newsreader /
 * Source Sans — reused so a template can deliberately look like "the app's
 * own voice") plus the four new ones added for the template library. See
 * `fonts.ts` for which real family each maps to and why.
 */
export type Typeface =
  | "display"
  | "body"
  | "geometric"
  | "humanist"
  | "modern-serif"
  | "condensed";

/**
 * Restricted to the two neutral brand colors on purpose. `--green`/`--amber`
 * are reserved for the match-tier system everywhere in this product
 * (CLAUDE.md: "never a 4th tier"); a template using them as decoration would
 * read as a match score. `rust` and `ink` are the only two the design system
 * treats as generic accent/ink colors outside that system.
 */
export type AccentColor = "rust" | "ink";

export type RuleWeight = "none" | "hairline" | "medium" | "heavy" | "double";
export type HeadingTreatment = "uppercase-tracked" | "small-caps" | "rule-under" | "boxed";
export type Density = "compact" | "comfortable" | "spacious";
export type NameScale = "sm" | "md" | "lg" | "xl";
export type ContactLayout = "inline" | "stacked" | "split";

export interface StyleTokens {
  displayFont: Typeface;
  bodyFont: Typeface;
  accent: AccentColor;
  ruleWeight: RuleWeight;
  headingTreatment: HeadingTreatment;
  density: Density;
  nameScale: NameScale;
  contactLayout: ContactLayout;
}

export interface ContentConfig {
  /** Sections other than the header/summary, in render order. */
  sectionOrder: SectionKey[];
  /** Per-section label override, e.g. `{ experience: "Shipped" }`. Falls back to DEFAULT_SECTION_LABELS. */
  sectionLabels: Partial<Record<SectionKey, string>>;
  /**
   * A `links` block in the header is "the single biggest visual difference
   * between an old-style CV and a modern one" (PR brief) — this is the flag
   * that actually turns it on for a skeleton that supports it. When true,
   * `resume.links` renders as a row in the header/intro area instead of (or
   * in addition to, per-skeleton) appearing in `sectionOrder`.
   */
  showLinksInHeader: boolean;
  /** Show the summary paragraph directly under the header. Off for skeletons/configs that fold it elsewhere. */
  showSummary: boolean;
}

export interface TemplateConfig {
  skeleton: SkeletonKey;
  styleTokens: StyleTokens;
  content: ContentConfig;
  /**
   * Whether THIS configuration, rendered through THIS skeleton, keeps a
   * resume's text extractable in a sane top-to-bottom reading order from a
   * generated PDF — no sidebars, no banded/graphic header, no CSS grid
   * splitting unrelated sections into side-by-side blocks. Not a vibe: see
   * `e2e/ats-safety.spec.ts`, which renders each skeleton to
   * a real PDF and asserts on the real extracted text order. A config must
   * not set this to `true` unless that test covers it.
   */
  atsSafe: boolean;
}

export interface SkeletonProps {
  resume: StructuredResume;
  config: TemplateConfig;
}

export const DEFAULT_SECTION_LABELS: Record<SectionKey, string> = {
  summary: "Summary",
  experience: "Experience",
  education: "Education",
  skills: "Skills",
  projects: "Projects",
  certifications: "Certifications",
  links: "Links",
  languages: "Languages",
  awards: "Awards",
  publications: "Publications",
  volunteering: "Volunteering",
  customSections: "",
  references: "References",
};

/** `content.sectionLabels[key]` if set, else the product default. */
export function sectionLabel(content: ContentConfig, key: SectionKey): string {
  return content.sectionLabels[key] ?? DEFAULT_SECTION_LABELS[key];
}
