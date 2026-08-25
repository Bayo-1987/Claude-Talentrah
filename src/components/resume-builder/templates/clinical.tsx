import { contactLine, dateRange, type TemplateProps } from "./shared";

/**
 * Clinical — Healthcare.
 *
 * The differentiator is ORDER, not decoration: certifications and licensure
 * move directly under the header, above experience. In healthcare a licence is
 * the first thing a recruiter checks and a missing one disqualifies the
 * application outright, so burying it at the bottom — where every other
 * template puts it — is the wrong shape for this profession.
 *
 * Dense and sans-led for scanning; rules are hairlines rather than the heavy
 * 2.5px header rule, because this layout has more horizontal divisions and the
 * heavy weight repeated would fight itself.
 */
export function ClinicalTemplate({ resume }: TemplateProps) {
  const { contact, summary, experience, education, skills, projects, certifications } = resume;

  return (
    <div className="mx-auto max-w-[720px] bg-paper p-10 text-ink print:p-0">
      <header className="border-b-[1.5px] border-ink pb-3">
        <h1 className="font-display text-[26px] leading-tight">{contact.name || "Your name"}</h1>
        <p className="mt-1 font-body text-[12.5px] text-ink-soft">{contactLine(contact)}</p>
      </header>

      {certifications.length > 0 && (
        <section className="mt-4 border-b border-line pb-4">
          <h2 className="font-body text-[11px] font-bold uppercase tracking-[0.14em] text-rust">
            Licensure &amp; Certifications
          </h2>
          <ul className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1">
            {certifications.map((c, i) => (
              <li key={i} className="font-body text-[13px] text-ink">
                {c}
              </li>
            ))}
          </ul>
        </section>
      )}

      {summary && (
        <section className="mt-4">
          <p className="font-body text-[13.5px] leading-relaxed text-ink-soft">{summary}</p>
        </section>
      )}

      {experience.length > 0 && (
        <section className="mt-5">
          <h2 className="font-body text-[11px] font-bold uppercase tracking-[0.14em] text-rust">
            Clinical Experience
          </h2>
          <div className="mt-2 flex flex-col gap-3">
            {experience.map((entry, i) => (
              <div key={i} className="border-l-2 border-line pl-3">
                <div className="flex items-baseline justify-between gap-4">
                  <span className="font-body text-[14px] font-semibold">{entry.title}</span>
                  <span className="flex-shrink-0 font-body text-[11.5px] text-ink-soft">
                    {dateRange(entry.startDate, entry.endDate)}
                  </span>
                </div>
                <div className="font-body text-[12.5px] text-ink-soft">
                  {[entry.company, entry.location].filter(Boolean).join(" · ")}
                </div>
                {entry.description && (
                  <p className="mt-1 font-body text-[13px] leading-snug text-ink-soft">
                    {entry.description}
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="mt-5 grid grid-cols-2 gap-6">
        {education.length > 0 && (
          <section>
            <h2 className="font-body text-[11px] font-bold uppercase tracking-[0.14em] text-rust">
              Education
            </h2>
            <div className="mt-2 flex flex-col gap-2">
              {education.map((entry, i) => (
                <div key={i}>
                  <div className="font-body text-[13.5px] font-semibold">{entry.school}</div>
                  <div className="font-body text-[12px] text-ink-soft">
                    {[entry.degree, dateRange(entry.startDate, entry.endDate)]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {skills.length > 0 && (
          <section>
            <h2 className="font-body text-[11px] font-bold uppercase tracking-[0.14em] text-rust">
              Clinical Skills
            </h2>
            <ul className="mt-2 flex flex-col gap-0.5">
              {skills.map((s, i) => (
                <li key={i} className="font-body text-[13px] text-ink-soft">
                  {s}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {projects.length > 0 && (
        <section className="mt-5">
          <h2 className="font-body text-[11px] font-bold uppercase tracking-[0.14em] text-rust">
            Research &amp; Quality Improvement
          </h2>
          <ul className="mt-2 flex flex-col gap-1">
            {projects.map((p, i) => (
              <li key={i} className="font-body text-[13px] text-ink-soft">
                {p}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
