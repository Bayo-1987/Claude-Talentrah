import { contactLine, dateRange, type TemplateProps } from "./shared";

/**
 * Statute — Legal.
 *
 * The most conservative layout in the set, on purpose. Legal hiring rewards
 * convention: a centred masthead, generous margins, serif throughout, and
 * section heads in small caps rather than the rust eyebrow the other templates
 * use. Nothing here is decorative — the restraint IS the signal, and a
 * legal-sector reader reads a visually inventive resume as a negative.
 *
 * Admissions and certifications sit immediately under the header for the same
 * reason Clinical elevates licensure: bar admission is a threshold question.
 */
export function StatuteTemplate({ resume }: TemplateProps) {
  const { contact, summary, experience, education, skills, projects, certifications } = resume;

  return (
    <div className="mx-auto max-w-[680px] bg-paper px-12 py-10 text-ink print:px-0 print:py-0">
      <header className="border-b border-ink pb-4 text-center">
        <h1 className="font-display text-[27px] tracking-[0.01em]">{contact.name || "Your name"}</h1>
        <p className="mt-1.5 font-display text-[12.5px] italic text-ink-soft">
          {contactLine(contact)}
        </p>
      </header>

      {certifications.length > 0 && (
        <section className="mt-5 text-center">
          <h2 className="font-display text-[12px] font-semibold uppercase tracking-[0.18em]">
            Admissions
          </h2>
          <p className="mt-1.5 font-display text-[13.5px] text-ink-soft">
            {certifications.join("  ·  ")}
          </p>
        </section>
      )}

      {summary && (
        <section className="mt-5 border-t border-line pt-4">
          <p className="font-display text-[14px] leading-[1.7] text-ink-soft">{summary}</p>
        </section>
      )}

      {experience.length > 0 && (
        <section className="mt-6">
          <h2 className="font-display text-[12px] font-semibold uppercase tracking-[0.18em]">
            Professional Experience
          </h2>
          <div className="mt-3 flex flex-col gap-5">
            {experience.map((entry, i) => (
              <div key={i}>
                <div className="font-display text-[15px] font-semibold">
                  {entry.company || entry.title}
                </div>
                <div className="flex items-baseline justify-between gap-4">
                  <span className="font-display text-[13.5px] italic text-ink-soft">
                    {entry.company ? entry.title : ""}
                    {entry.location && `, ${entry.location}`}
                  </span>
                  <span className="flex-shrink-0 font-display text-[12.5px] text-ink-soft">
                    {dateRange(entry.startDate, entry.endDate)}
                  </span>
                </div>
                {entry.description && (
                  <p className="mt-1.5 font-display text-[13.5px] leading-[1.7] text-ink-soft">
                    {entry.description}
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {education.length > 0 && (
        <section className="mt-6">
          <h2 className="font-display text-[12px] font-semibold uppercase tracking-[0.18em]">
            Education
          </h2>
          <div className="mt-3 flex flex-col gap-2.5">
            {education.map((entry, i) => (
              <div key={i}>
                <div className="font-display text-[14.5px] font-semibold">{entry.school}</div>
                <div className="flex items-baseline justify-between gap-4">
                  <span className="font-display text-[13px] italic text-ink-soft">
                    {entry.degree}
                  </span>
                  <span className="flex-shrink-0 font-display text-[12.5px] text-ink-soft">
                    {dateRange(entry.startDate, entry.endDate)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {projects.length > 0 && (
        <section className="mt-6">
          <h2 className="font-display text-[12px] font-semibold uppercase tracking-[0.18em]">
            Notable Matters
          </h2>
          <ul className="mt-3 flex flex-col gap-1.5">
            {projects.map((p, i) => (
              <li key={i} className="font-display text-[13.5px] leading-[1.7] text-ink-soft">
                {p}
              </li>
            ))}
          </ul>
        </section>
      )}

      {skills.length > 0 && (
        <section className="mt-6 border-t border-line pt-4">
          <h2 className="font-display text-[12px] font-semibold uppercase tracking-[0.18em]">
            Practice Areas
          </h2>
          <p className="mt-2 font-display text-[13.5px] leading-relaxed text-ink-soft">
            {skills.join("  ·  ")}
          </p>
        </section>
      )}
    </div>
  );
}
