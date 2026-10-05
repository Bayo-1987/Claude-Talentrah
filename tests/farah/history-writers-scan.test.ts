/**
 * Message history is written by the server only: in src, every write to farah_messages or farah_session_events goes through a client made by createServiceRoleClient(). A write through the
 * signed-in session's client (src/lib/supabase/server) or a browser client does not qualify. A source scan, no database.
 *
 * The scanner is a function of (file, text) pairs, so its own controls below run it on planted code: a write it must find (a user client, an inline user client, an aliased query) and a write it must accept.
 * A scan that cannot find a planted violation proves nothing about the real tree.
 *
 * What counts as a write: `.from("<table>")` whose statement, or whose alias (`const q = ....from("<table>")`, then `q.insert(...)`), calls .insert( .update( .upsert( or .delete( . What counts as the service role:
 * the client is an identifier assigned from createServiceRoleClient() in the same file, or the call is made on `createServiceRoleClient()` directly. Anything else (including an expression the scanner cannot read) does not.
 *
 * A second check pins WHICH files may mention the two tables in code at all, so a new site (a new route, a helper that builds the table name in a variable) fails here until someone looks at it.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "../..");
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}
const sources = walk(join(ROOT, "src"))
  .filter((p) => !p.endsWith("supabase/types.ts"))
  .map((p) => ({ file: p.slice(ROOT.length + 1), text: readFileSync(p, "utf8") }));

const TABLE = /\.from\(\s*["'`](farah_messages|farah_session_events)["'`]\s*\)/g;
const VERB = /\.(insert|update|upsert|delete)\(/;

/** Drops comments so a table named in prose is not a reference. (A string that contains "//" is kept whole enough for this scan: it only has to keep code.) */
export function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
}

export interface Write {
  file: string;
  line: number;
  client: string;
  verb: string;
  viaServiceRole: boolean;
}

export function findWrites(files: Array<{ file: string; text: string }>): Write[] {
  const writes: Write[] = [];
  for (const { file, text: raw } of files) {
    const text = stripComments(raw);
    const serviceClients = new Set([...text.matchAll(/\b(?:const|let|var)\s+([A-Za-z_]\w*)\s*=\s*(?:await\s+)?createServiceRoleClient\(\)/g)].map((m) => m[1]));
    for (const m of text.matchAll(TABLE)) {
      const before = text.slice(Math.max(0, m.index! - 120), m.index!);
      const inline = /createServiceRoleClient\(\)\s*$/.test(before);
      const ident = /([A-Za-z_]\w*)\s*$/.exec(before)?.[1];
      const viaServiceRole = inline || (ident !== undefined && serviceClients.has(ident));
      const client = inline ? "createServiceRoleClient()" : (ident ?? "<expression>");
      const after = text.slice(m.index! + m[0].length, m.index! + m[0].length + 500);
      const stop = after.search(/;\s*\n|\n\s*\n/);
      const statement = stop === -1 ? after : after.slice(0, stop);
      let verb = VERB.exec(statement)?.[1];
      if (!verb) {
        // `const q = client.from("farah_messages")` and later `q.insert(...)`.
        const alias = /(?:const|let|var)\s+([A-Za-z_]\w*)\s*=\s*[^;]*$/.exec(text.slice(Math.max(0, m.index! - 200), m.index! + m[0].length))?.[1];
        if (alias) verb = new RegExp(`\\b${alias}\\s*\\.(insert|update|upsert|delete)\\(`).exec(text)?.[1];
      }
      if (!verb) continue;
      writes.push({ file, line: text.slice(0, m.index).split("\n").length, client, verb, viaServiceRole });
    }
  }
  return writes;
}

const offendersIn = (files: Array<{ file: string; text: string }>) => findWrites(files).filter((w) => !w.viaServiceRole).map((w) => `${w.file}:${w.line} ${w.client}.from(...).${w.verb}(`);

describe("the scanner, on planted code (controls)", () => {
  const f = (text: string) => [{ file: "src/planted.ts", text }];
  it("finds a write through the signed-in session's client", () => {
    expect(offendersIn(f(`const supabase = await createClient();\nawait supabase.from("farah_messages").insert({ user_id: u });\n`))).toHaveLength(1);
  });
  it("finds a write through an inline session client, which has no identifier before .from(", () => {
    expect(offendersIn(f(`await (await createClient()).from("farah_session_events").insert({ user_id: u });\n`))).toHaveLength(1);
  });
  it("finds a delete, an update and an upsert, on either table, across lines", () => {
    for (const verb of ["delete().eq('id', 1)", "update({ content: 'x' })", "upsert({ id: 1 })"]) {
      expect(offendersIn(f(`await supabase\n  .from("farah_messages")\n  .${verb};\n`)), verb).toHaveLength(1);
    }
    expect(offendersIn(f(`await browser.from("farah_session_events").delete().eq("id", 1);\n`))).toHaveLength(1);
  });
  it("finds an aliased write: the query is kept in a variable and written to later", () => {
    expect(offendersIn(f(`const q = supabase.from("farah_messages");\nawait q.insert({ user_id: u });\n`))).toHaveLength(1);
  });
  it("finds a client the scanner cannot name (a call result, a property), because a write must be PROVEN to use the service role", () => {
    expect(offendersIn(f(`await getClient().from("farah_messages").insert({ user_id: u });\n`))).toHaveLength(1);
    expect(offendersIn(f(`await this.db.from("farah_messages").insert({ user_id: u });\n`))).toHaveLength(1);
  });
  it("does not count a read, or a table named only in a comment", () => {
    expect(findWrites(f(`const { data } = await supabase.from("farah_messages").select("id").limit(1);\n`))).toEqual([]);
    expect(findWrites(f(`// supabase.from("farah_messages").insert({ user_id: u })\n/* supabase.from("farah_messages").delete() */\n`))).toEqual([]);
  });
  it("accepts a write through a client made by createServiceRoleClient(), named or inline", () => {
    expect(offendersIn(f(`const history = createServiceRoleClient();\nawait history.from("farah_messages").insert({ user_id: u });\n`))).toEqual([]);
    expect(offendersIn(f(`await createServiceRoleClient().from("farah_session_events").insert({ user_id: u });\n`))).toEqual([]);
  });
  it("a service-role client in one place does not vouch for a session client of the same name elsewhere in another file", () => {
    const files = [
      { file: "src/a.ts", text: `const s = createServiceRoleClient();\nawait s.from("farah_messages").insert({});\n` },
      { file: "src/b.ts", text: `const s = await createClient();\nawait s.from("farah_messages").insert({});\n` },
    ];
    expect(offendersIn(files)).toEqual(["src/b.ts:2 s.from(...).insert("]);
  });
});

describe("message history is written by the server only (the real tree)", () => {
  it("the scan finds the known writers (so an empty result below would mean something)", () => {
    const writes = findWrites(sources);
    expect(writes.length).toBeGreaterThanOrEqual(4);
    expect(new Set(writes.map((w) => w.file))).toEqual(new Set(["src/lib/farah/save-exchange.ts", "src/lib/farah/session-events.ts"]));
  });

  it("every write to the Farah tables in src uses a service-role client", () => {
    expect(offendersIn(sources)).toEqual([]);
  });

  it("no browser-side code writes the Farah tables", () => {
    const browserFiles = new Set(sources.filter((s) => /^\s*["']use client["']/.test(s.text)).map((s) => s.file));
    expect(findWrites(sources).filter((w) => browserFiles.has(w.file)).map((w) => `${w.file}:${w.line}`)).toEqual([]);
  });

  it("only these files mention either table in code, so a new site is looked at before it ships", () => {
    const mentioning = sources.filter((s) => /farah_messages|farah_session_events/.test(stripComments(s.text))).map((s) => s.file).sort();
    expect(mentioning).toEqual([
      "src/app/api/farah/chat/route.ts", // reads only, through the session's client
      "src/app/api/farah/history/route.ts", // reads only, through the session's client
      "src/lib/farah/save-exchange.ts", // the exchange writer, service role
      "src/lib/farah/session-events.ts", // the session-event writer, service role
    ]);
  });

  it("the two routes that read through the session's client hold no service-role client, so they cannot write", () => {
    for (const file of ["src/app/api/farah/chat/route.ts", "src/app/api/farah/history/route.ts"]) {
      const text = sources.find((s) => s.file === file)!.text;
      expect(stripComments(text), file).not.toContain("createServiceRoleClient");
    }
  });
});
