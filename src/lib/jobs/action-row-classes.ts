/**
 * The class strings of the two rows that hold Apply, as one definition the page, the card and the browser specs share (PHONE-ACTIONS-EDGE-1). They are LITERAL strings, not built from the launcher's
 * constants, because Tailwind reads class names from source text; tests/farah/launcher-geometry.test.ts holds the literals to src/lib/farah/launcher-geometry.ts.
 *
 * The Farah launcher stands bottom LEFT on a phone (below 760px), so:
 *   the job CARD's row    ends at the card's right edge, as on a desktop: right-aligned, wrapping below 760px, no reserve on the right; a 36px clearance on the left
 *                         (JOB_CARD_LEFT_CLEARANCE_PX) keeps its first control from starting under the launcher on a wide phone.
 *   the job PAGE's row    is LEFT-aligned at every width, on a phone too, with no reserve of its own. It used to be right-aligned below 760px with the launcher's 72px column reserved on its left;
 *                         on a 390px phone that pushed every control (Save, Apply by email, Copy address, Mark as applied, the dashed note, Tailor my resume, Ask Farah) away from the left edge
 *                         the rest of the page reads from. The launcher is fixed, so the row can pass under it while the page scrolls, and the page scrolls it clear: the shell keeps a spacer
 *                         under the last thing on every page below 760px (farah-launcher-spacer, LAUNCHER_RESERVE_PX tall), so even the last controls can be scrolled up out of the launcher's column.
 *                         e2e/farah-launcher.spec.ts checks exactly that ("scrolls clear of the launcher").
 * Both rows carry data-farah-avoid, and e2e/farah-launcher.spec.ts sweeps every row that does.
 */
export const JOB_CARD_ACTIONS_CLASS = "relative flex flex-wrap items-center justify-end gap-2.5 max-[760px]:pl-[36px] min-[760px]:flex-nowrap";
export const JOB_PAGE_ACTIONS_CLASS = "flex flex-wrap items-center gap-3";
