/**
 * The seeker masthead's links and the widths at which each one is in the bar or behind "More" (NAV-DROPDOWN-REALIGN-1, owner decision OWNER-DECISION-NAV-DEFAULTS-1: Option B, stepped).
 *
 *   >= 1536   all eight in the bar; no "More"
 *   1480-1535 seven in the bar; "More" holds Feedback
 *   1280-1479 five in the bar; "More" holds Mentorship, Talent Directory, Feedback
 *   1024-1279 three in the bar; "More" holds the other five
 *   < 1024    no bar at all; the phone disclosure holds all eight
 *
 * The widths are measured, not chosen by eye (reports/S6/2026-11-16-nav-realign-plan.md): the full row needs about 1470px with a credits chip and about 1525px with a Pass chip, on macOS font metrics, and
 * the Linux CI runner renders the row about 18px wider. The 1480 step is the owner's rounding of that measurement.
 *
 * Tailwind only generates classes it can read as whole literals, so the class names below are written out, one per step, and the masthead takes them from here instead of building strings.
 * The numbers and the classes live together so a test of the numbers is a test of the markup's rule.
 */
export interface NavLink {
  href: string;
  label: string;
  /** The width from which the link is in the bar rather than behind "More". */
  barFrom: 1024 | 1280 | 1480 | 1536;
}

export const NAV_LINKS: readonly NavLink[] = [
  { href: "/jobs", label: "Jobs", barFrom: 1024 },
  { href: "/tracker", label: "Job Tracker", barFrom: 1024 },
  { href: "/auto-apply", label: "Auto-Apply", barFrom: 1024 },
  { href: "/resume-builder", label: "Resume Builder", barFrom: 1280 },
  { href: "/scholarships", label: "Scholarships", barFrom: 1280 },
  { href: "/mentorship", label: "Mentorship", barFrom: 1480 },
  { href: "/talent-directory/verify", label: "Talent Directory", barFrom: 1480 },
  { href: "/feedback", label: "Feedback", barFrom: 1536 },
];

/** Below this the bar is gone and the phone disclosure is the navigation. */
export const NAV_BAR_MIN_PX = 1024;
/** The widths at which more links move from "More" into the bar. At the last one "More" itself disappears. */
export const NAV_STEP_PX = [1280, 1480, 1536] as const;
/** "Post a job" is a bar link from here; under it the phone disclosure carries the row instead, so it is on screen once at every width. */
export const POST_JOB_BAR_MIN_PX = 900;
/**
 * The desktop "Ask Farah" button stays in the bar (owner decision), from here. It does NOT fit beside eight links at 1536: measured with the real components, the row wraps or squeezes until about 1632
 * (Pass chip and bell, macOS metrics; the Linux CI runner is about 18px wider), so the button starts at 1680. Nothing is lost between 1536 and 1680: Farah's docked panel is on screen at every width from 760.
 */
export const ASK_FARAH_BAR_MIN_PX = 1680;
/**
 * Between the seven-link step and the eight-link step the bar's own gap tightens from 22px to 16px. Measured: at 1480 with the Pass chip and the bell, seven links plus "More" at the normal gap are 24px
 * short and wrap four of them; at 16px the same row clears the right-hand group by 49px on macOS (about 31 on Linux). From 1536 the eighth link replaces "More" and the normal gap fits again (45px).
 */
export const NAV_TIGHT_GAP_BAND_PX = [1480, 1535] as const;

export function barLinksAt(widthPx: number): NavLink[] {
  return NAV_LINKS.filter((l) => widthPx >= NAV_BAR_MIN_PX && widthPx >= l.barFrom);
}

export function moreLinksAt(widthPx: number): NavLink[] {
  return NAV_LINKS.filter((l) => widthPx >= NAV_BAR_MIN_PX && widthPx < l.barFrom);
}

export function moreButtonShownAt(widthPx: number): boolean {
  return moreLinksAt(widthPx).length > 0;
}

const BAR_CLASS = {
  1024: "hidden min-[1024px]:flex",
  1280: "hidden min-[1280px]:flex",
  1480: "hidden min-[1480px]:flex",
  1536: "hidden min-[1536px]:flex",
} as const;

const MORE_ITEM_CLASS = {
  1024: "hidden",
  1280: "min-[1280px]:hidden",
  1480: "min-[1480px]:hidden",
  1536: "min-[1536px]:hidden",
} as const;

/** Hidden until the link's step, then a flex row item. */
export function barClassFor(link: NavLink): string {
  return BAR_CLASS[link.barFrom];
}

/** The same link's row inside "More": hidden from the step at which it appears in the bar. */
export function moreItemClassFor(link: NavLink): string {
  return MORE_ITEM_CLASS[link.barFrom];
}

/** The "More" control itself: on screen between the bar's first width and the last step. */
export const MORE_BUTTON_CLASS = "min-[1536px]:hidden";
