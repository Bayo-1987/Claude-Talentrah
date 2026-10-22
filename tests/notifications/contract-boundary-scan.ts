/**
 * The scanner behind the contract boundary test. It takes the names it looks for
 * as an argument and never spells one: this file sits inside the scanned tree
 * and would fail the test it serves.
 *
 * A name counts as spelled wherever it appears as a whole word, in code, a
 * string, a template or a comment. That is stricter than "quoted" on purpose:
 * a comment that names a table is how the next literal gets copied from.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export type Allowlist = {
  /** Repo-relative file paths, forward slashes. */
  files: readonly string[];
  /** Repo-relative directory prefixes ending in a slash. */
  dirs: readonly string[];
};

export type Hit = { file: string; line: number; name: string };

const TEXT_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".json", ".sql", ".md", ".mdx", ".css", ".html",
]);
const SKIP_DIRECTORIES = new Set(["node_modules", ".next", ".git"]);

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildNamePattern(names: readonly string[]): RegExp {
  if (names.length === 0) throw new Error("buildNamePattern: refusing an empty name list (it would match nothing)");
  const alternation = names.map(escapeRegExp).join("|");
  return new RegExp(`(?<![A-Za-z0-9_])(${alternation})(?![A-Za-z0-9_])`);
}

export function isAllowed(relativePath: string, allow: Allowlist): boolean {
  return allow.files.includes(relativePath) || allow.dirs.some((dir) => relativePath.startsWith(dir));
}

/** Every file path under `directory`, repo-relative with forward slashes. */
export function listTextFiles(root: string, directory: string): string[] {
  const out: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      if (SKIP_DIRECTORIES.has(entry)) continue;
      const absolute = path.join(current, entry);
      const info = statSync(absolute);
      if (info.isDirectory()) walk(absolute);
      else if (TEXT_EXTENSIONS.has(path.extname(entry))) out.push(path.relative(root, absolute).split(path.sep).join("/"));
    }
  };
  walk(path.join(root, directory));
  return out.sort();
}

export function scanTree(
  root: string,
  directories: readonly string[],
  names: readonly string[],
  allow: Allowlist,
): { hits: Hit[]; scanned: number } {
  const pattern = buildNamePattern(names);
  const hits: Hit[] = [];
  let scanned = 0;
  for (const directory of directories) {
    for (const file of listTextFiles(root, directory)) {
      if (isAllowed(file, allow)) continue;
      scanned += 1;
      const lines = readFileSync(path.join(root, file), "utf8").split("\n");
      lines.forEach((text, index) => {
        const match = pattern.exec(text);
        if (match) hits.push({ file, line: index + 1, name: match[1] });
      });
    }
  }
  return { hits, scanned };
}

export function describeHits(hits: readonly Hit[]): string {
  return hits.map((hit) => `${hit.file}:${hit.line} spells ${hit.name}`).join("\n");
}
