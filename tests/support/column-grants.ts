/**
 * The comparison for a table whose columns the API roles read BY NAME (job_postings, 0218): which columns have no grant that should have one,
 * and which restricted columns turned out to be readable. Pure, so its cases run without a database; the database test feeds it real data.
 */
export interface ColumnGrantInput {
  /** Every column of the table (a service-role read returns all of them). */
  columns: string[];
  /** The columns the API roles could NOT read when asked for singly. */
  unreadable: string[];
  /** The columns that must be unreadable, on purpose. */
  restricted: readonly string[];
}

export interface ColumnGrantProblems {
  /** Unreadable but not on the restricted list: a column added without its grant. */
  ungranted: string[];
  /** On the restricted list but readable (or not a column at all): the restriction no longer holds. */
  restrictedButReadable: string[];
}

export function compareColumnGrants({ columns, unreadable, restricted }: ColumnGrantInput): ColumnGrantProblems {
  const ungranted = unreadable.filter((c) => !restricted.includes(c)).sort();
  const restrictedButReadable = restricted.filter((c) => !columns.includes(c) || !unreadable.includes(c)).slice().sort();
  return { ungranted, restrictedButReadable };
}
