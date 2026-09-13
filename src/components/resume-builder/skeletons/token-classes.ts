import { typefaceVariable } from "./fonts";
import type {
  AccentColor,
  ContactLayout,
  Density,
  NameScale,
  RuleWeight,
  StyleTokens,
  Typeface,
} from "./types";

/**
 * Every function here returns a COMPLETE, LITERAL Tailwind class string per
 * case — see the "why finite unions" note in types.ts for why that matters
 * for the build to actually generate the CSS. Nothing in this file builds a
 * class name by interpolating a token value into an arbitrary-value bracket.
 */

export function joinClasses(...parts: Array<string | false | null | undefined>): string {
  return parts.filter((p): p is string => Boolean(p && p.length > 0)).join(" ");
}

export function fontClass(typeface: Typeface): string {
  switch (typeface) {
    case "display":
      return "font-display";
    case "body":
      return "font-body";
    case "geometric":
      return "font-geometric";
    case "humanist":
      return "font-humanist";
    case "modern-serif":
      return "font-serif-modern";
    case "condensed":
      return "font-condensed";
  }
}

export function accentTextClass(accent: AccentColor): string {
  return accent === "rust" ? "text-coral" : "text-ink";
}

export function accentBorderClass(accent: AccentColor): string {
  return accent === "rust" ? "border-coral" : "border-ink";
}

export function accentBgClass(accent: AccentColor): string {
  return accent === "rust" ? "bg-coral" : "bg-ink";
}

/**
 * classNames to put on a skeleton's OUTERMOST element so the CSS variables
 * the chosen typefaces need are actually in scope. Empty for the two
 * app-global fonts ("display"/"body") — which is what lets the migrated
 * `clean-professional` config keep its wrapper `<div>` className
 * byte-identical to the pre-skeleton `ResumeDocument` (it uses only those
 * two), while a config that reaches for one of the four new families gets
 * its variable scoped to exactly the document that needs it rather than the
 * whole app (see fonts.ts).
 */
export function fontScopeClassName(tokens: Pick<StyleTokens, "displayFont" | "bodyFont">): string {
  const vars = new Set<string>();
  for (const t of [tokens.displayFont, tokens.bodyFont]) {
    const v = typefaceVariable(t);
    if (v) vars.add(v);
  }
  return Array.from(vars).join(" ");
}

/** Section heading treatment. `uppercase-tracked` + `rust` + `display` reproduces clean-professional's original heading class exactly. */
export function sectionHeadingClass(
  tokens: Pick<StyleTokens, "headingTreatment" | "accent" | "displayFont">,
): string {
  const font = fontClass(tokens.displayFont);
  const accent = accentTextClass(tokens.accent);
  switch (tokens.headingTreatment) {
    case "uppercase-tracked":
      return `${font} text-[13px] font-bold uppercase tracking-[0.1em] ${accent}`;
    case "small-caps":
      return `${font} text-[14px] font-semibold [font-variant:small-caps] tracking-[0.02em] ${accent}`;
    case "rule-under":
      return `${font} text-[13px] font-semibold border-b border-line pb-1 ${accent}`;
    case "boxed":
      return `${font} inline-block ${accentBorderClass(tokens.accent)} border px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.08em] ${accent}`;
  }
}

export function nameSizeClass(scale: NameScale): string {
  switch (scale) {
    case "sm":
      return "text-[22px]";
    case "md":
      return "text-[26px]";
    case "lg":
      return "text-[28px]";
    case "xl":
      return "text-[34px]";
  }
}

/** Header container: rule + bottom padding together, since in every existing template the two are chosen as one visual decision. `heavy` reproduces clean-professional's original `border-b-[2.5px] border-ink pb-4` exactly. */
export function headerRuleClass(rule: RuleWeight): string {
  switch (rule) {
    case "none":
      return "pb-4";
    case "hairline":
      return "border-b border-line pb-4";
    case "medium":
      return "border-b-[1.5px] border-ink pb-4";
    case "heavy":
      return "border-b-[2.5px] border-ink pb-4";
    case "double":
      return "border-b-4 border-double border-ink pb-5";
  }
}

/** `inline` reproduces clean-professional's original contact-line class exactly. */
export function contactLineClass(layout: ContactLayout): string {
  switch (layout) {
    case "inline":
      return "mt-1 text-[13px] text-ink-soft";
    case "stacked":
      return "mt-2 flex flex-col gap-0.5 text-[13px] text-ink-soft";
    case "split":
      return "mt-1.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[13px] text-ink-soft";
  }
}

/**
 * Per-density spacing scale for the flowing (single-column-shaped) skeletons.
 * `comfortable`'s values are not a fresh design choice — they are
 * clean-professional's original literal spacing, lifted out so the skeleton
 * can reproduce it exactly while `compact`/`spacious` give the other six
 * skeletons real, distinct rhythms (`compact-dense` uses `compact`).
 */
export interface FlowDensityScale {
  /** Top margin of the first content block under the header (the summary, when shown). */
  afterHeaderTop: string;
  /** Top margin of every other top-level section. */
  sectionTop: string;
  /** Experience entries container. */
  experienceListGap: string;
  /** Gap between an experience entry's title row and its description text. */
  experienceEntryTextTop: string;
  /** Education entries container. */
  educationListGap: string;
  /** A single-paragraph section's top margin (skills, languages). */
  paragraphTop: string;
  /** A simple bulleted list's container (projects, certifications, awards, publications, links). */
  simpleListGap: string;
  /** Volunteering / custom-section entries container. */
  entryListGap: string;
}

export function flowDensityScale(density: Density): FlowDensityScale {
  switch (density) {
    case "comfortable":
      return {
        afterHeaderTop: "mt-5",
        sectionTop: "mt-6",
        experienceListGap: "mt-3 flex flex-col gap-4",
        experienceEntryTextTop: "mt-1",
        educationListGap: "mt-3 flex flex-col gap-2",
        paragraphTop: "mt-2",
        simpleListGap: "mt-2 flex flex-col gap-1",
        entryListGap: "mt-3 flex flex-col gap-3",
      };
    case "compact":
      return {
        afterHeaderTop: "mt-3",
        sectionTop: "mt-4",
        experienceListGap: "mt-2 flex flex-col gap-2.5",
        experienceEntryTextTop: "mt-0.5",
        educationListGap: "mt-2 flex flex-col gap-1.5",
        paragraphTop: "mt-1.5",
        simpleListGap: "mt-1.5 flex flex-col gap-0.5",
        entryListGap: "mt-2 flex flex-col gap-2",
      };
    case "spacious":
      return {
        afterHeaderTop: "mt-6",
        sectionTop: "mt-8",
        experienceListGap: "mt-4 flex flex-col gap-6",
        experienceEntryTextTop: "mt-2",
        educationListGap: "mt-4 flex flex-col gap-3",
        paragraphTop: "mt-3",
        simpleListGap: "mt-3 flex flex-col gap-2",
        entryListGap: "mt-4 flex flex-col gap-4",
      };
  }
}

/** Body text size scale — comfortable matches clean-professional's literal sizes. */
export interface BodyTextScale {
  entryTitle: string; // e.g. experience title / education school
  entryMeta: string; // dates, location
  entryText: string; // description / bullets text
  paragraph: string; // skills / languages / summary-in-list paragraph
  listItem: string; // projects / certifications / awards li
}

export function bodyTextScale(density: Density): BodyTextScale {
  switch (density) {
    case "comfortable":
      return {
        entryTitle: "text-[15px]",
        entryMeta: "text-[12px]",
        entryText: "text-[13.5px]",
        paragraph: "text-[13.5px]",
        listItem: "text-[13.5px]",
      };
    case "compact":
      return {
        entryTitle: "text-[13.5px]",
        entryMeta: "text-[11px]",
        entryText: "text-[12px]",
        paragraph: "text-[12px]",
        listItem: "text-[12px]",
      };
    case "spacious":
      return {
        entryTitle: "text-[16px]",
        entryMeta: "text-[12.5px]",
        entryText: "text-[14.5px]",
        paragraph: "text-[14.5px]",
        listItem: "text-[14.5px]",
      };
  }
}
