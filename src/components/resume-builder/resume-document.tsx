import type { StructuredResume } from "@/lib/resume/types";

/**
 * Shared visual layout for every template in Phase 1 — the gallery lets
 * users pick a template for organization/premium-gating purposes, but only
 * one actual rendered layout exists yet (plan doc M4 scope note). Distinct
 * per-template layouts are a fast-follow, not required to prove the
 * choose→edit→preview→export loop works end to end.
 */
export function ResumeDocument({ resume }: { resume: StructuredResume }) {
  const { contact, summary, experience, education, skills, projects, certifications } = resume;

  return (
    <div className="mx-auto max-w-[720px] bg-paper p-10 text-ink print:p-0">
      <div className="border-b-[2.5px] border-ink pb-4">
        <h1 className="font-display text-[28px]">{contact.name || "Your name"}</h1>
        <p className="mt-1 text-[13px] text-ink-soft">
          {[contact.email, contact.phone, contact.location].filter(Boolean).join(" · ")}
        </p>
      </div>

      {summary && (
        <section className="mt-5">
          <p className="text-[14px] leading-relaxed text-ink-soft">{summary}</p>
        </section>
      )}

      {experience.length > 0 && (
        <section className="mt-6">
          <h2 className="font-display text-[13px] font-bold uppercase tracking-[0.1em] text-rust">
            Experience
          </h2>
          <div className="mt-3 flex flex-col gap-4">
            {experience.map((entry, i) => (
              <div key={i}>
                <div className="flex items-baseline justify-between gap-4">
                  <span className="font-body text-[15px] font-semibold">
                    {entry.title} {entry.company && `— ${entry.company}`}
                  </span>
                  <span className="flex-shrink-0 text-[12px] text-ink-soft">
                    {[entry.startDate, entry.endDate].filter(Boolean).join(" – ")}
                  </span>
                </div>
                {entry.location && <div className="text-[12.5px] text-ink-soft">{entry.location}</div>}
                {entry.description && (
                  <p className="mt-1 text-[13.5px] leading-relaxed text-ink-soft">{entry.description}</p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {education.length > 0 && (
        <section className="mt-6">
          <h2 className="font-display text-[13px] font-bold uppercase tracking-[0.1em] text-rust">
            Education
          </h2>
          <div className="mt-3 flex flex-col gap-2">
            {education.map((entry, i) => (
              <div key={i} className="flex items-baseline justify-between gap-4">
                <span className="font-body text-[14.5px] font-semibold">
                  {entry.school} {entry.degree && `— ${entry.degree}`}
                </span>
                <span className="flex-shrink-0 text-[12px] text-ink-soft">
                  {[entry.startDate, entry.endDate].filter(Boolean).join(" – ")}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {skills.length > 0 && (
        <section className="mt-6">
          <h2 className="font-display text-[13px] font-bold uppercase tracking-[0.1em] text-rust">
            Skills
          </h2>
          <p className="mt-2 text-[13.5px] text-ink-soft">{skills.join(" · ")}</p>
        </section>
      )}

      {projects.length > 0 && (
        <section className="mt-6">
          <h2 className="font-display text-[13px] font-bold uppercase tracking-[0.1em] text-rust">
            Projects
          </h2>
          <ul className="mt-2 flex flex-col gap-1">
            {projects.map((p, i) => (
              <li key={i} className="text-[13.5px] text-ink-soft">
                {p}
              </li>
            ))}
          </ul>
        </section>
      )}

      {certifications.length > 0 && (
        <section className="mt-6">
          <h2 className="font-display text-[13px] font-bold uppercase tracking-[0.1em] text-rust">
            Certifications
          </h2>
          <ul className="mt-2 flex flex-col gap-1">
            {certifications.map((c, i) => (
              <li key={i} className="text-[13.5px] text-ink-soft">
                {c}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
