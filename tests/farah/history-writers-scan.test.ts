/**
 * Message history is written by the server only: in src, every write to farah_messages or farah_session_events goes through a client made by createServiceRoleClient(). A write through the
 * signed-in session's client (src/lib/supabase/server) or a browser client does not qualify. A source scan, no database.
 *
 * The shape of a write: `<client>.from("farah_messages")` followed, in the same statement, by .insert( .update( .upsert( or .delete( . The client is the identifier before `.from(`.
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
const sources = walk(join(ROOT, "src")).filter((p) => !p.endsWith("supabase/types.ts"));

interface Write { file: string; line: number; client: string; verb: string; viaServiceRole: boolean }
function findWrites(): Write[] {
  const writes: Write[] = [];
  for (const file of sources) {
    const text = readFileSync(file, "utf8");
    const serviceClients = new Set([...text.matchAll(/\b(?:const|let)\s+([A-Za-z_]\w*)\s*=\s*(?:await\s+)?createServiceRoleClient\(\)/g)].map((m) => m[1]));
    for (const m of text.matchAll(/([A-Za-z_]\w*)\s*\.from\(\s*["'](farah_messages|farah_session_events)["']\s*\)/g)) {
      const after = text.slice(m.index! + m[0].length, m.index! + m[0].length + 500);
      const stop = after.search(/;\s*\n|\n\s*\n/);
      const statement = stop === -1 ? after : after.slice(0, stop);
      const verb = /\.(insert|update|upsert|delete)\(/.exec(statement)?.[1];
      if (!verb) continue;
      const line = text.slice(0, m.index).split("\n").length;
      writes.push({ file: file.slice(ROOT.length + 1), line, client: m[1], verb, viaServiceRole: serviceClients.has(m[1]) || /createServiceRoleClient\(\)\s*$/.test(text.slice(Math.max(0, m.index! - 40), m.index!)) });
    }
  }
  return writes;
}

describe("message history is written by the server only", () => {
  it("the scan finds the known writers (so an empty result below would mean something)", () => {
    expect(findWrites().length).toBeGreaterThan(0);
  });

  it("every write to the Farah tables in src uses a service-role client", () => {
    const offenders = findWrites().filter((w) => !w.viaServiceRole).map((w) => `${w.file}:${w.line} ${w.client}.from(...).${w.verb}(`);
    expect(offenders).toEqual([]);
  });

  it("no browser-side code writes the Farah tables", () => {
    const browserFiles = sources.filter((p) => /^\s*["']use client["']/.test(readFileSync(p, "utf8")));
    const offenders = findWrites().filter((w) => browserFiles.some((b) => b.endsWith(w.file))).map((w) => `${w.file}:${w.line}`);
    expect(offenders).toEqual([]);
  });
});
