/**
 * Which files in a file input has nothing handled yet? (issue #591)
 *
 * A file input in a client component is server-rendered markup. A file chosen before the page hydrates fires
 * `change` into a page React is not attached to, and React does not replay it, so the component has to look at the
 * input itself when it mounts. Pure so every input's rule is unit-testable without a DOM.
 *
 * `handled` is the set of File objects the change handler already took (so the catch-up never doubles up, also under
 * React strict-mode double mounts). `multiple: false` mirrors an input that takes one file: only the first is returned,
 * exactly as its change handler would have taken only `files[0]`.
 */
export function filesToCatchUp(
  files: ArrayLike<File> | null | undefined,
  handled: ReadonlySet<File>,
  { multiple }: { multiple: boolean },
): File[] {
  const fresh = Array.from(files ?? []).filter((f) => !handled.has(f));
  return multiple ? fresh : fresh.slice(0, 1);
}
