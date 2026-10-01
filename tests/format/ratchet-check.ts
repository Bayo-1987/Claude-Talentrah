/**
 * The ratchet's rules, as a pure function so they can be tested with synthetic data (tests/format/ratchet-check.test.ts)
 * independently of what the real source tree contains.
 */
export interface RatchetInput {
  /** Real hits, one entry per call found (file only; the count per file is what matters). */
  hits: ReadonlyArray<{ file: string }>;
  allowlist: Readonly<Record<string, number>>;
  ceiling: number;
  initial: number;
}

export function checkRatchet({ hits, allowlist, ceiling, initial }: RatchetInput): string[] {
  const problems: string[] = [];
  const actual = new Map<string, number>();
  for (const h of hits) actual.set(h.file, (actual.get(h.file) ?? 0) + 1);

  for (const [file, n] of actual) {
    const allowed = allowlist[file] ?? 0;
    if (n > allowed) {
      problems.push(
        allowed === 0
          ? `${file}: ${n} direct date-formatting call(s) and the file is not allowlisted. Use src/lib/format/datetime.ts.`
          : `${file}: ${n} direct call(s), only ${allowed} allowed. The allowlist may not grow; use src/lib/format/datetime.ts.`,
      );
    } else if (n < allowed) {
      problems.push(`${file}: only ${n} direct call(s) left but ${allowed} allowed. Lower the allowlist (and the ceiling) to ${n}.`);
    }
  }
  for (const file of Object.keys(allowlist)) {
    if (!actual.has(file)) problems.push(`${file}: allowlisted but has no direct calls any more. Delete the entry (and lower the ceiling).`);
  }

  const total = Object.values(allowlist).reduce((a, b) => a + b, 0);
  if (total !== ceiling) problems.push(`The allowlist totals ${total} but ALLOWLIST_CEILING is ${ceiling}. Keep them equal.`);
  if (ceiling > initial) problems.push(`ALLOWLIST_CEILING (${ceiling}) is above the ${initial} violations the ratchet started with. It may only shrink.`);
  return problems;
}
