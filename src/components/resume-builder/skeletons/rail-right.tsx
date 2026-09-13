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
 * Skeleton 3/7 — rail-right. Mirror of sidebar-left: the narrative sections
 * (experience, education, projects, ...) take the wide main column on the
 * left, and a narrow rail on the right carries skills/languages/
 * certifications — the "fact rail" a reader checks second, after deciding
 * from the main column whether to keep reading.
 *
 * NOT ATS-SAFE, for the same reason as sidebar-left: two real side-by-side
 * columns of unrelated content. See `e2e/ats-safety.spec.ts`
 * for the real PDF-extraction proof.
 */
type RailSection = "skills" | "languages" | "certifications";
const RAIL_SECTIONS = new Set<SectionKey>(["skills", "languages", "certifications"] satisfies RailSection[]);

export function RailRightSkeleton({ resume, config }: SkeletonProps) {
  const { styleTokens: tokens, content } = config;
  const d = flowDensityScale(tokens.density);
  const railKeys = content.sectionOrder.filter((k): k is RailSection => RAIL_SECTIONS.has(k));
  const mainKeys = content.sectionOrder.filter(
    (k): k is Exclude<SectionKey, "summary"> => k !== "summary" && !RAIL_SECTIONS.has(k),
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
        headerWrapperClassName: "border-b-[1.5px] border-ink pb-4",
        nameClassName: joinClasses(fontClass(tokens.displayFont), nameSizeClass(tokens.nameScale)),
        contactClassName: contactLineClass(tokens.contactLayout),
      })}

      <div className={joinClasses(d.sectionTop, "grid grid-cols-[1fr_200px] gap-8")}>
        <main>
          {renderSummary({ resume, tokens, content, className: "" })}
          {mainKeys.map((key, i) => (
            <div key={key} className={i === 0 ? "" : d.sectionTop}>
              {SECTION_RENDERERS[key]({ resume, tokens, content, sectionClassName: "" })}
            </div>
          ))}
        </main>
        <aside className="border-l border-line pl-6">
          {railKeys.map((key) => (
            <div key={key} className="mb-6 last:mb-0">
              {SECTION_RENDERERS[key]({ resume, tokens, content, sectionClassName: "" })}
            </div>
          ))}
        </aside>
      </div>
    </div>
  );
}
