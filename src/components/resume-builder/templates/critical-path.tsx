import { contactLine, dateRange, type TemplateProps } from "./shared";

/**
 * Critical Path — Project Management.
 *
 * Enhancv's single most-popular category, so this one is worth getting right
 * rather than shipping as a variant of Clean Professional.
 *
 * The layout is outcome-forward: a rust rule runs down the left of the
 * experience column so the reader's eye tracks a timeline, dates are pulled
 * into their own left gutter rather than floated right, and skills render as a
 * bordered inline row near the top — PM screening is largely a
 * methodology/tooling keyword match, so those belong above the fold rather
 * than at the bottom.
 */
export function CriticalPathTemplate({ resume }: TemplateProps) {
  const { contact, summary, experience, education, skills, projects, certifications } = resume;

  return (
    <div className="mx-auto max-w-[720px] bg-paper p-10 text-ink print:p-0">
      <header className="flex items-end justify-between gap-6 border-b-[2.5px] border-ink pb-3">
        <h1 className="font-display text-[28px] leading-none">{contact.name || "Your name"}</h1>
        <p className="pb-0.5 text-right font-body text-[12px] leading-snug text-ink-soft">
          {contactLine(contact)}
        </p>
      </header>

      {summary && (
        <p className="mt-4 font-body text-[14px] leading-relaxed text-ink-soft">{summary}</p>
      )}

      {skills.length > 0 && (
        <section className="mt-4 border-y border-line py-3">
          <div className="flex flex-wrap gap-x-2 gap-y-1.5">
            {skills.map((s, i) => (
              <span
                key={i}
                className="border border-line px-2 py-0.5 font-body text-[12px] text-ink-soft"
              >
                {s}
              </span>
            ))}
          </div>
        </section>
      )}

      {experience.length > 0 && (
        <section className="mt-5">
          <h2 className="font-body text-[11px] font-bold uppercase tracking-[0.14em] text-rust">
            Delivery Experience
          </h2>
          <div className="mt-3 flex flex-col gap-4 border-l-2 border-rust pl-4">
            {experience.map((entry, i) => (
              <div key={i}>
                <div className="font-body text-[11.5px] uppercase tracking-[0.08em] text-ink-soft">
                  {dateRange(entry.startDate, entry.endDate)}
                </div>
                <div className="font-body text-[15px] font-semibold leading-snug">
                  {entry.title}
                  {entry.company && <span className="font-normal"> · {entry.company}</span>}
                </div>
                {entry.location && (
                  <div className="font-body text-[12px] text-ink-soft">{entry.location}</div>
                )}
                {entry.description && (
                  <p className="mt-1 font-body text-[13.5px] leading-relaxed text-ink-soft">
                    {entry.description}
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {projects.length > 0 && (
        <section className="mt-5">
          <h2 className="font-body text-[11px] font-bold uppercase tracking-[0.14em] text-rust">
            Programmes &amp; Initiatives
          </h2>
          <ul className="mt-2 flex flex-col gap-1">
            {projects.map((p, i) => (
              <li key={i} className="font-body text-[13.5px] leading-relaxed text-ink-soft">
                {p}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mt-5 grid grid-cols-2 gap-6 border-t border-line pt-4">
        {education.length > 0 && (
          <section>
            <h2 className="font-body text-[11px] font-bold uppercase tracking-[0.14em] text-rust">
              Education
            </h2>
            <div className="mt-2 flex flex-col gap-1.5">
              {education.map((entry, i) => (
                <div key={i} className="font-body text-[13px]">
                  <span className="font-semibold">{entry.school}</span>
                  {entry.degree && <span className="text-ink-soft"> — {entry.degree}</span>}
                </div>
              ))}
            </div>
          </section>
        )}
        {certifications.length > 0 && (
          <section>
            <h2 className="font-body text-[11px] font-bold uppercase tracking-[0.14em] text-rust">
              Certifications
            </h2>
            <ul className="mt-2 flex flex-col gap-1">
              {certifications.map((c, i) => (
                <li key={i} className="font-body text-[13px] text-ink-soft">
                  {c}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
