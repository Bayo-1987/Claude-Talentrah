import { getExperienceBullets, getExperienceText, type StructuredResume } from "@/lib/resume/types";
import { contactLine, dateRange } from "../templates/shared";
import {
  bodyTextScale,
  flowDensityScale,
  fontClass,
  joinClasses,
  sectionHeadingClass,
} from "./token-classes";
import type { ContentConfig, SectionKey, StyleTokens } from "./types";
import { sectionLabel } from "./types";

/**
 * The reusable content layer every skeleton is built from. A skeleton file
 * (single-column.tsx, sidebar-left.tsx, ...) owns the SHELL — how many
 * columns, where the header sits, whether there's a band or a rail — and
 * calls into these for the actual section bodies, so the 65-row library PR3
 * adds does not mean 65 re-implementations of "how an experience entry
 * looks."
 *
 * Every renderer returns `null` for an empty/absent section, exactly like
 * the `{list.length > 0 && (...)}` guards the original per-template
 * components used — `null` and `false` render identically (nothing), so
 * swapping the guard style here does not change output.
 */

const density = flowDensityScale;
const text = bodyTextScale;

/** Comfortable-density summary text — a distinct size from the other paragraph text (14px vs 13.5px elsewhere), same as clean-professional's original literal class. */
function summaryTextClass(d: StyleTokens["density"]): string {
  switch (d) {
    case "comfortable":
      return "text-[14px] leading-relaxed text-ink-soft";
    case "compact":
      return "text-[12.5px] leading-snug text-ink-soft";
    case "spacious":
      return "text-[15px] leading-[1.7] text-ink-soft";
  }
}

export function renderHeader({
  resume,
  tokens,
  content,
  nameClassName,
  contactClassName,
  headerWrapperClassName,
}: {
  resume: StructuredResume;
  tokens: StyleTokens;
  content: ContentConfig;
  nameClassName: string;
  contactClassName: string;
  headerWrapperClassName: string;
}) {
  const { contact, links } = resume;
  const showLinks = content.showLinksInHeader && links && links.length > 0;
  return (
    <div className={headerWrapperClassName}>
      <h1 className={nameClassName}>{contact.name || "Your name"}</h1>
      <p className={contactClassName}>{contactLine(contact)}</p>
      {showLinks && (
        <p
          className={joinClasses(
            "mt-1.5 flex flex-wrap gap-x-3 gap-y-1",
            fontClass(tokens.bodyFont) === "font-body" ? "" : fontClass(tokens.bodyFont),
            "text-[12.5px]",
          )}
        >
          {links!.map((link, i) => (
            <a
              key={i}
              href={link.url}
              className={joinClasses(
                "underline underline-offset-2",
                tokens.accent === "rust" ? "text-rust" : "text-ink",
              )}
            >
              {link.label}
            </a>
          ))}
        </p>
      )}
    </div>
  );
}

export function renderSummary({
  resume,
  tokens,
  content,
  className,
}: {
  resume: StructuredResume;
  tokens: StyleTokens;
  content: ContentConfig;
  className: string;
}) {
  if (!content.showSummary || !resume.summary) return null;
  return (
    <section className={className}>
      <p className={summaryTextClass(tokens.density)}>{resume.summary}</p>
    </section>
  );
}

function SectionHeading({ tokens, label }: { tokens: StyleTokens; label: string }) {
  if (!label) return null;
  return <h2 className={sectionHeadingClass(tokens)}>{label}</h2>;
}

export function renderExperience({
  resume,
  tokens,
  content,
  sectionClassName,
}: {
  resume: StructuredResume;
  tokens: StyleTokens;
  content: ContentConfig;
  sectionClassName: string;
}) {
  const { experience } = resume;
  if (experience.length === 0) return null;
  const d = density(tokens.density);
  const t = text(tokens.density);
  const titleFont = fontClass(tokens.bodyFont);
  return (
    <section className={sectionClassName}>
      <SectionHeading tokens={tokens} label={sectionLabel(content, "experience")} />
      <div className={d.experienceListGap}>
        {experience.map((entry, i) => {
          const bullets = getExperienceBullets(entry);
          const body = getExperienceText(entry);
          return (
            <div key={i}>
              <div className="flex items-baseline justify-between gap-4">
                <span className={joinClasses(titleFont, t.entryTitle, "font-semibold")}>
                  {entry.title} {entry.company && `— ${entry.company}`}
                </span>
                <span className={joinClasses("flex-shrink-0", t.entryMeta, "text-ink-soft")}>
                  {dateRange(entry.startDate, entry.endDate)}
                </span>
              </div>
              {entry.location && (
                <div className={joinClasses("text-[12.5px]", "text-ink-soft")}>{entry.location}</div>
              )}
              {bullets ? (
                <ul
                  className={joinClasses(
                    d.experienceEntryTextTop,
                    t.entryText,
                    "list-disc pl-[18px] leading-relaxed text-ink-soft",
                  )}
                >
                  {bullets.map((bullet, bi) => (
                    <li key={bi}>{bullet}</li>
                  ))}
                </ul>
              ) : (
                body && (
                  <p className={joinClasses(d.experienceEntryTextTop, t.entryText, "leading-relaxed text-ink-soft")}>
                    {body}
                  </p>
                )
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function renderEducation({
  resume,
  tokens,
  content,
  sectionClassName,
}: {
  resume: StructuredResume;
  tokens: StyleTokens;
  content: ContentConfig;
  sectionClassName: string;
}) {
  const { education } = resume;
  if (education.length === 0) return null;
  const d = density(tokens.density);
  const titleFont = fontClass(tokens.bodyFont);
  return (
    <section className={sectionClassName}>
      <SectionHeading tokens={tokens} label={sectionLabel(content, "education")} />
      <div className={d.educationListGap}>
        {education.map((entry, i) => (
          <div key={i} className="flex items-baseline justify-between gap-4">
            <span className={joinClasses(titleFont, "text-[14.5px] font-semibold")}>
              {entry.school} {entry.degree && `— ${entry.degree}`}
            </span>
            <span className="flex-shrink-0 text-[12px] text-ink-soft">
              {[entry.startDate, entry.endDate].filter(Boolean).join(" – ")}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

export function renderSkills({
  resume,
  tokens,
  content,
  sectionClassName,
}: {
  resume: StructuredResume;
  tokens: StyleTokens;
  content: ContentConfig;
  sectionClassName: string;
}) {
  const { skills } = resume;
  if (skills.length === 0) return null;
  const d = density(tokens.density);
  const t = text(tokens.density);
  return (
    <section className={sectionClassName}>
      <SectionHeading tokens={tokens} label={sectionLabel(content, "skills")} />
      <p className={joinClasses(d.paragraphTop, t.paragraph, "text-ink-soft")}>{skills.join(" · ")}</p>
    </section>
  );
}

/** Shared shape for projects / certifications / awards / publications — all "a labeled bulleted list of strings" in every original template. */
function renderSimpleStringList({
  items,
  tokens,
  content,
  sectionClassName,
  sectionKey,
}: {
  items: string[];
  tokens: StyleTokens;
  content: ContentConfig;
  sectionClassName: string;
  sectionKey: SectionKey;
}) {
  if (items.length === 0) return null;
  const d = density(tokens.density);
  const t = text(tokens.density);
  return (
    <section className={sectionClassName}>
      <SectionHeading tokens={tokens} label={sectionLabel(content, sectionKey)} />
      <ul className={d.simpleListGap}>
        {items.map((item, i) => (
          <li key={i} className={joinClasses(t.listItem, "text-ink-soft")}>
            {item}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function renderProjects(args: {
  resume: StructuredResume;
  tokens: StyleTokens;
  content: ContentConfig;
  sectionClassName: string;
}) {
  return renderSimpleStringList({ ...args, items: args.resume.projects, sectionKey: "projects" });
}

export function renderCertifications(args: {
  resume: StructuredResume;
  tokens: StyleTokens;
  content: ContentConfig;
  sectionClassName: string;
}) {
  return renderSimpleStringList({ ...args, items: args.resume.certifications, sectionKey: "certifications" });
}

export function renderAwards(args: {
  resume: StructuredResume;
  tokens: StyleTokens;
  content: ContentConfig;
  sectionClassName: string;
}) {
  return renderSimpleStringList({ ...args, items: args.resume.awards ?? [], sectionKey: "awards" });
}

export function renderPublications(args: {
  resume: StructuredResume;
  tokens: StyleTokens;
  content: ContentConfig;
  sectionClassName: string;
}) {
  return renderSimpleStringList({ ...args, items: args.resume.publications ?? [], sectionKey: "publications" });
}

export function renderLanguages({
  resume,
  tokens,
  content,
  sectionClassName,
}: {
  resume: StructuredResume;
  tokens: StyleTokens;
  content: ContentConfig;
  sectionClassName: string;
}) {
  const languages = resume.languages ?? [];
  if (languages.length === 0) return null;
  const d = density(tokens.density);
  const t = text(tokens.density);
  return (
    <section className={sectionClassName}>
      <SectionHeading tokens={tokens} label={sectionLabel(content, "languages")} />
      <p className={joinClasses(d.paragraphTop, t.paragraph, "text-ink-soft")}>
        {languages.map((l) => (l.level ? `${l.name} (${l.level})` : l.name)).join(" · ")}
      </p>
    </section>
  );
}

export function renderLinksSection({
  resume,
  tokens,
  content,
  sectionClassName,
}: {
  resume: StructuredResume;
  tokens: StyleTokens;
  content: ContentConfig;
  sectionClassName: string;
}) {
  // When the header already shows links, the section is redundant — this is
  // the config's escape hatch for skeletons where the header can't hold them.
  if (content.showLinksInHeader) return null;
  const links = resume.links ?? [];
  if (links.length === 0) return null;
  const d = density(tokens.density);
  const t = text(tokens.density);
  return (
    <section className={sectionClassName}>
      <SectionHeading tokens={tokens} label={sectionLabel(content, "links")} />
      <ul className={d.simpleListGap}>
        {links.map((link, i) => (
          <li key={i} className={joinClasses(t.listItem)}>
            <a
              href={link.url}
              className={joinClasses("underline underline-offset-2", tokens.accent === "rust" ? "text-rust" : "text-ink")}
            >
              {link.label}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function renderVolunteering({
  resume,
  tokens,
  content,
  sectionClassName,
}: {
  resume: StructuredResume;
  tokens: StyleTokens;
  content: ContentConfig;
  sectionClassName: string;
}) {
  const entries = resume.volunteering ?? [];
  if (entries.length === 0) return null;
  const d = density(tokens.density);
  const t = text(tokens.density);
  const titleFont = fontClass(tokens.bodyFont);
  return (
    <section className={sectionClassName}>
      <SectionHeading tokens={tokens} label={sectionLabel(content, "volunteering")} />
      <div className={d.entryListGap}>
        {entries.map((entry, i) => (
          <div key={i}>
            <div className="flex items-baseline justify-between gap-4">
              <span className={joinClasses(titleFont, t.entryTitle, "font-semibold")}>
                {entry.role} {entry.organisation && `— ${entry.organisation}`}
              </span>
              <span className={joinClasses("flex-shrink-0", t.entryMeta, "text-ink-soft")}>
                {dateRange(entry.startDate, entry.endDate)}
              </span>
            </div>
            {entry.description && (
              <p className={joinClasses(d.experienceEntryTextTop, t.entryText, "leading-relaxed text-ink-soft")}>
                {entry.description}
              </p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

export function renderCustomSections({
  resume,
  tokens,
  sectionClassName,
}: {
  resume: StructuredResume;
  tokens: StyleTokens;
  content: ContentConfig;
  sectionClassName: string;
}) {
  const sections = resume.customSections ?? [];
  if (sections.length === 0) return null;
  const d = density(tokens.density);
  const t = text(tokens.density);
  return (
    <>
      {sections.map((s, si) => (
        <section key={si} className={sectionClassName}>
          <SectionHeading tokens={tokens} label={s.title} />
          <ul className={d.simpleListGap}>
            {s.items.map((item, i) => (
              <li key={i} className={joinClasses(t.listItem, "text-ink-soft")}>
                {item}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

export function renderReferences({
  resume,
  tokens,
  sectionClassName,
}: {
  resume: StructuredResume;
  tokens: StyleTokens;
  content: ContentConfig;
  sectionClassName: string;
}) {
  if (!resume.referencesOnRequest) return null;
  const t = text(tokens.density);
  return (
    <section className={sectionClassName}>
      <p className={joinClasses(t.paragraph, "italic text-ink-soft")}>References available on request.</p>
    </section>
  );
}

/** section key -> renderer, so a skeleton can loop `content.sectionOrder` generically instead of a hand-written switch per skeleton. */
export const SECTION_RENDERERS: Record<
  Exclude<SectionKey, "summary">,
  (args: {
    resume: StructuredResume;
    tokens: StyleTokens;
    content: ContentConfig;
    sectionClassName: string;
  }) => React.ReactNode
> = {
  experience: renderExperience,
  education: renderEducation,
  skills: renderSkills,
  projects: renderProjects,
  certifications: renderCertifications,
  links: renderLinksSection,
  languages: renderLanguages,
  awards: renderAwards,
  publications: renderPublications,
  volunteering: renderVolunteering,
  customSections: renderCustomSections,
  references: renderReferences,
};
