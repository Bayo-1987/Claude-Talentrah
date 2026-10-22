/**
 * Shared helpers for the N1 migration tests (0264 and 0265). No test lives here.
 *
 * REPLAY. A migration test must not depend on what the stack happened to apply. `replay` builds one script that opens a transaction, runs the migration's own rollback file, runs the forward
 * file as it is on disk, runs the test's SQL, and ends in ROLLBACK, so a test sees the effect of the file in front of it and leaves nothing behind. A mutant is an edit to the file on disk:
 * every test replays the edited text. The rollback file is therefore exercised by every test, and it is written to be re-runnable (every statement is `if exists`).
 *
 * EXPECT. `pg_temp.expect(sql, sqlstate)` runs one statement in a subtransaction and answers `ok` when it fails with exactly that SQLSTATE, `NOT REFUSED` when it succeeds and `WRONG <state>`
 * otherwise, so one script can probe many refusals without aborting the transaction.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runN1Sql } from "./migration-0265-local-db";

export const ROOT = join(__dirname, "../..");
export const F0264 = "0264_user_messaging_permission.sql";
export const R0264 = "0264_user_messaging_permission.rollback.sql";
export const F0265 = "0265_notifications_and_admin_messaging.sql";
export const R0265 = "0265_notifications_and_admin_messaging.rollback.sql";

export const readMigration = (name: string) => readFileSync(join(ROOT, "supabase/migrations", name), "utf8");
export const readRollback = (name: string) => readFileSync(join(ROOT, "supabase/rollbacks", name), "utf8");

/** The SQL with `--` comments removed and whitespace collapsed. */
export function code(sql: string): string {
  return sql
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Splits on semicolons that are not inside a dollar-quoted body, so a `do` block or a function body counts as one statement. */
export function statements(sql: string): string[] {
  const c = code(sql);
  const out: string[] = [];
  let cur = "";
  let tag: string | null = null;
  for (let i = 0; i < c.length; i++) {
    if (tag === null) {
      const m = /^\$[A-Za-z_]*\$/.exec(c.slice(i));
      if (m) {
        tag = m[0];
        cur += tag;
        i += tag.length - 1;
        continue;
      }
      if (c[i] === ";") {
        if (cur.trim()) out.push(cur.trim());
        cur = "";
        continue;
      }
    } else if (c.startsWith(tag, i)) {
      cur += tag;
      i += tag.length - 1;
      tag = null;
      continue;
    }
    cur += c[i];
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** True when the SQL casts, compares or passes `label` as the admin_permission type (the use Postgres refuses, 55P04, in the transaction that adds it). Text reads do not count. */
export function usesNewValueAsEnum(sql: string, label: string): boolean {
  const c = code(sql);
  const q = `'${label}'`;
  return (
    new RegExp(`${q}\\s*::\\s*(public\\.)?admin_permission`, "i").test(c) ||
    new RegExp(`cast\\s*\\(\\s*${q}\\s+as\\s+(public\\.)?admin_permission`, "i").test(c) ||
    new RegExp(`admin_permission\\s*${q}`, "i").test(c) ||
    new RegExp(`(permission|enumlabel)\\s*(=|<>|!=|in\\s*\\()\\s*\\(?\\s*${q}`, "i").test(c.replace(/(permission|enumlabel)\s*::\s*text/gi, "$1_as_text"))
  );
}

export const EXPECT_FN = `create function pg_temp.expect(stmt text, want text) returns text language plpgsql as $expect$
begin
  execute stmt;
  return 'NOT REFUSED';
exception when others then
  if sqlstate = want then return 'ok'; end if;
  return 'WRONG ' || sqlstate || ' ' || sqlerrm;
end
$expect$;`;

/** The two fixture rows the table tests need: a person (the profile is made by the signup trigger) and an admin. */
export function personSql(id: string, email = `${id}@example.test`) {
  return `insert into auth.users (id, email, instance_id, aud, role) values ('${id}', '${email}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');`;
}
export function adminSql(id: string, email = `${id}@example.test`) {
  return `${personSql(id, email)}\ninsert into public.admin_users (id, email) values ('${id}', '${email}');`;
}

/**
 * Runs `body` after rolling back and re-applying 0265 as it is on disk, all in one transaction that is rolled back. A test reports a result by selecting a line `R|<name>|<value>`;
 * `res` maps each name to its value (psql's own command tags are ignored). When the script fails, `ok` is false and `stderr` carries the SQLSTATE.
 */
export function replay0265(body: string, opts: { forward?: string; rollback?: string } = {}) {
  const forward = opts.forward ?? readMigration(F0265);
  const rollback = opts.rollback ?? readRollback(R0265);
  const script = `begin;\n${rollback}\n${forward}\n${EXPECT_FN}\n${body}\nrollback;`;
  const r = runN1Sql(script);
  const res: Record<string, string> = {};
  for (const line of r.stdout.split("\n")) {
    const m = /^R\|([^|]+)\|(.*)$/.exec(line.trim());
    if (m) res[m[1]] = m[2];
  }
  return { ...r, res };
}

export const last = (out: string) => out.trim().split("\n").pop();
