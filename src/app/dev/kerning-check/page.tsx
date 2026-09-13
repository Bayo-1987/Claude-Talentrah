import { barlowCondensed } from "@/components/resume-builder/skeletons/fonts";

/**
 * TEMPORARY, send-197 follow-up (kerning/Chromium-PDF-extraction investigation).
 *
 * QA-only, same convention as `/dev/design-check` and `/dev/template-skeletons`:
 * not linked from anywhere a real visitor lands, reached by URL only.
 *
 * Deliberately NOT built on `SingleColumnSkeleton`/`section-blocks.tsx` —
 * the last two rounds of this investigation each modified that shared
 * component to force a font-size, and each time it silently changed a REAL
 * catalog template's (`field-notes`) actual rendered output, caught only
 * after a CI round-trip. This page is a standalone, disposable rig that
 * touches zero shared/production code paths: nothing here can affect any
 * real resume a user generates. Delete this whole route once the
 * investigation concludes.
 *
 * Renders the same "ZQEDUCATION"/"Certification Lead" text this
 * investigation has already used in `ats-test-fixture.ts`, at the same
 * literal 14.5px + font-semibold combination that corrupts on real CI, in
 * both DM Sans (`font-body`, already confirmed corrupting) and Barlow
 * Condensed (`font-condensed`, corrupted differently in an earlier round —
 * "Staff Engineer" -> "St af f Engineer", "Certification Lead" -> "Cert
 * ificat ion Lead" — but never captured at the PDF-byte level, only as an
 * extracted string). Each font gets three variants: plain, `font-kerning:
 * none`, and `font-feature-settings` with kern/calt/liga all explicitly
 * disabled — testing whether either CSS lever changes anything, now that
 * the font's own GPOS/GSUB tables have been checked directly and show no
 * kerning, no contextual-alternate rule, and no ligature rule touching any
 * of the corrupted letter pairs (kern is 0 or negative on every pair
 * checked; calt/liga rules exist in both fonts but none of them include
 * the T/I, f/f, or t/a glyphs in any rule).
 */
export default function KerningCheckPage() {
  // Each row gets its own numbered marker prefix (ZQDM1/ZQDM2/ZQDM3,
  // ZQBC1/ZQBC2/ZQBC3) — three rows per font share the same trailing text,
  // so a shared marker would make every occurrence indistinguishable to
  // `indexOf` in the e2e test that reads this page's generated PDF.
  const dmSansText = (n: number) => `ZQDM${n}EDUCATION University of Abuja — B.Sc.`;
  const barlowText = (n: number) => `ZQBC${n}EXPERIENCE Staff Engineer — Certification Lead — Northbridge Systems`;

  const rowClass = "text-[14.5px] font-semibold";

  return (
    <div className={`bg-bg p-10 ${barlowCondensed.variable}`}>
      <h1 className="mb-6 text-lg font-bold">Kerning/PDF-extraction diagnostic — temporary</h1>

      <section className="mb-8">
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-ink-soft">
          DM Sans (font-body)
        </h2>
        <div className="flex flex-col gap-3 font-body">
          <div data-row="dm-base" className={rowClass}>
            {dmSansText(1)}
          </div>
          <div data-row="dm-kerning-none" className={rowClass} style={{ fontKerning: "none" }}>
            {dmSansText(2)}
          </div>
          <div
            data-row="dm-features-off"
            className={rowClass}
            style={{ fontFeatureSettings: '"kern" 0, "calt" 0, "liga" 0' }}
          >
            {dmSansText(3)}
          </div>
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-ink-soft">
          Barlow Condensed (font-condensed)
        </h2>
        <div className="flex flex-col gap-3 font-condensed">
          <div data-row="bc-base" className={rowClass}>
            {barlowText(1)}
          </div>
          <div data-row="bc-kerning-none" className={rowClass} style={{ fontKerning: "none" }}>
            {barlowText(2)}
          </div>
          <div
            data-row="bc-features-off"
            className={rowClass}
            style={{ fontFeatureSettings: '"kern" 0, "calt" 0, "liga" 0' }}
          >
            {barlowText(3)}
          </div>
        </div>
      </section>
    </div>
  );
}
