import { Fragment } from "react";
import type { SectionKey, SkeletonProps } from "./types";
import {
  fontClass,
  fontScopeClassName,
  headerRuleClass,
  contactLineClass,
  nameSizeClass,
  joinClasses,
  flowDensityScale,
  accentBorderClass,
} from "./token-classes";
import { renderHeader, renderSummary, SECTION_RENDERERS } from "./section-blocks";

/**
 * Skeleton 5/7 — timeline. A single flowing column, same as single-column,
 * except the chronological sections (experience, volunteering) carry a
 * decorative accent-colored rail down their left margin so the eye tracks a
 * career timeline. The rail is pure decoration — a `border-left` on a div
 * that already contains the section's normal single-column markup — it does
 * not create a second column of unrelated content.
 *
 * ATS-SAFE. No sidebar, no grid, no banded header — every section is exactly
 * as extractable in reading order as single-column's; the only difference is
 * a CSS border. Verified for real, not just reasoned about, in
 * `e2e/ats-safety.spec.ts`.
 */
const RAILED_SECTIONS = new Set<SectionKey>(["experience", "volunteering"]);

export function TimelineSkeleton({ resume, config }: SkeletonProps) {
  const { styleTokens: tokens, content } = config;
  const d = flowDensityScale(tokens.density);
  const railBorder = accentBorderClass(tokens.accent);

  return (
    <div
      className={joinClasses("mx-auto max-w-[720px] bg-bg p-10 text-ink", fontScopeClassName(tokens))}
    >
      {renderHeader({
        resume,
        tokens,
        content,
        headerWrapperClassName: headerRuleClass(tokens.ruleWeight),
        nameClassName: joinClasses(fontClass(tokens.displayFont), nameSizeClass(tokens.nameScale)),
        contactClassName: contactLineClass(tokens.contactLayout),
      })}

      {renderSummary({ resume, tokens, content, className: d.afterHeaderTop })}

      {content.sectionOrder.map((key) => {
        if (key === "summary") return null;
        if (!RAILED_SECTIONS.has(key)) {
          return (
            <Fragment key={key}>
              {SECTION_RENDERERS[key]({ resume, tokens, content, sectionClassName: d.sectionTop })}
            </Fragment>
          );
        }
        return (
          <div key={key} className={joinClasses(d.sectionTop, "border-l-2 pl-4", railBorder)}>
            {SECTION_RENDERERS[key]({ resume, tokens, content, sectionClassName: "" })}
          </div>
        );
      })}
    </div>
  );
}
