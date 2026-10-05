"use client";

import type { FormEvent, Ref } from "react";
import { TextArea } from "@/components/ui/text-area";
import { handleComposerKeyDown, isCoarsePointer, prepareMessage } from "@/lib/farah/composer";
import { MAX_MESSAGE_LENGTH } from "@/lib/farah/token-budget";

/** The character count appears only from here: 90% of the server's 2,000. Below it the box shows no counter (the limit still applies from the first character). */
export const COMPOSER_COUNTER_FROM = 1800;

/** The tallest the box grows before it scrolls: about six lines of the panel's text. */
const MAX_BOX_HEIGHT_PX = 144;

/**
 * The Farah panel's message box: the shared TextArea in its compact mode, with a send button beside it, inside the same bordered form the panel always had (the border and the rust focus colour are the form's).
 *
 * Enter sends (once) on a keyboard, Shift+Enter adds a line break, and on a touch device Enter adds a line break and the send button sends (see lib/farah/composer.ts for the rules and why). The box carries the server's
 * length limit (the same number the route enforces, counted the same way) and its counter. It is disabled while a reply streams. Everything about sending, charging and the free-message gate stays in the panel: this
 * component only reports "send this" (`onEnterSend`) or "the form was submitted" (`onSubmit`, the send button).
 */
export function FarahComposer({
  value,
  onChange,
  onSubmit,
  onEnterSend,
  pending,
  textareaRef,
}: {
  value: string;
  onChange: (text: string) => void;
  onSubmit: (e: FormEvent) => void;
  /** Enter was pressed on a box with something to send. */
  onEnterSend: () => void;
  pending: boolean;
  textareaRef?: Ref<HTMLTextAreaElement>;
}) {
  return (
    <form
      onSubmit={onSubmit}
      // send-381 — same shape as jd-demo-input.tsx: the box inside has no border of its own, so the visible focus change lands on this form's border via focus-within.
      className="mt-auto flex items-end gap-2 border-[1.5px] border-ink bg-card px-2.5 py-2 focus-within:border-rust"
    >
      <TextArea
        compact
        autoGrow
        maxHeight={MAX_BOX_HEIGHT_PX}
        label="Ask me anything…"
        hideLabel
        placeholder="Ask me anything…"
        name="farah-message"
        limit={MAX_MESSAGE_LENGTH}
        counterFrom={COMPOSER_COUNTER_FROM}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={pending}
        textareaRef={textareaRef}
        wrapperClassName="flex-1 min-w-0"
        onKeyDown={(e) => handleComposerKeyDown(e, { text: value, pending, coarsePointer: isCoarsePointer, onSend: onEnterSend })}
        /* 40px tall at one row, like the single-line field it replaces (a text field people hit on a phone was under half the minimum height once). */
        className="min-h-11 py-[13px] font-display text-[12.5px] italic leading-[1.4] text-ink placeholder:text-ink-soft disabled:opacity-60"
      />
      <button
        type="submit"
        disabled={pending || prepareMessage(value) === null}
        aria-label="Send to Farah"
        className="flex h-11 w-11 flex-shrink-0 items-center justify-center bg-ink text-paper disabled:opacity-50"
      >
        <svg width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="M3 10 L17 3 L11 17 L9 11 L3 10Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      </button>
    </form>
  );
}
