import { contactLine, dateRange, type TemplateProps } from "./shared";

/**
 * Portfolio Grid — Design.
 *
 * Not part of the four new templates, but built here because it was already
 * PREMIUM at 10 credits and rendered identically to the free default. A paid
 * template that delivers the free layout is a product that takes money for
 * nothing, so it is fixed in the same pass that made distinct layouts possible
 * at all. tests/resume-builder/template-registry.test.ts asserts no premium
 * template can be in that state again.
 *
 * The layout inverts the usual hierarchy for a design portfolio: projects come
 * first and get real space in a two-column grid, because for a designer the
 * work IS the qualification. Experience compresses to a supporting timeline.
 */
export function PortfolioGridTemplate({ resume }: TemplateProps) {
  const { contact, summary, experience, education, skills, projects, certifications } = resume;

  return (
    <div className="mx-auto max-w-[720px] bg-paper p-10 text-ink print:p-0">
      <header className="border-b-[2.5px] border-ink pb-4">
        <h1 className="font-display text-[32px] leading-none tracking-[-0.01em]">
          {contact.name || "Your name"}
        </h1>
        <p className="mt-2 font-body text-[12.5px] text-ink-soft">{contactLine(contact)}</p>
      </header>

      {summary && (
        <p className="mt-5 font-display text-[16px] leading-[1.6] text-ink">{summary}</p>
      )}

      {projects.length > 0 && (
        <section className="mt-6">
          <h2 className="font-body text-[11px] font-bold uppercase tracking-[0.14em] text-rust">
            Selected Work
          </h2>
          <div className="mt-3 grid grid-cols-2 gap-x-5 gap-y-4">
            {projects.map((p, i) => (
              <div key={i} className="border-t border-ink pt-2">
                <span className="font-body text-[11px] text-ink-soft">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <p className="mt-1 font-body text-[13.5px] leading-snug text-ink">{p}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {experience.length > 0 && (
        <section className="mt-6 border-t border-line pt-4">
          <h2 className="font-body text-[11px] font-bold uppercase tracking-[0.14em] text-rust">
            Experience
          </h2>
          <div className="mt-3 flex flex-col gap-2.5">
            {experience.map((entry, i) => (
              <div key={i} className="grid grid-cols-[92px_1fr] gap-3">
                <span className="font-body text-[11.5px] leading-[1.5] text-ink-soft">
                  {dateRange(entry.startDate, entry.endDate)}
                </span>
                <div>
                  <span className="font-body text-[14px] font-semibold">{entry.title}</span>
                  {entry.company && (
                    <span className="font-body text-[13.5px] text-ink-soft"> · {entry.company}</span>
                  )}
                  {entry.description && (
                    <p className="mt-0.5 font-body text-[13px] leading-snug text-ink-soft">
                      {entry.description}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="mt-6 grid grid-cols-3 gap-5 border-t border-line pt-4">
        {skills.length > 0 && (
          <section className="col-span-2">
            <h2 className="font-body text-[11px] font-bold uppercase tracking-[0.14em] text-rust">
              Capabilities
            </h2>
            <p className="mt-2 font-body text-[13px] leading-relaxed text-ink-soft">
              {skills.join(" · ")}
            </p>
          </section>
        )}
        <section>
          {education.length > 0 && (
            <>
              <h2 className="font-body text-[11px] font-bold uppercase tracking-[0.14em] text-rust">
                Education
              </h2>
              <div className="mt-2 flex flex-col gap-1">
                {education.map((entry, i) => (
                  <div key={i} className="font-body text-[12.5px] text-ink-soft">
                    {entry.school}
                    {entry.degree && <span> — {entry.degree}</span>}
                  </div>
                ))}
              </div>
            </>
          )}
          {certifications.length > 0 && (
            <div className="mt-3">
              {certifications.map((c, i) => (
                <div key={i} className="font-body text-[12.5px] text-ink-soft">
                  {c}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
