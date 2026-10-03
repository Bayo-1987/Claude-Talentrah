/**
 * Classify the outcome of `select <column> ... limit 1` against PostgREST, to answer "does this column exist yet?" for a test that must start running by
 * itself once a migration lands. Only SQLSTATE 42703 (undefined_column), compared EXACTLY, means missing. A clean result means it exists. Anything else
 * (a network failure, a permission error, an undefined table, a PostgREST error code) is inconclusive: the caller must FAIL on it, not skip, because a
 * probe that reads every failure as "missing" would skip the test silently for good.
 */
export type ColumnProbe = "exists" | "missing" | "inconclusive";

export function classifyColumnProbe(error: { code?: string | null; message?: string } | null): ColumnProbe {
  if (error === null) return "exists";
  return error.code === "42703" ? "missing" : "inconclusive";
}
