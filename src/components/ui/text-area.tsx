"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { countForLimit } from "@/lib/text-limits";
import { announcementFor, counterBucket, pasteVerdict, type CounterBucket } from "@/lib/text-counter";
import { WRITING_BOX_FRAME, WRITING_BOX_LABEL, WRITING_BOX_META } from "./writing-box";

/** A writing box shows at least this many rows, whatever a caller asks for. */
const MIN_ROWS = 4;

export interface TextAreaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "rows" | "maxLength"> {
  label: string;
  /** Keep the label for assistive technology but not on screen (a box whose heading is already on the page). */
  hideLabel?: boolean;
  help?: ReactNode;
  error?: string;
  minRows?: number;
  /** Grow with the text; the resize handle stays. */
  autoGrow?: boolean;
  /** A cap, counted the way the server counts (trimmed). Shows "N / LIMIT". */
  limit?: number;
  /** With `limit`: block nothing, and show `softNote` once over it (a value only partly used downstream). Default is a hard cap: the browser's maxLength. */
  soft?: boolean;
  softNote?: string;
  /** Monospace, for text that is markdown source. Changes the font and nothing else. */
  mono?: boolean;
  /** Classes for the wrapper (layout), never for the box itself: the box is the shared frame. */
  wrapperClassName?: string;
}

/**
 * The shared multi-line field. It looks like a writing box (4+ rows, resize handle, the same frame as the bold/italic editor), not a
 * one-line input stretched taller; it carries its own label, help, error and character counter; and it passes id, name, value and every
 * other attribute straight to the <textarea>, so swapping a raw one for this changes no payload and no e2e selector.
 */
export function TextArea({
  label,
  hideLabel,
  help,
  error,
  minRows = MIN_ROWS,
  autoGrow,
  limit,
  soft,
  softNote,
  mono,
  wrapperClassName,
  id,
  name,
  className,
  value,
  defaultValue,
  onChange,
  ...rest
}: TextAreaProps) {
  const reactId = useId();
  const fieldId = id ?? name ?? reactId;
  const helpId = `${fieldId}-help`;
  const errorId = `${fieldId}-error`;
  const countId = `${fieldId}-count`;
  const ref = useRef<HTMLTextAreaElement>(null);

  // Uncontrolled fields have no value prop to count, so the length is tracked here; a controlled field counts its own value.
  const [typed, setTyped] = useState(String(defaultValue ?? ""));
  const current = value !== undefined ? String(value) : typed;
  const length = countForLimit(current);
  const over = limit !== undefined ? Math.max(0, length - limit) : 0;

  // The count is spoken only when it crosses a threshold (see text-counter.ts), and never while an input method is composing.
  const composing = useRef(false);
  const bucket = useRef<CounterBucket>("quiet");
  const [announcement, setAnnouncement] = useState("");
  const [pasteMessage, setPasteMessage] = useState("");
  useEffect(() => {
    if (limit === undefined || composing.current) return;
    const said = announcementFor(length, limit, bucket.current);
    bucket.current = counterBucket(length, limit);
    if (said !== null) setAnnouncement(said);
  }, [length, limit]);

  // React 19 resets an uncontrolled field after a form action; the counter has to follow it back to the starting value.
  useEffect(() => {
    const form = ref.current?.form;
    if (!form || value !== undefined) return;
    const onReset = () => setTyped(String(defaultValue ?? ""));
    form.addEventListener("reset", onReset);
    return () => form.removeEventListener("reset", onReset);
  }, [defaultValue, value]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!autoGrow || !el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [autoGrow, current]);

  // A box that grows with its text starts as tall as its starting text, so growing later does not move the page.
  const startingLines = autoGrow ? String(defaultValue ?? value ?? "").split("\n").length : 0;
  const rows = Math.max(MIN_ROWS, minRows, startingLines);

  const describedBy = [help ? helpId : null, error ? errorId : null, limit !== undefined ? countId : null].filter(Boolean).join(" ");

  return (
    <div className={cn("flex flex-col gap-1.5", wrapperClassName)}>
      <label htmlFor={fieldId} className={cn(WRITING_BOX_LABEL, hideLabel && "sr-only")}>
        {label}
      </label>
      <textarea
        ref={ref}
        id={fieldId}
        name={name}
        rows={rows}
        value={value}
        defaultValue={defaultValue}
        maxLength={limit !== undefined && !soft ? limit : undefined}
        dir="auto"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        data-autogrow={autoGrow ? "true" : undefined}
        onCompositionStart={(e) => {
          composing.current = true;
          rest.onCompositionStart?.(e);
        }}
        onCompositionEnd={(e) => {
          composing.current = false;
          setTyped(e.currentTarget.value);
          rest.onCompositionEnd?.(e);
        }}
        onPaste={(e) => {
          rest.onPaste?.(e);
          if (e.defaultPrevented || limit === undefined || soft || composing.current) return;
          const el = e.currentTarget;
          const verdict = pasteVerdict(el.value, el.selectionStart, el.selectionEnd, e.clipboardData.getData("text"), limit);
          if (verdict.ok) {
            setPasteMessage("");
          } else {
            // Refused whole and said out loud, never cut to fit: half a paragraph that nobody asked for is worse than none.
            e.preventDefault();
            setPasteMessage(`That paste is ${verdict.over} over the limit, so nothing was added. Shorten it and paste again.`);
          }
        }}
        onChange={(e) => {
          setTyped(e.target.value);
          if (pasteMessage) setPasteMessage("");
          onChange?.(e);
        }}
        className={cn(WRITING_BOX_FRAME, "block w-full resize-y", mono && "font-mono text-[16px] sm:text-[14px]", error && "border-rust", className)}
        {...rest}
      />
      {help && (
        <p id={helpId} className={WRITING_BOX_META}>
          {help}
        </p>
      )}
      {limit !== undefined && (
        <p id={countId} className={cn(WRITING_BOX_META, over > 0 && "text-rust")}>
          {`${length} / ${limit}`}
          {over > 0 && !soft ? ` · ${over} over` : null}
          {over > 0 && soft && softNote ? ` · ${softNote}` : null}
          <span data-paste-message role="status" className="block text-rust empty:hidden">
            {pasteMessage}
          </span>
        </p>
      )}
      {limit !== undefined && (
        <span role="status" aria-live="polite" className="sr-only">
          {announcement}
        </span>
      )}
      {error && (
        <p id={errorId} className="text-[12.5px] text-rust">
          {error}
        </p>
      )}
    </div>
  );
}
