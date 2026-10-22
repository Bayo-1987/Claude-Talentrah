/**
 * The manifest (src/lib/account-export/manifest.ts) is held to three things, none of which needs a database:
 *   1. Every column of every table it reads is classified exactly once, against the generated types: a column added later fails here until somebody decides what
 *      the export does with it.
 *   2. Every foreign key into a person that docs/account-deletion-map.md lists lands in the manifest or in EXCLUDED_TABLES with a reason, so a new key cannot
 *      leave the export unexamined (the live catalogue is checked against the same document by tests/rls/account-deletion-fk-map.test.ts, so together they cover
 *      the database). And a column that holds ANOTHER person's id is never exported as itself.
 *   3. A column whose name looks like a contact detail is never classed `include`, and the only columns classed `own-contact` are the person's own email
 *      addresses (the owner's rule: other people's contact details are never in the file; adding to this list is a decision, made in this test).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EXCLUDED_TABLES, EXPORT_MANIFEST, type ColumnClass } from "@/lib/account-export/manifest";

const ROOT = join(__dirname, "..", "..", "..");
const types = readFileSync(join(ROOT, "src/lib/supabase/types.ts"), "utf8");
const map = readFileSync(join(ROOT, "docs/account-deletion-map.md"), "utf8");

/** A table the repository's migrations create, for the ones the generated types do not know yet (they are regenerated after an apply). */
function createdByAMigration(table: string): boolean {
  const dir = join(ROOT, "supabase/migrations");
  return readdirSync(dir).some((f) => f.endsWith(".sql") && new RegExp(`create table (if not exists )?public\\.${table}\\b`, "i").test(readFileSync(join(dir, f), "utf8")));
}

function rowColumns(table: string): string[] {
  const m = new RegExp(`\\n      ${table}: \\{\\n        Row: \\{([\\s\\S]*?)\\n        \\}`).exec(types);
  if (!m) throw new Error(`no Row for ${table} in the generated types`);
  return [...m[1].matchAll(/\n          (\w+)\??:/g)].map((x) => x[1]);
}

/** "table.column" keys from the first table of the deletion map. */
function mapKeys(): Array<{ table: string; column: string }> {
  const start = map.indexOf("## Foreign keys into a person");
  const end = map.indexOf("\n## ", start + 1);
  const keys: Array<{ table: string; column: string }> = [];
  for (const line of map.slice(start, end).split("\n")) {
    const m = /^\|\s*`([a-z_.*]+?)\.([a-z_*]+)`\s*\|/.exec(line);
    if (m) keys.push({ table: m[2] === "*" ? `${m[1]}.*` : m[1], column: m[2] });
  }
  return keys;
}

const EXPORTED = new Set<ColumnClass["kind"]>(["include", "own-contact", "bank-name", "bank-last-four", "side", "party"]);
const CONTACT_NAME = /(email|phone|whatsapp|telegram|address|handle|linkedin|contact)/i;
/** The only columns that hold a contact detail of the person THEMSELVES. */
const OWN_CONTACT = ["admin_users.email", "profiles.email"];
/** Columns whose NAME contains "email" but that hold a setting, not an address. */
// preference switches (booleans) whose names contain "email", not addresses
const NOT_A_CONTACT = ["email_preferences.win_back_email", "email_preferences.email_promotions", "email_preferences.email_announcements"];

describe("every column is classified, against the generated types", () => {
  it.each(EXPORT_MANIFEST.map((t) => t.table))("%s: the manifest and the types name the same columns", (table) => {
    const spec = EXPORT_MANIFEST.find((t) => t.table === table)!;
    const real = rowColumns(table).sort();
    const classified = Object.keys(spec.columns).sort();
    expect(
      real.filter((c) => !classified.includes(c)),
      `${table} has columns the export manifest does not classify: add each to src/lib/account-export/manifest.ts as include, never, other-party, party or internal`,
    ).toEqual([]);
    expect(classified.filter((c) => !real.includes(c)), `${table}: the manifest classifies columns that are not in the table`).toEqual([]);
    for (const o of spec.owner) expect(real, `${table}: the owner column ${o} is not a column`).toContain(o);
    expect(real, `${table}: the order column ${spec.orderBy} is not a column`).toContain(spec.orderBy);
  });

  it("covers a real number of tables and columns (the check is not empty)", () => {
    expect(EXPORT_MANIFEST.length).toBeGreaterThan(35);
    expect(EXPORT_MANIFEST.reduce((n, t) => n + Object.keys(t.columns).length, 0)).toBeGreaterThan(300);
  });

  it("every excluded class carries a reason", () => {
    for (const t of EXPORT_MANIFEST) {
      for (const [name, c] of Object.entries(t.columns)) {
        if (c.kind === "never" || c.kind === "other-party" || c.kind === "internal") expect(c.why.trim().length, `${t.table}.${name} has no reason`).toBeGreaterThan(8);
      }
    }
    for (const [table, why] of Object.entries(EXCLUDED_TABLES)) expect(why.trim().length, `${table} has no reason`).toBeGreaterThan(8);
  });
});

describe("every foreign key into a person is either exported or excluded on purpose", () => {
  const keys = mapKeys();
  it("reads the deletion map's table (the check is not empty)", () => {
    expect(keys.length).toBeGreaterThan(50);
  });

  it("each table in the map is in the manifest or in EXCLUDED_TABLES", () => {
    const manifest = new Set(EXPORT_MANIFEST.map((t) => t.table));
    const missing = [...new Set(keys.map((k) => k.table))].filter((t) => !manifest.has(t) && !(t in EXCLUDED_TABLES)).sort();
    expect(missing, `tables with a key into a person that the export neither reads nor excludes: add each to EXPORT_MANIFEST or to EXCLUDED_TABLES (with the reason) in src/lib/account-export/manifest.ts`).toEqual([]);
  });

  it("nothing is in both lists, and every excluded table is a real table or the auth schema", () => {
    const manifest = new Set(EXPORT_MANIFEST.map((t) => t.table));
    for (const t of Object.keys(EXCLUDED_TABLES)) {
      expect(manifest.has(t), `${t} is both read and excluded`).toBe(false);
      if (t === "auth.*") continue;
      let known = true;
      try {
        rowColumns(t);
      } catch {
        known = createdByAMigration(t);
      }
      expect(known, `${t} is excluded but is not a table (neither in the generated types nor created by a migration)`).toBe(true);
    }
  });

  it("a column holding ANOTHER person's id is never exported as itself", () => {
    for (const { table, column } of keys) {
      const spec = EXPORT_MANIFEST.find((t) => t.table === table);
      const c = spec?.columns[column];
      if (!spec || !c || spec.owner.includes(column)) continue; // the person's own column
      expect(EXPORTED.has(c.kind) && c.kind !== "party", `${table}.${column} holds another person's id and is exported as ${c.kind}: class it party, other-party or never`).toBe(false);
    }
  });

  it("an owner column that is also a party column (a session has two people) reduces the OTHER person", () => {
    for (const t of EXPORT_MANIFEST.filter((x) => x.owner.length > 1)) {
      for (const o of t.owner) expect(t.columns[o].kind, `${t.table}.${o} is an owner column of a two-person row and must be a party column`).toBe("party");
    }
  });
});

describe("contact details", () => {
  const all = EXPORT_MANIFEST.flatMap((t) => Object.entries(t.columns).map(([name, c]) => ({ table: t.table, name, c })));

  it("no column whose name looks like a contact detail is classed include", () => {
    const bad = all.filter(({ table, name, c }) => CONTACT_NAME.test(name) && c.kind === "include" && !NOT_A_CONTACT.includes(`${table}.${name}`)).map(({ table, name }) => `${table}.${name}`);
    expect(bad, "a contact-looking column is exported as itself: class it own-contact (the person's own), other-party, never or internal").toEqual([]);
  });

  it("the only own-contact columns are the person's own email addresses", () => {
    expect(all.filter(({ c }) => c.kind === "own-contact").map(({ table, name }) => `${table}.${name}`).sort()).toEqual(OWN_CONTACT);
  });

  it("a free-text column the person did not write about themselves is not exported unmasked: side-class text is masked, other people's messages are excluded", () => {
    expect(EXPORT_MANIFEST.find((t) => t.table === "mentorship_sessions")!.columns.mentor_notes).toEqual({ kind: "side", column: "mentor_id", text: true });
    expect(EXPORT_MANIFEST.find((t) => t.table === "mentorship_sessions")!.columns.mentee_notes).toEqual({ kind: "side", column: "mentee_id", text: true });
    expect(EXPORT_MANIFEST.find((t) => t.table === "talent_directory_contact_requests")!.columns.message.kind).toBe("other-party");
  });

  it("secrets and tokens are never exported, by name", () => {
    const secret = /(authorization_code|recipient_code|unsubscribe_token|token_hash|pending_renewal_reference|transfer_code|pending_transfer_reference)$/;
    for (const { table, name, c } of all.filter(({ name }) => secret.test(name))) expect(c.kind, `${table}.${name}`).toBe("never");
  });
});

describe("the notification tables (N1-R29 Q1): excluded on purpose, with a reason, until the export decision is made", () => {
  it.each(["admin_message_recipients", "notification_deliveries", "push_subscriptions"])("%s is excluded with a stated reason and is not exported", (table) => {
    expect(EXCLUDED_TABLES[table], `${table} must be an entry of EXCLUDED_TABLES`).toBeTruthy();
    expect(EXPORT_MANIFEST.some((t) => t.table === table)).toBe(false);
  });
  it("the delivery ledger's reason reads exactly as ruled, and the push devices' reason says the keys are credentials", () => {
    expect(EXCLUDED_TABLES.notification_deliveries).toBe("delivery bookkeeping; export decision tracked in DATA-EXPORT-NOTIF-1");
    expect(EXCLUDED_TABLES.push_subscriptions).toMatch(/credential/);
  });
});
