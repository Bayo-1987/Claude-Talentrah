/**
 * Two source-level guards the Reviewer asked for (18 Oct 2026), no database needed.
 *
 *  1. The export's reading code only READS: src/lib/account-export/{manifest,build,shape,readme}.ts contain no insert, update, upsert, delete, rpc, upload or remove call. (The manifest names farah_messages and
 *     farah_session_events, which is why it is on the history-writers scan's allowlist; this is the condition of that allowlist line.)
 *  2. The admin's response never contains the export's contents: the start/cancel route builds every JSON answer from the keys ok, message, code and field only, and does not import the file
 *     builder or read the bucket. The database-level counterpart (the real body of a real start) is in admin-route.test.ts.
 * Each detector is shown red on a temporary copy with the forbidden thing added.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/** Source with block and line comments removed, so a word in a comment is not a call. */
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");

export const WRITE_CALL = /\.\s*(insert|update|upsert|delete|rpc|upload|remove)\s*\(/;
export const hasWriteCall = (src: string) => WRITE_CALL.test(stripComments(src));

const READERS = ["src/lib/account-export/manifest.ts", "src/lib/account-export/build.ts", "src/lib/account-export/shape.ts", "src/lib/account-export/readme.ts"];

describe("the export's reading code only reads", () => {
  it.each(READERS)("%s has no insert, update, upsert, delete, rpc, upload or remove call", (file) => {
    expect(hasWriteCall(read(file))).toBe(false);
  });

  it("the detector catches each forbidden call added to a temporary copy (red-first), and ignores a mention in a comment", () => {
    const real = read("src/lib/account-export/build.ts");
    for (const bad of ['await client.from("farah_messages").insert({});', 'await client.from("x").update({}).eq("a", 1);', 'await client.from("x").upsert({});', 'await client.from("x").delete().eq("a", 1);', 'await client.rpc("anything");', 'await client.storage.from("data-exports").upload("p", blob);', 'await client.storage.from("data-exports").remove(["p"]);']) {
      expect(hasWriteCall(`${real}\n${bad}`), bad).toBe(true);
    }
    expect(hasWriteCall(`${real}\n// we never .insert( here\n/* .rpc( */`)).toBe(false);
  });
});

describe("the admin's response never contains the export's contents", () => {
  const route = stripComments(read("src/app/admin/data-export/route.ts"));
  const ALLOWED = new Set(["ok", "message", "code", "field"]);

  /** The first argument of every `NextResponse.json(...)` call, found by matching braces, with its top-level keys and whether it holds a nested object literal. */
  const answers = (src: string): Array<{ keys: string[]; nested: boolean }> => {
    const out: Array<{ keys: string[]; nested: boolean }> = [];
    for (const m of src.matchAll(/NextResponse\.json\(\s*\{/g)) {
      let depth = 0;
      let i = m.index! + m[0].length - 1;
      const start = i;
      for (; i < src.length; i++) {
        if (src[i] === "{") depth++;
        else if (src[i] === "}" && --depth === 0) break;
      }
      const body = src.slice(start + 1, i);
      const nested = body.includes("{");
      // top-level keys: a word followed by a colon at the start or after a comma, at bracket depth 0
      const keys: string[] = [];
      let d = 0;
      let token = "";
      for (const ch of body) {
        if ("([{".includes(ch)) d++;
        if (")]}".includes(ch)) d--;
        if (d === 0 && ch === ",") {
          const k = /^\s*(\w+)\s*:/.exec(token);
          if (k) keys.push(k[1]);
          token = "";
        } else token += ch;
      }
      const k = /^\s*(\w+)\s*:/.exec(token);
      if (k) keys.push(k[1]);
      out.push({ keys, nested });
    }
    return out;
  };
  const offences = (src: string) => answers(src).flatMap((a) => [...a.keys.filter((k) => !ALLOWED.has(k)), ...(a.nested ? ["<nested object literal>"] : [])]);

  it("has answers to check (the check is not empty)", () => {
    expect(answers(route).length).toBeGreaterThanOrEqual(10);
  });

  it("every JSON answer is built from ok, message, code and field only", () => {
    expect(offences(route)).toEqual([]);
  });

  it("the route neither builds the file nor reads the bucket", () => {
    expect(route).not.toMatch(/account-export/);
    expect(route).not.toMatch(/storage\b/);
    expect(route).not.toMatch(/downloadObject|exportChunks|\.download\(/);
  });

  it("the detector catches an extra key and a nested object literal, even under an allowed key (red-first)", () => {
    expect(offences(`${route}\nreturn NextResponse.json({ ok: true, file: text }, { status: 200 });`)).toEqual(["file"]);
    expect(offences(`${route}\nreturn NextResponse.json({ ok: true, x: { file: text } });`)).toContain("<nested object literal>");
    expect(offences(`${route}\nreturn NextResponse.json({ ok: true, message: { file: text } });`)).toContain("<nested object literal>");
    expect(offences(`${route}\nreturn NextResponse.json({ ok: true, message: "fine" });`)).toEqual([]);
  });
});
