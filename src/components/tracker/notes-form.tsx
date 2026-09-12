"use client";

import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { formatTrackerDate } from "@/lib/tracker/format-date";

/**
 * A note on a tracked application, in three states.
 *
 * WHAT THIS REPLACES. One always-open textarea with a Save link beside it, on
 * every card, whether or not there was anything in it. Three things were wrong
 * with that and only the first is cosmetic:
 *
 *   - an empty compose box on every card reads as a demand for input on a page
 *     that is mostly for reading;
 *   - a saved note sat inside an input, so content looked like a form field
 *     and there was nothing that read as "this is written down";
 *   - there was NO WAY TO CANCEL. Once you typed over a note, the original was
 *     gone from the screen and the only way back was remembering it.
 *
 * So: empty is a quiet link, a saved note is quoted text, and the box only
 * exists while you are actually editing.
 *
 * WHY LOCAL STATE AND NOT A ROUTE. The three states are view modes, not pages
 * — nothing about them belongs in the URL, and putting them there would make
 * the browser's back button undo an edit-in-progress on one card out of twenty.
 *
 * WHY A FETCH TO A ROUTE HANDLER AND NOT A SERVER ACTION. This used to submit
 * via `<form action={formAction}>` bound to a `"use server"` action through
 * `useActionState`. That dispatch has no way for application code to catch a
 * TRANSPORT failure — only errors the action itself throws after it runs. A
 * dropped connection surfaces inside Next's own action-dispatch machinery as
 * an uncaught rejection, which the App Router turns into its default "This
 * page couldn't load" interstitial, unmounting this component and the draft
 * with it — confirmed, including that wrapping the old `formAction()` call in
 * a `try/catch` does not stop it, because the rejection happens below
 * anything exposed to the caller. A plain `fetch()` against a Route Handler
 * has none of that in the way: a dead network is an ordinary rejected promise
 * this component already awaits in its own `try/catch`.
 */

/** Save keeps this on screen for a moment, then it goes. */
const SAVED_BANNER_MS = 3000;

type Mode = "empty" | "read" | "editing";

interface SaveResult {
  status: "success" | "error";
  error: string | null;
  notes: string | null;
  updatedAt: string | null;
}

export interface NotesFormProps {
  applicationId: string;
  notes: string | null;
  /** `applications.updated_at`, for the "Edited …" line. */
  updatedAt: string | null;
}

export function NotesForm({ applicationId, notes, updatedAt }: NotesFormProps) {
  const router = useRouter();
  const [result, setResult] = useState<SaveResult | null>(null);
  const [pending, startTransition] = useTransition();

  /*
   * The server's copy wins once there is one. `notes` is the prop from the
   * last server render; `result.notes` is what the database returned from
   * this save. `router.refresh()` re-fetches the page behind us, but not
   * before the banner and the read view need to show the new text — so until
   * that arrives, the save's own answer is the truth.
   */
  const savedNotes = result?.status === "success" ? result.notes : notes;
  const savedAt = result?.status === "success" ? result.updatedAt : updatedAt;

  const [mode, setMode] = useState<Mode>(notes ? "read" : "empty");
  const [showSaved, setShowSaved] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // The banner's lifetime is a timer, which is an external system — the one
  // thing here that genuinely belongs in an effect. setState happens in the
  // callback, not synchronously in the body.
  useEffect(() => {
    if (!showSaved) return;
    const timer = setTimeout(() => setShowSaved(false), SAVED_BANNER_MS);
    return () => clearTimeout(timer);
  }, [showSaved]);

  /**
   * Grow the box to fit its content.
   *
   * `rows={1}` with `resize-y` was the old behaviour: a three-line note opened
   * as one visible line and stayed that way unless the user thought to drag
   * the corner. Height is reset to `auto` first because scrollHeight only ever
   * grows otherwise — without it, deleting lines leaves the box tall.
   */
  function fit(el: HTMLTextAreaElement | null) {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }

  function startEditing() {
    setShowSaved(false);
    setMode("editing");
  }

  function cancelEditing() {
    // Back to whatever was actually saved — not to whatever is in the box.
    setMode(savedNotes ? "read" : "empty");
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const value = String(new FormData(e.currentTarget).get("notes") ?? "");

    startTransition(async () => {
      try {
        const res = await fetch("/api/tracker/notes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ applicationId, notes: value }),
        });
        const data = (await res.json().catch(() => null)) as
          | { notes: string | null; updatedAt: string }
          | { error: string }
          | null;

        if (!res.ok || !data || "error" in data) {
          setResult({
            status: "error",
            error: (data && "error" in data && data.error) || "Couldn't save that note. Try again.",
            notes: null,
            updatedAt: null,
          });
          setMode("editing");
          // A 404 means the route handler's own zero-rows branch already
          // revalidated the tracker path server-side (the entry is gone) — a
          // plain database error (500) hasn't touched the cache, so only this
          // case needs the client to go fetch the now-stale page.
          if (res.status === 404) router.refresh();
          return;
        }

        setResult({ status: "success", error: null, notes: data.notes, updatedAt: data.updatedAt });
        setMode(data.notes ? "read" : "empty");
        setShowSaved(true);
        router.refresh();
      } catch {
        // A transport failure — the request never reached the server at all.
        // An ordinary caught rejection here, unlike a Server Action dispatch:
        // the draft in the (uncontrolled) textarea is untouched because this
        // component never unmounts and never rewrites its value.
        setResult({
          status: "error",
          error: "Couldn't save that note. Your text is still here — try again.",
          notes: null,
          updatedAt: null,
        });
        setMode("editing");
      }
    });
  }

  // Size and focus the box when the editor opens, not on every render.
  useEffect(() => {
    if (mode !== "editing") return;
    const el = textareaRef.current;
    if (!el) return;
    fit(el);
    el.focus();
    // Caret at the end rather than the start: this is nearly always an append.
    el.setSelectionRange(el.value.length, el.value.length);
  }, [mode]);

  return (
    <div className="border-t border-line pt-3">
      {showSaved && (
        <p
          data-testid="notes-saved-banner"
          className="mb-2.5 flex items-center gap-1.5 border-[1.5px] border-green px-3 py-1.5 text-[12.5px] text-green"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M3 8.5L6.5 12L13 4.5"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Saved.
        </p>
      )}

      {result?.status === "error" && mode === "editing" && (
        <p
          data-testid="notes-error-banner"
          className="mb-2.5 border-[1.5px] border-rust bg-rust-soft px-3 py-1.5 text-[12.5px] text-rust"
        >
          {result.error}
        </p>
      )}

      {mode === "empty" && (
        /*
         * The same quiet affordance as the page's "+ Add a job you applied to
         * outside Talentrah" summary — a link, no box. Rust rather than that
         * one's ink-soft, because the mock specifies rust; if the two should
         * match exactly, this is the line to change.
         */
        <button
          type="button"
          onClick={startEditing}
          data-testid="notes-add"
          className="inline-flex min-h-10 items-center gap-1.5 font-body text-[12.5px] font-semibold text-rust underline underline-offset-2"
        >
          + Add a note
        </button>
      )}

      {mode === "read" && savedNotes && (
        <div data-testid="notes-read" className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {/*
              Quoted italic text, not an input. `whitespace-pre-line` is what
              makes a multi-line note read as the lines the author typed rather
              than as one run-on paragraph.
            */}
            <p className="font-body text-[13px] leading-relaxed whitespace-pre-line text-ink italic">
              &ldquo;{savedNotes}&rdquo;
            </p>
            {savedAt && (
              <p className="mt-0.5 text-[11px] text-ink-soft">Edited {formatTrackerDate(savedAt)}</p>
            )}
          </div>
          <button
            type="button"
            onClick={startEditing}
            data-testid="notes-edit"
            className="inline-flex min-h-10 min-w-10 flex-shrink-0 items-center justify-center font-body text-[12px] font-semibold text-ink-soft underline underline-offset-2 hover:text-rust"
          >
            Edit
          </button>
        </div>
      )}

      {mode === "editing" && (
        <form onSubmit={handleSubmit} className="flex items-start gap-2.5">
          <textarea
            ref={textareaRef}
            name="notes"
            /*
             * `defaultValue`, and keyed on the saved text. An uncontrolled box
             * is what lets a failed save keep the user's typing — React does
             * not re-render its value out from under them. The key remounts it
             * when the underlying note changes, so Cancel-then-Edit shows the
             * saved text again rather than the abandoned draft.
             */
            key={savedNotes ?? ""}
            defaultValue={savedNotes ?? ""}
            onInput={(e) => fit(e.currentTarget)}
            placeholder="Interview dates, contacts, next steps…"
            rows={2}
            data-testid="notes-textarea"
            className="min-h-[60px] w-full flex-1 resize-y overflow-hidden border-[1.5px] border-rust bg-card px-3 py-2 font-body text-[13px] text-ink outline-none"
          />
          <div className="flex flex-shrink-0 flex-col gap-1.5">
            <button
              type="submit"
              disabled={pending}
              data-testid="notes-save"
              className="inline-flex min-h-10 items-center justify-center bg-ink px-3 font-body text-[12px] font-semibold text-paper hover:bg-rust disabled:opacity-60"
            >
              {pending ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={cancelEditing}
              data-testid="notes-cancel"
              className="inline-flex min-h-10 items-center justify-center font-body text-[11.5px] text-ink-soft underline underline-offset-2 hover:text-rust"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
