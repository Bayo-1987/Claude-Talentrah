/**
 * What a character counter says out loud, and what a paste is allowed to do (S1-56).
 *
 * A screen reader must not hear the count on every keystroke, so the count is announced only when the length crosses a threshold
 * (80% of the limit, 90%, the limit itself, over it). And a paste that would not fit is refused with a visible message, never cut off
 * silently: a person who pastes a long paragraph must be told it was not added, not find half of it missing.
 */
export type CounterBucket = "quiet" | "eighty" | "ninety" | "full" | "over";

export function counterBucket(length: number, limit: number): CounterBucket {
  if (length > limit) return "over";
  if (length === limit) return "full";
  if (length >= limit * 0.9) return "ninety";
  if (length >= limit * 0.8) return "eighty";
  return "quiet";
}

/**
 * The sentence to announce now, or null when nothing should be said because the bucket has not changed. An empty string clears the
 * announcement (the person deleted back below the threshold).
 */
export function announcementFor(length: number, limit: number, previous: CounterBucket): string | null {
  const bucket = counterBucket(length, limit);
  if (bucket === previous) return null;
  switch (bucket) {
    case "quiet":
      return "";
    case "eighty":
    case "ninety":
      return `${limit - length} left before the limit of ${limit}.`;
    case "full":
      return `You have reached the limit of ${limit}.`;
    case "over":
      return `${length - limit} over the limit of ${limit}.`;
  }
}

/**
 * Whether pasting `pasted` over the selection [start, end) of `current` fits a box capped at `limit`. A line break counts as one
 * character, as the box and the server count it. A value that was already over the limit may be edited down but never made longer.
 */
export function pasteVerdict(current: string, start: number, end: number, pasted: string, limit: number): { ok: true } | { ok: false; over: number } {
  const next = current.slice(0, start) + pasted.replace(/\r\n/g, "\n") + current.slice(end);
  const allowed = Math.max(limit, current.length);
  return next.length <= allowed ? { ok: true } : { ok: false, over: next.length - allowed };
}

/**
 * Whether dropping `dropped` into a box capped at `limit` fits. The browser decides where a drop lands (the caret is not under our control),
 * so this is the cautious reading: it adds the dropped text to the whole value, except when the dragged text IS the current selection,
 * which is a move inside the box and changes nothing in length.
 */
export function dropVerdict(current: string, selectionStart: number, selectionEnd: number, dropped: string, limit: number): { ok: true } | { ok: false; over: number } {
  const text = dropped.replace(/\r\n/g, "\n");
  if (selectionEnd > selectionStart && text === current.slice(selectionStart, selectionEnd)) return { ok: true };
  const allowed = Math.max(limit, current.length);
  const next = current.length + text.length;
  return next <= allowed ? { ok: true } : { ok: false, over: next - allowed };
}
