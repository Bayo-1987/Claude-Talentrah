"use client";

import { useEffect, useRef, type ChangeEvent } from "react";
import { filesToCatchUp } from "@/lib/forms/catch-up-file";

/**
 * One fix for the pre-hydration file race, for every file input (issue #591).
 *
 * A file chosen before the page hydrates fires `change` into a page React has not attached to, and React does not
 * replay it. After hydration the page is interactive, the file is still in the input, and nothing happens. Measured on
 * a production build with hydration held back (e2e/file-input-pre-hydration.spec.ts): the label-wrapped inputs (a click
 * on the label opens the native chooser with no JS) lose the file on an ordinary click, and the JS-button inputs lose it
 * to a keyboard or programmatic pick.
 *
 * The hook owns the input's `ref` and `onChange` and, on mount, hands any file already in the input to the same
 * `onFiles` the change handler uses. It does not queue events and does not disable the input, so there is no disabled
 * state to announce and focus is unaffected.
 *
 *   `multiple`    whether the input takes several files (first only when false, as its handler would);
 *   `resetAfter`  clear `input.value` once the files are taken, so the same file can be chosen again. Inputs that keep
 *                 their value until a later step (the banner crop dialog) leave it false and clear it themselves.
 */
export function useCatchUpFile({
  onFiles,
  multiple,
  resetAfter = false,
}: {
  onFiles: (files: File[]) => void;
  multiple: boolean;
  resetAfter?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const handled = useRef<Set<File>>(new Set());

  function take(files: File[]) {
    for (const f of files) handled.current.add(f);
    onFiles(files);
  }

  function onChange(e: ChangeEvent<HTMLInputElement>) {
    // Copied out first: `files` is a live view that clearing `value` empties in place.
    const picked = Array.from(e.target.files ?? []);
    if (resetAfter) e.target.value = "";
    if (picked.length === 0) return;
    take(multiple ? picked : picked.slice(0, 1));
  }

  useEffect(() => {
    const input = inputRef.current;
    const caught = filesToCatchUp(input?.files, handled.current, { multiple });
    if (caught.length === 0) return;
    if (resetAfter && input) input.value = "";
    take(caught);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only: a one-time catch-up, not a sync
  }, []);

  return { inputRef, onChange };
}
