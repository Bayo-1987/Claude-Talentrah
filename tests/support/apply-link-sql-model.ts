/**
 * The SQL side of the career-site link rules, read from the text of migration 0277 and replayed in JavaScript, shared by the shape test and the TypeScript-versus-SQL parity test. Nothing here is
 * hand-copied from the SQL: the patterns, the allowlists and the vendor labels are pulled out of the file, so a change in the SQL changes (or breaks) what is replayed.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

export const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
export const code = (text: string) => text.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
/** The text of a whole `create or replace function public.<name>(...)` ... through its trailing comment statement. */
export function functionBlock(script: string, name: string): string {
  const start = script.indexOf(`create or replace function public.${name}(`);
  if (start < 0) throw new Error(`no function ${name}`);
  const commentAt = script.indexOf(`comment on function public.${name}(`, start);
  return script.slice(start, script.indexOf(";\n", commentAt) + 2);
}

const sql = read("supabase/migrations/0277_job_postings_apply_link.sql");

// ── The SQL's link rules, replayed from the patterns in the SQL text ────────────────────────────────────────────────────────────────────────────
export const fnText = code(functionBlock(sql, "set_job_apply_link"));
const posix = (re: string) => re.replace(/\[\[:space:\]\]/g, "\\s").replace(/\[:space:\]/g, "\\s").replace(/\[:cntrl:\]/g, "\\x00-\\x1f\\x7f");
export const grab = (re: RegExp, label: string): string => {
  const m = fnText.match(re);
  if (!m) throw new Error(`SQL pattern not found: ${label}`);
  return m[1];
};
export const SHAPE = new RegExp(posix(grab(/p_url !~ '([^']+)'/, "shape")));
export const HOST = new RegExp(posix(grab(/substring\(p_url from '(\^https:\/\/\([^']+)'\)/, "host")));
export const HOST_BAD = new RegExp(grab(/v_host ~ '(\(\\\.\\\.[^']+)'/, "host-bad"));
export const PATH = new RegExp(grab(/v_path := substring\(p_url from '([^']+)'\)/, "path"));
export const PATH_OK = new RegExp(grab(/v_path !~ '([^']+)'/, "path-ok"));
export const TENANT = new RegExp(grab(/v_host !~ '(\^\[a-z0-9\]\(\[a-z0-9-\]\*\[a-z0-9\]\)\?\\\.\([^']+)'/, "tenant"));
export const XN = new RegExp(grab(/v_host ~ '(\(\^\|\\\.\)xn--)'/, "xn--"));
export const VENDOR = [...grab(/split_part\(v_host, '\.', 1\) = any \(array\[([^\]]+)\]\)/, "vendor labels").matchAll(/'([^']+)'/g)].map((m) => m[1]);
export const EXACT = [...grab(/v_host = any \(array\[([^\]]+)\]\)/, "exact list").matchAll(/'([^']+)'/g)].map((m) => m[1]);

export type Org = { domain: string | null; verified: boolean };
export function sqlModel(url: string, kind: string | null, org: Org, tick: boolean): "accept" | "AE005" | "AE006" | "AE007" {
  if (kind === null || !["company", "ats"].includes(kind) || url.length > 2000 || /\s/.test(url) || !SHAPE.test(url)) return "AE005";
  const host = HOST.exec(url)?.[1];
  if (!host || !host.includes(".") || HOST_BAD.test(host) || XN.test(host) || host.length > 253) return "AE005";
  if (kind === "company") {
    const d = (org.domain ?? "").trim().toLowerCase();
    if (!org.verified || d === "") return "AE006";
    return host === d || host.slice(-(d.length + 1)) === `.${d}` ? "accept" : "AE005";
  }
  const p = PATH.exec(url)?.[1] ?? null;
  if (EXACT.includes(host)) {
    if (p === null || !PATH_OK.test(p)) return "AE005";
  } else if (!TENANT.test(host) || VENDOR.includes(host.split(".")[0])) return "AE005";
  return tick ? "accept" : "AE007";
}

