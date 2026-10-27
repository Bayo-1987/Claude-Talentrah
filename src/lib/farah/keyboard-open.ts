/**
 * The soft-keyboard rule: the Farah launcher hides while the on-screen keyboard is open, so it cannot sit on top of what is being typed.
 *
 * DORMANT BY DESIGN (PR-1 of the mobile launcher plan): nothing imports this module yet, and it reads no window; the caller passes the numbers in.
 *
 * Based on the VISUAL viewport, because a phone's browser keeps the layout viewport as it was and shrinks only the visual one when the keyboard opens. "Open" means all of: the visual viewport
 * is at least KEYBOARD_MIN_SHRINK_PX shorter than the layout viewport; a text-entry field has focus (a shrink alone is a toolbar or a split view); and the page is not pinch-zoomed (zooming also
 * shrinks the visual viewport, and the launcher should stay then). Anything that is not a sane number answers "not open": better a launcher that stays than one that vanishes on bad data.
 * A browser toolbar sliding in or out moves the visual viewport by roughly 50 to 100px, well under the threshold.
 */

export const KEYBOARD_MIN_SHRINK_PX = 150;

/** A scale this close to 1 is rounding, not a pinch. */
const ZOOM_TOLERANCE = 1.01;

export interface KeyboardInput {
  /** window.innerHeight. */
  layoutHeight: number;
  /** window.visualViewport.height. */
  visualHeight: number;
  /** Whether the focused element is a text-entry field (see isTextEntryElement). */
  textFieldFocused: boolean;
  /** window.visualViewport.scale, when known. */
  scale?: number;
}

const sane = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

export function keyboardIsOpen(input: KeyboardInput): boolean {
  if (!input || typeof input !== "object") return false;
  if (!sane(input.layoutHeight) || !sane(input.visualHeight)) return false;
  if (input.scale !== undefined && (typeof input.scale !== "number" || !Number.isFinite(input.scale) || input.scale > ZOOM_TOLERANCE)) return false;
  return input.textFieldFocused === true && input.layoutHeight - input.visualHeight >= KEYBOARD_MIN_SHRINK_PX;
}

/** The input types that bring up a text keyboard. */
const TEXT_ENTRY_INPUT_TYPES: ReadonlySet<string> = new Set(["", "text", "search", "email", "tel", "url", "password", "number"]);

/** The parts of an element the rule reads (an HTMLElement satisfies it; the tests pass plain objects). */
export interface TextEntryCandidate {
  tagName?: string;
  type?: string;
  isContentEditable?: boolean;
  readOnly?: boolean;
  disabled?: boolean;
}

/** Whether focusing this element opens a text keyboard: a textarea, a text-like input, or a contenteditable; not read-only, not disabled. Never throws. */
export function isTextEntryElement(element: unknown): boolean {
  if (element === null || typeof element !== "object") return false;
  const el = element as TextEntryCandidate;
  if (el.disabled === true || el.readOnly === true) return false;
  const tag = typeof el.tagName === "string" ? el.tagName.toUpperCase() : "";
  if (tag === "TEXTAREA") return true;
  if (tag === "INPUT") return TEXT_ENTRY_INPUT_TYPES.has(typeof el.type === "string" ? el.type.toLowerCase() : "");
  return el.isContentEditable === true;
}
