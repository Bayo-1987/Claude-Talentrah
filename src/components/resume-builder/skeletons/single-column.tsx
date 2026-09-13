import { Fragment } from "react";
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
 * Skeleton 1/7 — single-column. Classic, ATS-safe: one flowing column, no
 * sidebars, no grid splitting unrelated sections side by side, standard
 * `<h1>`/`<h2>` headings in reading order top to bottom. `ats_safe = true`
 * for every config that uses it (see `ats-safety.ts` and the real PDF-extraction
 * proof in `e2e/ats-safety.spec.ts`).
 *
 * THIS IS THE SKELETON `clean-professional` WAS MOVED ONTO (Template library
 * PR 2 of 3's "move exactly one of the seven" requirement). `resume-document.tsx`
 * now renders `SingleColumnSkeleton` with `CLEAN_PROFESSIONAL_CONFIG`
 * (configs.ts) instead of its own hand-written JSX. Every class string this
 * file can produce for that specific config was reverse-derived from the
 * original component's literal classNames — see token-classes.ts's
 * `comfortable`/`heavy`/`inline`/`lg` cases — and the byte-for-byte proof is
 * `tests/resume-builder/schema-widen-render-parity.test.tsx`, which still
 * compares this output against the pre-PR2 `git show` fixture and passes
 * unmodified.
 */
export function SingleColumnSkeleton({ resume, config }: SkeletonProps) {
  const { styleTokens: tokens, content } = config;
  const d = flowDensityScale(tokens.density);

  const wrapperClass = joinClasses(
    "mx-auto max-w-[720px] bg-paper p-10 text-ink",
    fontScopeClassName(tokens),
  );

  return (
    <div className={wrapperClass}>
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
        const renderer = SECTION_RENDERERS[key];
        return (
          <Fragment key={key}>
            {renderer({ resume, tokens, content, sectionClassName: d.sectionTop })}
          </Fragment>
        );
      })}
    </div>
  );
}
