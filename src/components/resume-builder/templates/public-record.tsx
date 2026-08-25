import { contactLine, dateRange, type TemplateProps } from "./shared";

/**
 * Public Record — Government & Public Sector.
 *
 * The deliberate pick: a large segment neither Resume-Now nor Enhancv targets,
 * and a natural fit for a Nigeria-first product where the public sector is a
 * major employer.
 *
 * Public-sector screening is closer to form-filling than to marketing. Panels
 * frequently score against stated criteria, so this layout is explicitly
 * labelled and long-form: every entry carries a visible field label, dates are
 * never abbreviated away, and nothing is truncated or collapsed into a
 * decorative row. Density is deliberately LOW — whitespace between labelled
 * rows is what makes a criteria-scored read possible.
 */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[128px_1fr] gap-3 border-b border-line py-1.5">
      <span className="font-body text-[11px] uppercase tracking-[0.1em] text-ink-soft">
        {label}
      </span>
      <span className="font-body text-[13.5px] text-ink">{children}</span>
    </div>
  );
}

export function PublicRecordTemplate({ resume }: TemplateProps) {
  const { contact, summary, experience, education, skills, projects, certifications } = resume;

  return (
    <div className="mx-auto max-w-[720px] bg-paper p-10 text-ink print:p-0">
      <header className="border-b-[2.5px] border-ink pb-3">
        <h1 className="font-display text-[26px]">{contact.name || "Your name"}</h1>
      </header>

      <section className="mt-3">
        <Field label="Contact">{contactLine(contact) || "—"}</Field>
      </section>

      {summary && (
        <section className="mt-5">
          <h2 className="font-body text-[11px] font-bold uppercase tracking-[0.14em] text-rust">
            Statement of Suitability
          </h2>
          <p className="mt-2 font-body text-[13.5px] leading-[1.75] text-ink-soft">{summary}</p>
        </section>
      )}

      {experience.length > 0 && (
        <section className="mt-6">
          <h2 className="font-body text-[11px] font-bold uppercase tracking-[0.14em] text-rust">
            Employment History
          </h2>
          <div className="mt-2 flex flex-col gap-4">
            {experience.map((entry, i) => (
              <div key={i}>
                <Field label="Position">{entry.title || "—"}</Field>
                {entry.company && <Field label="Organisation">{entry.company}</Field>}
                <Field label="Dates">{dateRange(entry.startDate, entry.endDate) || "—"}</Field>
                {entry.location && <Field label="Location">{entry.location}</Field>}
                {entry.description && (
                  <p className="mt-2 font-body text-[13.5px] leading-[1.75] text-ink-soft">
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
          <h2 className="font-body text-[11px] font-bold uppercase tracking-[0.14em] text-rust">
            Education &amp; Qualifications
          </h2>
          <div className="mt-2 flex flex-col gap-3">
            {education.map((entry, i) => (
              <div key={i}>
                <Field label="Institution">{entry.school || "—"}</Field>
                {entry.degree && <Field label="Qualification">{entry.degree}</Field>}
                <Field label="Dates">{dateRange(entry.startDate, entry.endDate) || "—"}</Field>
              </div>
            ))}
          </div>
        </section>
      )}

      {certifications.length > 0 && (
        <section className="mt-6">
          <h2 className="font-body text-[11px] font-bold uppercase tracking-[0.14em] text-rust">
            Professional Registration
          </h2>
          <div className="mt-2">
            {certifications.map((c, i) => (
              <Field key={i} label={`Item ${i + 1}`}>
                {c}
              </Field>
            ))}
          </div>
        </section>
      )}

      {skills.length > 0 && (
        <section className="mt-6">
          <h2 className="font-body text-[11px] font-bold uppercase tracking-[0.14em] text-rust">
            Competencies
          </h2>
          <ul className="mt-2 flex flex-col gap-1">
            {skills.map((s, i) => (
              <li key={i} className="font-body text-[13.5px] text-ink-soft">
                {s}
              </li>
            ))}
          </ul>
        </section>
      )}

      {projects.length > 0 && (
        <section className="mt-6">
          <h2 className="font-body text-[11px] font-bold uppercase tracking-[0.14em] text-rust">
            Projects &amp; Assignments
          </h2>
          <ul className="mt-2 flex flex-col gap-1.5">
            {projects.map((p, i) => (
              <li key={i} className="font-body text-[13.5px] leading-[1.75] text-ink-soft">
                {p}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
