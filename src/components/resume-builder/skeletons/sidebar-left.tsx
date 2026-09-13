import type { SectionKey, SkeletonProps } from "./types";
import {
  fontClass,
  fontScopeClassName,
  contactLineClass,
  nameSizeClass,
  joinClasses,
  flowDensityScale,
} from "./token-classes";
import { renderHeader, renderSummary, SECTION_RENDERERS } from "./section-blocks";

/**
 * Skeleton 2/7 — sidebar-left. A narrow left column (contact-adjacent facts:
 * skills, languages, certifications) beside a main column carrying the
 * narrative sections (experience, education, projects, ...).
 *
 * NOT ATS-SAFE. Two real columns of unrelated content side by side means a
 * PDF's text-extraction order depends on the renderer's left-to-right/
 * top-to-bottom heuristic, not this document's actual reading order — a
 * sidebar skill list can interleave with an unrelated experience bullet.
 * Verified for real, not asserted: `e2e/ats-safety.spec.ts`
 * prints this skeleton to an actual PDF and checks the extracted order.
 */
type SidebarSection = "skills" | "languages" | "certifications";
const SIDEBAR_SECTIONS = new Set<SectionKey>(["skills", "languages", "certifications"] satisfies SidebarSection[]);

export function SidebarLeftSkeleton({ resume, config }: SkeletonProps) {
  const { styleTokens: tokens, content } = config;
  const d = flowDensityScale(tokens.density);
  const sidebarKeys = content.sectionOrder.filter(
    (k): k is SidebarSection => SIDEBAR_SECTIONS.has(k),
  );
  const mainKeys = content.sectionOrder.filter(
    (k): k is Exclude<SectionKey, "summary"> => k !== "summary" && !SIDEBAR_SECTIONS.has(k),
  );

  return (
    <div
      className={joinClasses(
        "mx-auto max-w-[760px] bg-bg p-10 text-ink",
        fontScopeClassName(tokens),
      )}
    >
      {renderHeader({
        resume,
        tokens,
        content,
        headerWrapperClassName: "pb-4",
        nameClassName: joinClasses(fontClass(tokens.displayFont), nameSizeClass(tokens.nameScale)),
        contactClassName: contactLineClass(tokens.contactLayout),
      })}

      <div className={joinClasses(d.sectionTop, "grid grid-cols-[200px_1fr] gap-8")}>
        <aside className="border-r border-line pr-6">
          {sidebarKeys.map((key) => (
            <div key={key} className="mb-6 last:mb-0">
              {SECTION_RENDERERS[key]({ resume, tokens, content, sectionClassName: "" })}
            </div>
          ))}
        </aside>
        <main>
          {renderSummary({ resume, tokens, content, className: "" })}
          {mainKeys.map((key, i) => (
            <div key={key} className={i === 0 ? "" : d.sectionTop}>
              {SECTION_RENDERERS[key]({ resume, tokens, content, sectionClassName: "" })}
            </div>
          ))}
        </main>
      </div>
    </div>
  );
}
