import type { ReactNode } from "react";

/**
 * The box a resume is shown in wherever it can be printed to PDF: the seeker's
 * live preview and the employer's applicant view (and the QA fixture
 * `/dev/resume-print-fixture/[template]` that e2e/resume-print-margins.spec.ts
 * measures). On screen it is the bordered preview box. In print it is the page
 * margin.
 *
 * WHY THE MARGIN LIVES HERE. `globals.css` keeps `@page { margin: 0 }` so the
 * browser draws no header or footer (date, tab title, URL, page number) on a
 * PDF a candidate hands to an employer. The price is that the print engine
 * then has no margin of its own, so a page breaks wherever the content runs
 * out: page 2 started 3-4pt from the top edge and page 1 ended 10-30pt from
 * the bottom. A margin can still be put INSIDE the page, and it has to repeat
 * on every page, which only a fragmented box can do:
 *
 *   `box-decoration-break: clone` makes each page-sized fragment of the frame
 *   below draw its own copy of the padding, so every page gets 0.5in at the top
 *   and at the bottom.
 *
 * The other candidate, a `<table>` with a `<thead>` and `<tfoot>` spacer that
 * repeats per page, measured the same in Chromium (0.5in, repeated); this one
 * was chosen because it adds no table to a document whose text order and
 * structure ATS parsers read, and a browser that ignores the property falls
 * back to today's behaviour rather than to something broken. Measured, not
 * assumed: e2e/resume-print-margins.spec.ts prints a multi-page resume and
 * measures the white at every page break.
 *
 * `print:*:py-0` removes the vertical padding the templates themselves carry
 * (`p-10`) in print only, so page 1 does not get that on top of the frame's.
 * Side padding is untouched. `print:bg-resume-paper` keeps the margin band the
 * same white as the page content when background graphics are on.
 */
export function ResumePrintSurface({ children }: { children: ReactNode }) {
  return (
    <div className="border-[1.5px] border-ink print:border-none">
      <div className="print:box-decoration-clone print:bg-resume-paper print:py-[0.5in] print:*:py-0">{children}</div>
    </div>
  );
}
