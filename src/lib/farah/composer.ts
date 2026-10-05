/**
 * The Farah panel's message box: what Enter does and what counts as a message. Pure and client-safe, so it is tested without a browser.
 *
 *   Enter            sends once on a device with a fine pointer (a mouse or trackpad: a desktop or laptop). A held key's repeats do not send again.
 *   Shift+Enter      inserts a line break (the browser's own default; nothing is sent).
 *   Enter during IME composition: never sends; it confirms the composition (Chinese, Japanese, Korean and similar input methods).
 *   Enter on a TOUCH device (coarse primary pointer: a phone or tablet): inserts a line break. The on-screen keyboard's return key is for writing; the send button is how a message is sent there.
 *     Why: Shift+Enter is awkward on a soft keyboard, and a return key that sends a half-written paragraph by accident is the surprise to avoid. A hardware keyboard on a tablet gets the touch behaviour too, which is the cautious side.
 *   An empty, whitespace-only or newline-only box sends nothing, and Enter on it adds no stray line break.
 *   While a reply is streaming nothing is sent.
 */
export type ComposerKeyAction = "send" | "block" | "default";

export interface ComposerKeyInput {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  isComposing: boolean;
  repeat: boolean;
  coarsePointer: boolean;
  text: string;
  pending: boolean;
}

/** "send": send now and stop the browser's own line break. "block": do nothing and swallow the key. "default": leave the key to the browser (a line break, or any other key). */
export function composerKeyAction(i: ComposerKeyInput): ComposerKeyAction {
  if (i.key !== "Enter") return "default";
  if (i.isComposing || i.shiftKey || i.ctrlKey || i.metaKey || i.altKey || i.coarsePointer) return "default";
  if (i.pending || i.repeat || prepareMessage(i.text) === null) return "block";
  return "send";
}

/** The slice of a React keyboard event the handler reads (so a test can supply a stand-in). */
export interface ComposerKeyEvent {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  repeat: boolean;
  nativeEvent: { isComposing: boolean };
  preventDefault: () => void;
}

export interface ComposerKeyDeps {
  /** The box's current text. */
  text: string;
  pending: boolean;
  /** Read at the moment of the key, not captured: a device can change (a keyboard attached to a tablet). */
  coarsePointer: () => boolean;
  onSend: () => void;
}

export function handleComposerKeyDown(e: ComposerKeyEvent, deps: ComposerKeyDeps): void {
  const action = composerKeyAction({
    key: e.key,
    shiftKey: e.shiftKey,
    ctrlKey: e.ctrlKey,
    metaKey: e.metaKey,
    altKey: e.altKey,
    isComposing: e.nativeEvent.isComposing,
    repeat: e.repeat,
    coarsePointer: e.key === "Enter" ? deps.coarsePointer() : false,
    text: deps.text,
    pending: deps.pending,
  });
  if (action === "default") return;
  e.preventDefault();
  if (action === "send") deps.onSend();
}

/** True on a device whose primary pointer is coarse (a finger): a phone or a tablet. Never throws, and is false where there is no window. */
export function isCoarsePointer(): boolean {
  try {
    return typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
  } catch {
    return false;
  }
}

/**
 * What is sent for the box's text: the ends trimmed, every line break inside the message kept exactly. null when there is nothing to send (empty, whitespace-only or newline-only).
 * The server trims the same way and counts a line break as one character (src/lib/text-limits.ts countForLimit).
 */
export function prepareMessage(text: string): string | null {
  const trimmed = text.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Whether focus should go back to the message box now. A box that is disabled while a reply streams drops the focus it had; when the reply finishes the box is enabled again and the person is mid-conversation, so it
 * takes the focus back, but only if focus is still nowhere in particular (the body, or the box itself), never over a link or field they chose, and never on a touch device (it would raise the on-screen keyboard).
 */
export function shouldRefocusAfterSend(i: { wasPending: boolean; pending: boolean; focusIsNeutral: boolean; coarsePointer: boolean }): boolean {
  return i.wasPending && !i.pending && i.focusIsNeutral && !i.coarsePointer;
}
