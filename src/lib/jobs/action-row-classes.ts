/**
 * The class strings of the two rows that hold Apply, as one definition the page, the card and the browser specs share (PHONE-ACTIONS-EDGE-1). They are LITERAL strings, not built from the launcher's
 * constants, because Tailwind reads class names from source text; tests/farah/launcher-geometry.test.ts holds the literals to src/lib/farah/launcher-geometry.ts.
 *
 * The Farah launcher stands bottom LEFT on a phone (below 760px), so:
 *   the job CARD's row    ends at the card's right edge, as on a desktop: right-aligned, wrapping below 760px, no reserve on the right; a 36px clearance on the left
 *                         (JOB_CARD_LEFT_CLEARANCE_PX) keeps its first control from starting under the launcher on a wide phone.
 *   the job PAGE's row    is right-aligned below 760px with the launcher's 72px column reserved on its LEFT, so no control can come under the launcher (measured at 360, 390 and 412);
 *                         from 760px up it is the left-aligned row it always was.
 * Both rows carry data-farah-avoid, and e2e/farah-launcher.spec.ts sweeps every row that does.
 */
export const JOB_CARD_ACTIONS_CLASS = "relative flex flex-wrap items-center justify-end gap-2.5 max-[760px]:pl-[36px] min-[760px]:flex-nowrap";
export const JOB_PAGE_ACTIONS_CLASS = "flex flex-wrap items-center gap-3 max-[760px]:justify-end max-[760px]:pl-[72px]";
