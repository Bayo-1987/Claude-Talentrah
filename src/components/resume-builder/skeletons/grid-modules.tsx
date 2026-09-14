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
  sectionHeadingClass,
} from "./token-classes";
import { renderHeader, renderSummary, SECTION_RENDERERS } from "./section-blocks";
import { sectionLabel } from "./types";

/**
 * Skeleton 7/7 — grid-modules. Portfolio- and project-led: `projects` (and
 * any `customSections`) render as real CSS grid modules — a card per
 * project, two columns wide — instead of a bulleted list, because for a
 * portfolio-led profile the work itself is the qualification and deserves
 * more visual weight than one line among many. Every other section renders
 * in the single flowing column below.
 *
 * NOT ATS-SAFE. The grid modules are laid out left-to-right, top-to-bottom
 * as independent cards, which is exactly the shape that scrambles in a
 * naive PDF text extraction (card 1 and card 2's text can interleave
 * depending on the renderer). Verified for real in
 * `e2e/ats-safety.spec.ts`.
 */
export function GridModulesSkeleton({ resume, config }: SkeletonProps) {
  const { styleTokens: tokens, content } = config;
  const d = flowDensityScale(tokens.density);
  const projects = resume.projects;
  const customSections = resume.customSections ?? [];
  const flowKeys = content.sectionOrder.filter(
    (k): k is Exclude<SectionKey, "summary" | "projects" | "customSections"> =>
      k !== "summary" && k !== "projects" && k !== "customSections",
  );

  return (
    <div
      className={joinClasses("mx-auto max-w-[760px] bg-paper p-10 text-ink", fontScopeClassName(tokens))}
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

      {content.sectionOrder.includes("projects") && projects.length > 0 && (
        <section className={d.sectionTop}>
          <h2 className={sectionHeadingClass(tokens)}>{sectionLabel(content, "projects")}</h2>
          <div className="mt-3 grid grid-cols-2 gap-4">
            {projects.map((p, i) => (
              <div key={i} className="border-t-2 border-ink pt-2">
                <span className="text-[11px] text-ink-soft">{String(i + 1).padStart(2, "0")}</span>
                <p className="mt-1 text-[13.5px] leading-snug text-ink">{p}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {customSections.length > 0 && (
        <section className={d.sectionTop}>
          <div className="grid grid-cols-2 gap-4">
            {customSections.map((s, si) => (
              <div key={si} className="border-t-2 border-ink pt-2">
                <h3 className={sectionHeadingClass(tokens)}>{s.title}</h3>
                <ul className="mt-1.5 flex flex-col gap-0.5">
                  {s.items.map((item, i) => (
                    <li key={i} className="text-[13px] text-ink-soft">
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      {flowKeys.map((key) => (
        <Fragment key={key}>
          {SECTION_RENDERERS[key]({ resume, tokens, content, sectionClassName: d.sectionTop })}
        </Fragment>
      ))}
    </div>
  );
}
