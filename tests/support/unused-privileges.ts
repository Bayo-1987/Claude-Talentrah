/**
 * Pure functions over the rows public.table_privilege_snapshot() returns (0227), so the rule can be checked WITHOUT a database
 * (tests/rls/unused-privileges-logic.test.ts plants grants and proves each is reported) and is applied to the real rows by the database-backed tests.
 */
export type SnapshotRow = { source: string; object_name: string; grantee: string; privilege_type: string };

/** Never used by the app (the Data API issues SELECT, INSERT, UPDATE and DELETE only) and not limited by row-level security. */
export const UNUSED_PRIVILEGES = ["TRUNCATE", "REFERENCES", "TRIGGER", "MAINTAIN"] as const;
/** The write privileges anon must not hold: nothing signed-out writes through the anon role. */
export const ANON_WRITE_PRIVILEGES = ["INSERT", "UPDATE", "DELETE"] as const;
/** The only default-privilege row that matters to the migrations: tables created by the postgres role in schema public. */
export const POSTGRES_PUBLIC_DEFAULTS = "role postgres, schema public";
/** Callable only by the service role (production already has it so; 0227 brings a repo-built database in line). */
export const SERVICE_ONLY_FUNCTIONS = ["count_rewarded_referrals_last_30d(", "check_and_activate_referral("] as const;

const reachesAnonOrAuthenticated = (g: string) => g === "anon" || g === "authenticated" || g === "public";
const label = (r: SnapshotRow) => `${r.source} ${r.object_name}: ${r.grantee} ${r.privilege_type}`;

/** TRUNCATE, REFERENCES, TRIGGER or MAINTAIN held by anon, authenticated or PUBLIC on a public table, at column level, or in the postgres role's default privileges. */
export function unusedPrivilegeFindings(rows: SnapshotRow[]): string[] {
  return rows
    .filter((r) => (UNUSED_PRIVILEGES as readonly string[]).includes(r.privilege_type) && reachesAnonOrAuthenticated(r.grantee))
    .filter((r) => r.source === "table" || r.source === "column" || (r.source === "default" && r.object_name === POSTGRES_PUBLIC_DEFAULTS))
    .map(label);
}

/** EXECUTE on a service-only function held by anon, authenticated or PUBLIC. */
export function serviceOnlyFunctionFindings(rows: SnapshotRow[]): string[] {
  return rows
    .filter((r) => r.source === "function" && r.privilege_type === "EXECUTE" && reachesAnonOrAuthenticated(r.grantee) && SERVICE_ONLY_FUNCTIONS.some((f) => r.object_name.startsWith(f)))
    .map(label);
}

/** INSERT, UPDATE or DELETE held by anon or PUBLIC on a public table, at column level, or in the postgres role's default privileges. */
export function anonWriteFindings(rows: SnapshotRow[]): string[] {
  return rows
    .filter((r) => (ANON_WRITE_PRIVILEGES as readonly string[]).includes(r.privilege_type) && (r.grantee === "anon" || r.grantee === "public"))
    .filter((r) => r.source === "table" || r.source === "column" || (r.source === "default" && r.object_name === POSTGRES_PUBLIC_DEFAULTS))
    .map(label);
}
