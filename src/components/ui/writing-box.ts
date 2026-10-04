/**
 * The frame every writing surface shares: the plain TextArea and the bold/italic editor (and the full job-description editor's content
 * area) use these classes, so a person sees one family of boxes, not one-line inputs stretched taller. Tokens only, no radius, the
 * Editorial 1.5px ink border; the focus state is the rust border the rest of the app's fields use. The text is 16px on a phone (iOS Safari
 * zooms the page on focus into anything smaller) and 15px from the sm breakpoint up.
 */
export const WRITING_BOX_FRAME =
  "border-[1.5px] border-ink bg-card px-3.5 py-2.5 font-body text-[16px] leading-[1.65] sm:text-[15px] text-ink outline-none focus:border-rust";

/** The label above a writing box. */
export const WRITING_BOX_LABEL = "font-body text-[13px] font-semibold text-ink-soft";

/** Help text and the character counter under a writing box. */
export const WRITING_BOX_META = "font-body text-[12.5px] text-ink-soft";
