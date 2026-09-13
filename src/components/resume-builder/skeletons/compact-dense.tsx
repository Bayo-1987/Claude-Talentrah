import type { SkeletonProps } from "./types";
import {
  fontClass,
  fontScopeClassName,
  headerRuleClass,
  contactLineClass,
  nameSizeClass,
  joinClasses,
  flowDensityScale,
} from "./token-classes";
import { renderHeader, renderSummary, SECTION_RENDERERS } from "./section-blocks";

/**
 * Skeleton 6/7 — compact-dense. Single column, same shell as single-column,
 * built for a long senior history that needs to fit on two pages without
 * shrinking type past legibility — smaller name scale, tighter section and
 * entry spacing (`density: "compact"`), and `break-inside-avoid` on every
 * entry so the browser's print engine never splits one job's title from its
 * own bullets across a page boundary.
 *
 * ATS-SAFE. Still exactly one flowing column in DOM/reading order — density
 * only changes spacing and font size, never the section arrangement.
 * Verified for real in `e2e/ats-safety.spec.ts`.
 */
export function CompactDenseSkeleton({ resume, config }: SkeletonProps) {
  const { styleTokens: tokens, content } = config;
  const d = flowDensityScale(tokens.density);

  return (
    <div
      className={joinClasses("mx-auto max-w-[700px] bg-paper p-8 text-ink", fontScopeClassName(tokens))}
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
        return (
          <div key={key} className="break-inside-avoid">
            {SECTION_RENDERERS[key]({ resume, tokens, content, sectionClassName: d.sectionTop })}
          </div>
        );
      })}
    </div>
  );
}
