/**
 * The four reasons, and what each one is FOR.
 *
 * Kept short and non-overlapping on purpose: a reporting form with twelve
 * options collects twelve unusable buckets, and the operator queue groups by
 * this value. The labels are written for the person clicking, not for the
 * column.
 *
 * ITS OWN FILE, WITHOUT ZOD, because the report menu on the public job page is a client component and
 * imports this list. When the list lived beside the zod schema, the browser downloaded the whole zod
 * library (all language packs, about 94 KB gzipped) to read four labels. Keep this file free of imports;
 * tests/perf/client-components-zod-free.test.ts fails if a client component reaches zod again.
 */
export const REPORT_REASONS = [
  { value: "scam", label: "It looks like a scam" },
  { value: "closed_but_listed", label: "The job is no longer open" },
  { value: "discriminatory", label: "The posting is discriminatory" },
  { value: "other", label: "Something else" },
] as const;

export const REPORT_REASON_VALUES = REPORT_REASONS.map((r) => r.value) as unknown as [
  "scam",
  "closed_but_listed",
  "discriminatory",
  "other",
];
