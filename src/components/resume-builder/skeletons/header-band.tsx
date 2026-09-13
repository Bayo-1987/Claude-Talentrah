import type { SkeletonProps } from "./types";
import {
  fontClass,
  fontScopeClassName,
  nameSizeClass,
  joinClasses,
  flowDensityScale,
  accentBgClass,
} from "./token-classes";
import { contactLine } from "../templates/shared";
import { renderSummary, SECTION_RENDERERS } from "./section-blocks";

/**
 * Skeleton 4/7 — header-band. A full-bleed solid-color band carries name,
 * contact and (per content config) a links row, with the two areas set as
 * separate flex blocks rather than one flowing paragraph; the body below is
 * a single column.
 *
 * NOT ATS-SAFE, unconditionally — this is the skeleton the PR brief singles
 * out explicitly ("header-band (if banded/multi-column) ... NOT ATS-safe").
 * The band is a real background-color block (not a photo, but still a
 * decorative container many resume parsers key on to find "the header"), and
 * the name/contact block and links block are laid out as two independent
 * flex children rather than one linear text run — exactly the arrangement
 * `e2e/ats-safety.spec.ts` checks by generating a real PDF
 * and reading its extracted text back.
 *
 * `product-tech-preview` in configs.ts is this skeleton's demo config, and
 * is also where `showLinksInHeader` does real work: the PR brief calls out a
 * links block in the header as "the single biggest visual difference
 * between an old-style CV and a modern one," and this is the one skeleton
 * that puts it in a genuinely distinct visual treatment (an accent-colored
 * row inside the band) rather than one more line of text.
 */
export function HeaderBandSkeleton({ resume, config }: SkeletonProps) {
  const { styleTokens: tokens, content } = config;
  const d = flowDensityScale(tokens.density);
  const { contact, links } = resume;
  const showLinks = content.showLinksInHeader && links && links.length > 0;
  const bandBg = accentBgClass(tokens.accent);

  return (
    <div
      className={joinClasses("mx-auto max-w-[760px] bg-bg text-ink", fontScopeClassName(tokens))}
    >
      <div className={joinClasses(bandBg, "px-10 py-8 text-bg")}>
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <h1 className={joinClasses(fontClass(tokens.displayFont), nameSizeClass(tokens.nameScale))}>
              {contact.name || "Your name"}
            </h1>
            <p className="mt-1.5 text-[13px] text-bg/85">{contactLine(contact)}</p>
          </div>
          {showLinks && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px]">
              {links!.map((link, i) => (
                <a key={i} href={link.url} className="underline underline-offset-2 text-bg">
                  {link.label}
                </a>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="p-10 pt-6">
        {renderSummary({ resume, tokens, content, className: "" })}
        {content.sectionOrder
          .filter((key) => key !== "summary")
          .map((key, i) => (
            <div key={key} className={i === 0 && !content.showSummary ? "" : d.sectionTop}>
              {SECTION_RENDERERS[key]({ resume, tokens, content, sectionClassName: "" })}
            </div>
          ))}
      </div>
    </div>
  );
}
