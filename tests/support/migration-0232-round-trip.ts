/**
 * The pure pieces of the 0232 round trip (tests/supabase/migration-0232-round-trip.test.ts): the script it sends to the local stack and the reading of what comes back.
 * They live here, with no test-runner import, so the same script can be run against any Postgres and its output read the same way.
 */
import { roundTripScript, snapshotSql } from "./privilege-round-trip";

export const TABLES = ["organizations", "scholarships", "blog_posts", "mentorship_reviews"] as const;
export const MIGRATION = "supabase/migrations/0232_public_identifier_column_grants.sql";
export const ROLLBACK = "supabase/rollbacks/0232_public_identifier_column_grants.rollback.sql";
export const POLICY = "a user can join an organisation they created";

/** One extra line per snapshot: whether the helper exists, and which shape the insert rule has. Read in the same statement as the privileges. */
export const OBJECTS_SQL = `select 'O|function|' || (to_regprocedure('public.is_organization_creator(uuid)') is not null)::text
  || '|policy|' || coalesce((select case when pg_get_expr(p.polwithcheck, p.polrelid) like '%is_organization_creator%' then 'helper'
                                         when pg_get_expr(p.polwithcheck, p.polrelid) like '%created_by%' then 'subquery' else 'other' end
                               from pg_policy p where p.polrelid = 'public.organization_members'::regclass and p.polname = '${POLICY}'), 'missing');`;

/** The same script the 0224/0225 round trip builds, with the objects query read in each snapshot. */
export function script(rollbacks: string[], migrations: string[]): string {
  const snap = snapshotSql(TABLES);
  return roundTripScript(TABLES, { rollbacks, migrations }).split(snap).join(`${snap}\n${OBJECTS_SQL}`);
}

/** The "O|..." line of each of the three sections. */
export function objectLines(output: string): Record<string, string> {
  const out: Record<string, string> = {};
  let section = "";
  for (const raw of output.split("\n")) {
    const line = raw.trim();
    const m = /^@@SNAP (\w+)$/.exec(line);
    if (m) section = m[1];
    else if (section && line.startsWith("O|")) out[section] = line;
  }
  return out;
}

