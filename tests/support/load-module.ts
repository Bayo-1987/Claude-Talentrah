/**
 * Import a module by specifier at runtime, typed by the caller.
 *
 * send-484 — used by the tests-first commit for modules that do not exist yet. A static
 * `import ... from "@/new/module"` is a TypeScript error, and CI runs `tsc --noEmit` BEFORE the
 * unit tests, so a missing module would stop the job at the typecheck and the unit tests would
 * never run — the failure would be "does not compile", not "the behaviour is missing". Going through
 * a string keeps the file compiling and makes each test fail at runtime, on its own assertion.
 *
 * Vitest resolves the `@/` alias for a variable specifier the same way it does for a literal one
 * (tests/support/load-module.test.ts proves it), so this does not change what is being tested.
 */
export function loadModule<T>(specifier: string): Promise<T> {
  return import(/* @vite-ignore */ specifier) as Promise<T>;
}
