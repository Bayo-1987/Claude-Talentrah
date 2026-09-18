"use client";

import type { RefObject } from "react";
import { cn } from "@/lib/cn";

/** ≥40×40 hit target, same rule every other interactive element on this app follows. */
const TOOLBAR_BUTTON =
  "flex min-h-10 min-w-10 items-center justify-center border-[1.5px] border-ink px-2.5 font-body text-[13px] font-semibold text-ink hover:border-rust hover:text-rust";

/**
 * Wraps the textarea's current selection in `before`/`after` (bold/italic).
 * An empty selection still inserts both markers with the cursor left
 * between them, ready to type — the same behavior most editors give a
 * "Bold" button pressed with nothing selected.
 */
export function wrapSelection(el: HTMLTextAreaElement, before: string, after: string = before) {
  const { selectionStart, selectionEnd, value } = el;
  const selected = value.slice(selectionStart, selectionEnd);
  el.value = value.slice(0, selectionStart) + before + selected + after + value.slice(selectionEnd);
  const cursorStart = selectionStart + before.length;
  el.focus();
  el.setSelectionRange(cursorStart, cursorStart + selected.length);
}

/**
 * Applies `transform` to every line touched by the current selection, not
 * just the line the cursor happens to sit on — a multi-line selection turned
 * into a list should turn EVERY selected line into a list item.
 */
export function transformSelectedLines(el: HTMLTextAreaElement, transform: (lines: string[]) => string[]) {
  const { selectionStart, selectionEnd, value } = el;
  const lineStart = value.lastIndexOf("\n", selectionStart - 1) + 1;
  const nextBreak = value.indexOf("\n", selectionEnd);
  const lineEnd = nextBreak === -1 ? value.length : nextBreak;
  const selectedLines = value.slice(lineStart, lineEnd);
  const newSelectedLines = transform(selectedLines.split("\n")).join("\n");
  el.value = value.slice(0, lineStart) + newSelectedLines + value.slice(lineEnd);
  el.focus();
  el.setSelectionRange(lineStart, lineStart + newSelectedLines.length);
}

/**
 * send-346 — a markdown-formatting toolbar for any textarea whose value
 * eventually renders through renderJobDescriptionMarkdown/renderFarahMarkdown
 * (src/lib/farah/render-markdown.tsx). Originally built for the job
 * description field, extracted here so the assessment instructions field
 * (send-346 v2) gets the identical toolbar "for free," per that feature's
 * own spec, rather than a second hand-rolled copy. Bold, italic, and lists
 * are the whole subset — the renderer already parses this syntax today,
 * unchanged; the gap this closes is that nothing let someone PRODUCE it
 * without knowing to hand-type `**`/`-`/`1.`. No new dependency, no
 * rich-text editor, no contentEditable: the field stays a plain textarea
 * storing the same plain markdown-subset text the renderer already
 * expects, which is also exactly what keeps this safe — nothing new here
 * to sanitize.
 *
 * Deliberately excludes a "justify" control — alignment isn't a markdown
 * construct at all (it's an HTML/CSS idea with no plain-text encoding),
 * and the two ways to fake it — a bespoke non-standard syntax, or storing
 * HTML — either invent a format nothing else here reads or reopen the
 * injection surface this renderer's whole design (no `<a>`, no `<img>`, no
 * `dangerouslySetInnerHTML`) exists to avoid.
 *
 * `onFormat` is called after every change so a caller's own debounced
 * side effect (e.g. skill-extraction on the description field) still
 * fires — a toolbar click is a real edit to the field, the same as typing.
 */
export function MarkdownToolbar({
  textareaRef,
  onFormat,
}: {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onFormat: () => void;
}) {
  function run(mutate: (el: HTMLTextAreaElement) => void) {
    const el = textareaRef.current;
    if (!el) return;
    mutate(el);
    onFormat();
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        aria-label="Bold"
        title="Bold"
        onClick={() => run((el) => wrapSelection(el, "**"))}
        className={TOOLBAR_BUTTON}
      >
        B
      </button>
      <button
        type="button"
        aria-label="Italic"
        title="Italic"
        onClick={() => run((el) => wrapSelection(el, "*"))}
        className={cn(TOOLBAR_BUTTON, "italic")}
      >
        I
      </button>
      <button
        type="button"
        aria-label="Bulleted list"
        title="Bulleted list"
        onClick={() => run((el) => transformSelectedLines(el, (lines) => lines.map((l) => `- ${l}`)))}
        className={TOOLBAR_BUTTON}
      >
        •
      </button>
      <button
        type="button"
        aria-label="Numbered list"
        title="Numbered list"
        onClick={() =>
          run((el) => transformSelectedLines(el, (lines) => lines.map((l, i) => `${i + 1}. ${l}`)))
        }
        className={cn(TOOLBAR_BUTTON, "text-[12px]")}
      >
        1.
      </button>
    </div>
  );
}
