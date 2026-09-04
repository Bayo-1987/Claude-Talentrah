"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { deleteResumeAction, renameResumeAction } from "@/lib/resume-builder/actions";
import {
  BASE_RESUME_UNDELETABLE_REASON,
  initialDeleteResumeState,
  initialRenameResumeState,
  type DeleteResumeState,
} from "@/lib/resume-builder/list-state";
import { MAX_RESUME_TITLE_LENGTH } from "@/lib/resume-builder/resume-title";

/**
 * One row in "Your resumes", in three modes: reading, renaming, confirming a
 * delete.
 *
 * WHY INLINE AND NOT A MODAL. The list is the only place these controls make
 * sense, the confirm needs to name the row it belongs to, and a dialog would
 * have to re-state which resume it is talking about in order to be safe. An
 * inline confirm sits under the title it refers to, so the name is right
 * there and cannot drift out of sync with the row. It also costs no overlay,
 * no focus trap and no extra markup on a page the target market loads over
 * expensive mobile data.
 *
 * THE CONFIRM NAMES THE RESUME. "Are you sure?" is not a confirmation — it
 * asks the user to remember which of eight rows they clicked. Deleting is
 * irreversible for the resume itself (the applications it was sent with keep
 * a snapshot; the editable resume does not come back), so the sentence says
 * the title and says it cannot be undone.
 *
 * THE BASE RESUME KEEPS A VISIBLE, DISABLED DELETE — not a missing one. An
 * absent control reads as a rendering bug or an unfinished feature; a
 * disabled one with the reason beside it answers the question the user
 * actually has. `aria-describedby` ties the two together for a screen reader
 * rather than leaving the reason as unassociated text.
 */

type Mode = "read" | "renaming" | "confirming-delete";

export interface ResumeListRowProps {
  id: string;
  title: string;
  isBase: boolean;
  updatedAt: string;
}

export function ResumeListRow({ id, title, isBase, updatedAt }: ResumeListRowProps) {
  const [renameState, renameAction, renamePending] = useActionState(
    renameResumeAction.bind(null, id),
    initialRenameResumeState,
  );
  const [mode, setMode] = useState<Mode>("read");
  const [handledRename, setHandledRename] = useState(renameState);
  const inputRef = useRef<HTMLInputElement>(null);

  /*
   * The server's copy wins once there is one — revalidatePath refreshes the
   * page behind us, but the row has to leave the editor before that arrives.
   * Same pattern, and the same reasoning, as NotesForm.
   */
  const savedTitle = renameState.status === "success" ? (renameState.title ?? title) : title;

  // Reacting to the result during render rather than in an effect: an effect
  // paints the editor once more with the save already finished. See NotesForm
  // for the long version. Comparing the state OBJECT, not its status, so two
  // consecutive failures are two distinct events.
  if (renameState !== handledRename) {
    setHandledRename(renameState);
    if (renameState.status === "success") setMode("read");
    else if (renameState.status === "error") setMode("renaming");
  }

  useEffect(() => {
    if (mode !== "renaming") return;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [mode]);

  /*
   * Delete is a transition, not a <form action>. It takes no user input — the
   * confirm button IS the input — and useActionState would mean a hidden form
   * whose only field is the id already closed over here.
   */
  const [deleting, startDelete] = useTransition();
  const [deleteState, setDeleteState] = useState<DeleteResumeState>(initialDeleteResumeState);

  function confirmDelete() {
    startDelete(async () => {
      const result = await deleteResumeAction(id);
      setDeleteState(result);
      // On success the row disappears with the revalidate, so there is nothing
      // to return to. On failure the message has to be readable, which means
      // leaving the confirm open under it.
      if (result.status === "success") setMode("read");
    });
  }

  const reasonId = `resume-${id}-nodelete`;

  return (
    <div className="flex flex-col gap-2 py-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          {mode === "renaming" ? (
            <form action={renameAction} className="flex flex-wrap items-center gap-2">
              <label htmlFor={`resume-${id}-title`} className="sr-only">
                Resume name
              </label>
              <input
                ref={inputRef}
                id={`resume-${id}-title`}
                name="title"
                /*
                 * Uncontrolled and keyed on the saved title: a failed rename
                 * keeps what was typed, while Cancel-then-Rename shows the
                 * stored name again rather than the abandoned draft.
                 */
                key={savedTitle}
                defaultValue={savedTitle}
                maxLength={MAX_RESUME_TITLE_LENGTH}
                data-testid="resume-rename-input"
                className="min-h-11 w-full max-w-[320px] border-[1.5px] border-rust bg-card px-3 py-2 font-body text-[14.5px] text-ink outline-none"
              />
              <button
                type="submit"
                disabled={renamePending}
                data-testid="resume-rename-save"
                className="inline-flex min-h-10 items-center justify-center bg-ink px-3.5 font-body text-[12.5px] font-semibold text-paper hover:bg-rust disabled:opacity-60"
              >
                {renamePending ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                onClick={() => setMode("read")}
                data-testid="resume-rename-cancel"
                className="inline-flex min-h-10 items-center justify-center font-body text-[12px] text-ink-soft underline underline-offset-2 hover:text-rust"
              >
                Cancel
              </button>
            </form>
          ) : (
            <>
              <span className="font-body text-[14.5px] font-semibold">
                {savedTitle}
                {isBase && (
                  <span className="ml-2 text-[12px] font-normal text-ink-soft">
                    (from your uploaded resume)
                  </span>
                )}
              </span>
              <div className="text-[12.5px] text-ink-soft">
                Updated {new Date(updatedAt).toLocaleDateString()}
              </div>
            </>
          )}
        </div>

        {mode === "read" && (
          <div className="flex items-center gap-4">
            {/*
              A single "Edit" link, not "Edit" + "Preview" — the editor
              carries its own live preview and Download PDF button inline
              (Stage 3.1), so the two links pointed at the same content by two
              different routes. The separate /resume-builder/preview page is
              retired.
            */}
            <Link
              href={`/resume-builder/edit?resumeId=${id}`}
              className="flex min-h-10 items-center text-[13px] font-semibold underline underline-offset-2"
            >
              Edit
            </Link>
            <button
              type="button"
              onClick={() => setMode("renaming")}
              data-testid="resume-rename"
              className="inline-flex min-h-10 items-center font-body text-[13px] font-semibold text-ink-soft underline underline-offset-2 hover:text-rust"
            >
              Rename
            </button>
            <button
              type="button"
              disabled={isBase}
              aria-describedby={isBase ? reasonId : undefined}
              onClick={() => {
                setDeleteState(initialDeleteResumeState);
                setMode("confirming-delete");
              }}
              data-testid="resume-delete"
              className="inline-flex min-h-10 items-center font-body text-[13px] font-semibold text-ink-soft underline underline-offset-2 hover:text-rust disabled:cursor-not-allowed disabled:no-underline disabled:opacity-50 disabled:hover:text-ink-soft"
            >
              Delete
            </button>
          </div>
        )}
      </div>

      {isBase && mode === "read" && (
        <p id={reasonId} data-testid="resume-delete-reason" className="text-[12px] italic text-ink-soft">
          {BASE_RESUME_UNDELETABLE_REASON}
        </p>
      )}

      {renameState.status === "error" && mode === "renaming" && (
        <p
          data-testid="resume-rename-error"
          className="border-[1.5px] border-rust bg-rust-soft px-3 py-1.5 text-[12.5px] text-rust"
        >
          {renameState.error}
        </p>
      )}

      {mode === "confirming-delete" && (
        <div
          data-testid="resume-delete-confirm"
          className="flex flex-wrap items-center gap-x-3 gap-y-2 border-[1.5px] border-ink bg-card px-3.5 py-3"
        >
          <p className="font-body text-[13px] text-ink">
            Delete &ldquo;{savedTitle}&rdquo;? This can&rsquo;t be undone.
          </p>
          <button
            type="button"
            onClick={confirmDelete}
            disabled={deleting}
            data-testid="resume-delete-confirm-yes"
            className="inline-flex min-h-10 items-center justify-center bg-ink px-3.5 font-body text-[12.5px] font-semibold text-paper hover:bg-rust disabled:opacity-60"
          >
            {deleting ? "Deleting…" : "Delete resume"}
          </button>
          <button
            type="button"
            onClick={() => setMode("read")}
            data-testid="resume-delete-cancel"
            className="inline-flex min-h-10 items-center justify-center font-body text-[12px] text-ink-soft underline underline-offset-2 hover:text-rust"
          >
            Keep it
          </button>
        </div>
      )}

      {deleteState.status === "error" && (
        <p
          data-testid="resume-delete-error"
          className="border-[1.5px] border-rust bg-rust-soft px-3 py-1.5 text-[12.5px] text-rust"
        >
          {deleteState.error}
        </p>
      )}
    </div>
  );
}
