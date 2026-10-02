/**
 * Is there a file in the picker's input that nothing has handled yet? (issue #591)
 *
 * The input is server-rendered markup. A file chosen before the page hydrates fires `change` into a page React is
 * not attached to, and React does not replay it, so the picker must look at the input itself when it mounts. Pure
 * so the decision is unit-testable without a DOM (tests/employer/banner-pick-catch-up.test.ts).
 *
 * Returns the first file, unless it is the very one the change handler already took (`alreadyHandled`), which
 * keeps the on-mount check from doubling up when the handler did run (and under React strict-mode double mounts).
 */
export function fileToCatchUp(files: ArrayLike<File> | null | undefined, alreadyHandled: File | null): File | null {
  const first = files?.[0] ?? null;
  return first && first !== alreadyHandled ? first : null;
}
