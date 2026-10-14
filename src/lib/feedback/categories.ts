/**
 * The three feedback buckets, and their labels, in a module with no zod. Moved out of schemas.ts (which re-exports every name here, so no importer changes)
 * because the feedback form is a client component and a client component must not reach zod (tests/perf/client-components-zod-free.test.ts).
 *
 * Value and label are separate because the value is a database enum and the
 * label is a sentence. "bug" is the right column value and the wrong thing to
 * show someone — a person reporting that resume export produced a blank PDF
 * should not have to decide whether that counts as a "bug".
 */
export const FEEDBACK_CATEGORIES = [
  { value: "bug", label: "Something's broken" },
  { value: "idea", label: "An idea or a request" },
  { value: "other", label: "Something else" },
] as const;

export const FEEDBACK_CATEGORY_VALUES = FEEDBACK_CATEGORIES.map((c) => c.value) as unknown as [
  "bug",
  "idea",
  "other",
];
