/**
 * The 0224/0225 rollback round trip, as three pieces that run without a database except for the one that has to: the SQL that reads the privileges (snapshotSql), the script that
 * takes the three snapshots around the rollbacks and the migrations inside ONE transaction that always ends in a rollback (roundTripScript), and the comparison of what came back
 * (parseSnapshots, compareRoundTrip). tests/supabase/migration-0224-0225-round-trip.test.ts runs the script against the local stack; tests/support/privilege-round-trip.test.ts pins the comparison.
 *
 * What is compared, per table: the table-level ACL, and per column the column-level ACL and the privileges anon and authenticated effectively hold (SELECT, INSERT, UPDATE, REFERENCES).
 * Nothing here knows what the old ACLs were; the comparison asks three things that need no stored copy of them:
 *   - the rollbacks undo ONLY SELECT: with the SELECT entries taken out, the state after them equals the state before them;
 *   - after the rollbacks both roles can read every column and no column-level SELECT grant is left (the shape both rollbacks assert themselves);
 *   - applying the migrations again gives back exactly the original state.
 * It also refuses to call a round trip fine when it proved nothing: the state at the start must already be the migrated one, and the rollbacks must have changed something.
 */

export type SnapshotText = string;

export interface ColumnState {
  /** Column-level ACL entries "grantee:PRIVILEGE", sorted, comma-separated, "-" when there are none. */
  acl: string;
  /** "anon=S---;authenticated=SIU-": the privileges each role effectively holds on the column, in the order SELECT, INSERT, UPDATE, REFERENCES. */
  eff: string;
}
export interface TableState {
  /** The table-level ACL, in the same form as a column's. */
  relacl: string;
  columns: Record<string, ColumnState>;
}
export type Snapshot = Record<string, TableState>;
export interface Snapshots {
  post: Snapshot;
  rolledBack: Snapshot;
  postAgain: Snapshot;
}

const IDENT = /^[a-z_][a-z0-9_]*$/;
const SECTIONS = ["post", "rolledback", "postagain"] as const;

/** One query. Rows come back as lines: "T|table|acl" per table and "C|table|column|acl|eff" per column, in a fixed order. */
export function snapshotSql(tables: readonly string[]): string {
  for (const t of tables) if (!IDENT.test(t)) throw new Error(`not a plain table name: ${t}`);
  const list = tables.map((t) => `'${t}'`).join(", ");
  const entry = (alias: string) =>
    `case when ${alias}.grantee = 0 then 'PUBLIC' else ${alias}.grantee::regrole::text end || ':' || ${alias}.privilege_type || case when ${alias}.is_grantable then '*' else '' end`;
  const eff = (role: string) =>
    `'${role}=' || (case when has_column_privilege('${role}', c.oid, a.attnum, 'SELECT') then 'S' else '-' end` +
    ` || case when has_column_privilege('${role}', c.oid, a.attnum, 'INSERT') then 'I' else '-' end` +
    ` || case when has_column_privilege('${role}', c.oid, a.attnum, 'UPDATE') then 'U' else '-' end` +
    ` || case when has_column_privilege('${role}', c.oid, a.attnum, 'REFERENCES') then 'R' else '-' end)`;
  return `select line from (
  select c.relname::text as t, 0 as k, 0 as n,
         'T|' || c.relname || '|' || coalesce((select string_agg(e, ',' order by e) from (select ${entry("g")} as e from aclexplode(c.relacl) g) z), '-') as line
    from pg_class c join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'public' and c.relkind in ('r', 'p') and c.relname in (${list})
  union all
  select c.relname::text, 1, a.attnum,
         'C|' || c.relname || '|' || a.attname || '|' || coalesce((select string_agg(e, ',' order by e) from (select ${entry("g")} as e from aclexplode(a.attacl) g) z), '-')
           || '|' || ${eff("anon")} || ';' || ${eff("authenticated")}
    from pg_class c join pg_namespace s on s.oid = c.relnamespace join pg_attribute a on a.attrelid = c.oid
   where s.nspname = 'public' and c.relkind in ('r', 'p') and c.relname in (${list}) and a.attnum > 0 and not a.attisdropped
) q order by t, k, n;`;
}

/** A line that would end or restart the transaction the whole round trip depends on. (A PL/pgSQL "begin" inside a DO block has no semicolon and is not this.) */
const ENDS_TRANSACTION = /^\s*(begin\s*;|start\s+transaction|commit\s*;|rollback\s*;|abort\s*;|end\s*transaction)/im;

/** Everything inside one transaction that is rolled back at the end, so a run cannot leave the database different, whatever happens in it. */
export function roundTripScript(tables: readonly string[], files: { rollbacks: readonly string[]; migrations: readonly string[] }): string {
  for (const f of [...files.rollbacks, ...files.migrations]) {
    if (ENDS_TRANSACTION.test(f)) throw new Error("a file passed to the round trip controls the transaction itself, which would defeat the rollback at the end");
  }
  const snap = snapshotSql(tables);
  const marker = (name: string) => `select '@@SNAP ${name}';`;
  return [
    "-- 0224/0225 round trip: one transaction, always rolled back.",
    "begin;",
    "set local lock_timeout = '10s';",
    "set local statement_timeout = '60s';",
    marker("post"),
    snap,
    ...files.rollbacks,
    marker("rolledback"),
    snap,
    ...files.migrations,
    marker("postagain"),
    snap,
    "rollback;",
    "",
  ].join("\n");
}

function parseSnapshot(lines: string[], section: string): Snapshot {
  const out: Snapshot = {};
  for (const line of lines) {
    if (line.startsWith("T|")) {
      const p = line.split("|");
      if (p.length !== 3) throw new Error(`cannot read a snapshot line in ${section}: ${line}`);
      out[p[1]] ??= { relacl: p[2], columns: {} };
      out[p[1]].relacl = p[2];
    } else if (line.startsWith("C|")) {
      const p = line.split("|");
      if (p.length !== 5) throw new Error(`cannot read a snapshot line in ${section}: ${line}`);
      out[p[1]] ??= { relacl: "", columns: {} };
      out[p[1]].columns[p[2]] = { acl: p[3], eff: p[4] };
    }
  }
  return out;
}

/** Splits the output at the three "@@SNAP" markers. Anything that is not a snapshot line (psql's own output) is ignored; a snapshot line that cannot be read is an error. */
export function parseSnapshots(output: SnapshotText): Snapshots {
  const found: Record<string, string[]> = {};
  let current: string[] | null = null;
  for (const raw of output.split("\n")) {
    const line = raw.trim();
    const m = /^@@SNAP (\w+)$/.exec(line);
    if (m) {
      found[m[1]] = current = [];
    } else if (current) {
      current.push(line);
    }
  }
  for (const s of SECTIONS) if (!found[s]) throw new Error(`the output has no "${s}" snapshot`);
  return { post: parseSnapshot(found.post, "post"), rolledBack: parseSnapshot(found.rolledback, "rolledback"), postAgain: parseSnapshot(found.postagain, "postagain") };
}

const withoutSelectAcl = (acl: string): string => {
  const kept = acl.split(",").filter((e) => e !== "-" && !e.endsWith(":SELECT"));
  return kept.length ? kept.join(",") : "-";
};
const withoutSelectEff = (eff: string): string => eff.replace(/=S/g, "=-");

/** Every problem found, as sentences; empty means the round trip held. */
export function compareRoundTrip(s: Snapshots, tables: readonly string[]): string[] {
  const problems: string[] = [];
  const named: Array<[string, Snapshot]> = [["post", s.post], ["rolledback", s.rolledBack], ["postagain", s.postAgain]];

  // Shape first: the same tables and the same columns in all three, or nothing else can be compared.
  for (const [name, snap] of named) {
    for (const t of tables) {
      if (!snap[t] || Object.keys(snap[t].columns).length === 0) problems.push(`${t} is missing from the ${name} snapshot`);
    }
  }
  if (problems.length) return problems;
  for (const t of tables) {
    const base = Object.keys(s.post[t].columns).sort();
    for (const [name, snap] of named) {
      const here = Object.keys(snap[t].columns).sort();
      for (const c of base) if (!here.includes(c)) problems.push(`${t}.${c} is missing from the ${name} snapshot`);
      for (const c of here) if (!base.includes(c)) problems.push(`${t}.${c} appears in the ${name} snapshot but not in the first`);
    }
  }
  if (problems.length) return problems;

  // The starting state must be the migrated one, or the round trip is vacuous.
  for (const t of tables) {
    const unreadable = Object.values(s.post[t].columns).some((c) => !/anon=S/.test(c.eff) || !/authenticated=S/.test(c.eff));
    if (!unreadable) problems.push(`the migrations were not applied to ${t} when the round trip started (every column is readable by both roles), so the round trip proves nothing`);
  }
  if (JSON.stringify(s.rolledBack) === JSON.stringify(s.post)) problems.push("the rollback changed nothing");

  for (const t of tables) {
    // After the rollbacks: every column readable by both roles, no column-level SELECT grant left.
    for (const [c, st] of Object.entries(s.rolledBack[t].columns)) {
      if (!/anon=S/.test(st.eff)) problems.push(`${t}.${c}: after the rollback anon cannot read it`);
      if (!/authenticated=S/.test(st.eff)) problems.push(`${t}.${c}: after the rollback authenticated cannot read it`);
      if (st.acl.split(",").some((e) => e.endsWith(":SELECT"))) problems.push(`${t}.${c}: a column-level SELECT grant is left after the rollback`);
    }
    // The rollbacks undo SELECT and nothing else.
    if (withoutSelectAcl(s.post[t].relacl) !== withoutSelectAcl(s.rolledBack[t].relacl)) {
      problems.push(`the rollback changed a privilege other than SELECT on ${t} (table): ${withoutSelectAcl(s.post[t].relacl)} became ${withoutSelectAcl(s.rolledBack[t].relacl)}`);
    }
    for (const c of Object.keys(s.post[t].columns)) {
      const a = s.post[t].columns[c];
      const b = s.rolledBack[t].columns[c];
      if (withoutSelectAcl(a.acl) !== withoutSelectAcl(b.acl) || withoutSelectEff(a.eff) !== withoutSelectEff(b.eff)) {
        problems.push(`the rollback changed a privilege other than SELECT on ${t}.${c}: ${withoutSelectAcl(a.acl)} / ${withoutSelectEff(a.eff)} became ${withoutSelectAcl(b.acl)} / ${withoutSelectEff(b.eff)}`);
      }
    }
    // Applying the migrations again restores the original exactly.
    if (s.postAgain[t].relacl !== s.post[t].relacl) problems.push(`re-applying the migrations did not restore the original state of ${t} (table): ${s.post[t].relacl} became ${s.postAgain[t].relacl}`);
    for (const c of Object.keys(s.post[t].columns)) {
      const a = s.post[t].columns[c];
      const b = s.postAgain[t].columns[c];
      if (a.acl !== b.acl || a.eff !== b.eff) problems.push(`re-applying the migrations did not restore the original state of ${t}.${c}: ${a.acl} / ${a.eff} became ${b.acl} / ${b.eff}`);
    }
  }
  return problems;
}
