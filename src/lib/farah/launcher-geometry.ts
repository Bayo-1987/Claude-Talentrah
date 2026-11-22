/**
 * Where the Farah launcher stands on a phone, as numbers (PHONE-ACTIONS-EDGE-1, option C). One place, so the launcher, the end-of-page spacer and the rows that keep clear of it cannot drift apart.
 *
 * The launcher is BOTTOM LEFT: a SIZE circle, INSET from the screen's left edge and bottom. The inset stays 16 on purpose: on an iPhone the left screen edge is the back-swipe gesture's, and a button
 * any closer to it would be in that gesture's way (the owner tests this on a real phone; if it ever has to move, this is the one number).
 *
 * Neither action row reserves RESERVE any more: the job card's row ends at the card's right edge (with only the small left clearance below), and the job page's row is left-aligned and scrolls clear of the
 * launcher (the end-of-page spacer in src/components/app-shell/farah-sheet-host.tsx is RESERVE tall). See src/lib/jobs/action-row-classes.ts.
 */
export const LAUNCHER_SIZE_PX = 56;
export const LAUNCHER_INSET_PX = 16;
/** The column the launcher occupies from the left screen edge, with its inset: what a left-aligned row must stay clear of. */
export const LAUNCHER_RESERVE_PX = LAUNCHER_SIZE_PX + LAUNCHER_INSET_PX;

/**
 * The job CARD's row ends at the card's right edge and needs no reserve there, but on a wide phone its first control (Save) would start under the launcher (the browser spec found it at 390 and 412).
 * So the row keeps this much clear on its LEFT: the card's content edge is 45.5px in from the screen (24px page gutter, 1.5px border, 20px padding), the launcher's column ends at RESERVE, and the
 * controls must start 8px beyond it: 72 + 8 - 45.5 = 34.5, rounded up. Width taken from the row only on a phone; the controls still end at the right edge.
 */
export const JOB_CARD_LEFT_CLEARANCE_PX = 36;
