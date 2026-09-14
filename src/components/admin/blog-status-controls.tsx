"use client";

import { useActionState } from "react";
import { setPostStatusAction, deletePostAction, type BlogActionState } from "@/lib/admin/blog/actions";
import { buttonClasses } from "@/components/ui";

const initial: BlogActionState = { status: "idle" };

/**
 * Publish / unpublish, and delete.
 *
 * A client component rather than two bare `<form action={…}>` elements because
 * these actions return a result. A plain form would type-error on that, and
 * the fix of making them return void would throw the failure away — an
 * operator clicking Unpublish and seeing nothing happen, with the reason only
 * in a server log, is exactly the silent-failure pattern this codebase keeps
 * finding and removing.
 */
export function BlogStatusControls({ id, published }: { id: string; published: boolean }) {
  const [statusState, statusAction, statusPending] = useActionState(setPostStatusAction, initial);
  const [deleteState, deleteAction, deletePending] = useActionState(deletePostAction, initial);
  const message = statusState.message ?? deleteState.message;
  const failed = statusState.status === "error" || deleteState.status === "error";

  return (
    <div className="flex flex-col gap-4">
      {message && (
        <p
          className={
            failed
              ? "border-[1.5px] border-rust bg-rust-soft px-3.5 py-2.5 text-[13.5px] text-rust"
              : "border-[1.5px] border-green px-3.5 py-2.5 text-[13.5px] text-green"
          }
        >
          {message}
        </p>
      )}

      <form action={statusAction}>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="intent" value={published ? "unpublish" : "publish"} />
        <button
          type="submit"
          disabled={statusPending}
          className={buttonClasses(published ? "secondary" : "primary", "sm")}
        >
          {statusPending ? "Working…" : published ? "Unpublish" : "Publish"}
        </button>
      </form>

      <form action={deleteAction} className="border-t border-line pt-4">
        <input type="hidden" name="id" value={id} />
        <p className="mb-2 text-[13px] text-ink-soft">
          Deleting removes the post permanently. Unpublish instead if you may want it back — the
          audit log records either way.
        </p>
        <button
          type="submit"
          disabled={deletePending}
          className={buttonClasses("text", "sm") + " text-rust"}
        >
          {deletePending ? "Deleting…" : "Delete permanently"}
        </button>
      </form>
    </div>
  );
}
