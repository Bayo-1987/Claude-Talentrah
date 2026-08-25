import { contactLine, dateRange, type TemplateProps } from "./shared";

/**
 * Pipeline — Sales & Marketing.
 *
 * Built for the same reason as Portfolio Grid: it was already PREMIUM at 10
 * credits and rendered identically to the free default.
 *
 * Sales resumes are read for numbers, so this layout gives the summary the
 * weight usually reserved for a headline and sets experience descriptions at
 * full width with generous leading — quota attainment and revenue figures live
 * in that prose and get lost in a cramped two-column grid. Skills sit directly
 * under the header as a single scannable line, because tooling and territory
 * are the first filter.
 */
export function PipelineTemplate({ resume }: TemplateProps) {
  const { contact, summary, experience, education, skills, projects, certifications } = resume;

  return (
    <div className="mx-auto max-w-[720px] bg-paper p-10 text-ink print:p-0">
      <header className="pb-3">
        <h1 className="font-display text-[30px] leading-none">{contact.name || "Your name"}</h1>
        <p className="mt-1.5 font-body text-[12.5px] text-ink-soft">{contactLine(contact)}</p>
      </header>

      {skills.length > 0 && (
        <p className="border-y-[1.5px] border-ink py-2 font-body text-[12.5px] font-semibold uppercase tracking-[0.06em] text-ink">
          {skills.join("  /  ")}
        </p>
      )}

      {summary && (
        <p className="mt-4 font-display text-[17px] leading-[1.55] text-ink">{summary}</p>
      )}

      {experience.length > 0 && (
        <section className="mt-6">
          <h2 className="font-body text-[11px] font-bold uppercase tracking-[0.14em] text-rust">
            Track Record
          </h2>
          <div className="mt-3 flex flex-col gap-5">
            {experience.map((entry, i) => (
              <div key={i}>
                <div className="flex items-baseline justify-between gap-4 border-b border-line pb-1">
                  <span className="font-body text-[15.5px] font-bold">
                    {entry.title}
                    {entry.company && <span className="font-normal"> — {entry.company}</span>}
                  </span>
                  <span className="flex-shrink-0 font-body text-[12px] text-ink-soft">
                    {dateRange(entry.startDate, entry.endDate)}
                  </span>
                </div>
                {entry.location && (
                  <div className="mt-0.5 font-body text-[12px] text-ink-soft">{entry.location}</div>
                )}
                {entry.description && (
                  <p className="mt-1.5 font-body text-[14px] leading-[1.65] text-ink-soft">
                    {entry.description}
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {projects.length > 0 && (
        <section className="mt-6">
          <h2 className="font-body text-[11px] font-bold uppercase tracking-[0.14em] text-rust">
            Campaigns &amp; Accounts
          </h2>
          <ul className="mt-2 flex flex-col gap-1.5">
            {projects.map((p, i) => (
              <li key={i} className="font-body text-[13.5px] leading-relaxed text-ink-soft">
                {p}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mt-6 flex flex-wrap gap-x-10 gap-y-3 border-t border-line pt-4">
        {education.length > 0 && (
          <section>
            <h2 className="font-body text-[11px] font-bold uppercase tracking-[0.14em] text-rust">
              Education
            </h2>
            <div className="mt-1.5 flex flex-col gap-1">
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
            <div className="mt-1.5 flex flex-col gap-1">
              {certifications.map((c, i) => (
                <div key={i} className="font-body text-[13px] text-ink-soft">
                  {c}
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
