/**
 * The register in docs/database-environments.md §2 and the files in supabase/migrations/ must agree, in both directions.
 * Until this test existed, the only guard on the register (database-environments.test.ts) checked that the heading and at least
 * one row were present, so a migration file could merge with no row, and a row could say "applied" with no file.
 *
 * The register starts at its first row (0208): older migrations predate it and are not required to have a row.
 *  - Every migration file numbered at or above the first register row must have a row.
 *  - Every row must have a file, unless it only holds the number: its production cell starts with "reserved" or "proposed",
 *    or contains "n/a". A row with no file must not claim "applied <time>".
 *  - A row that still says reserved or proposed in both cells while its file is in the tree fails: the PR that added the file must flip
 *    its own row ("merged, not applied" is the wording for a file that merges before its apply).
 *  - A row that quotes a sha256 for a migration file ("supabase/migrations/<name>.sql, sha256 <64 hex>", with or without backticks) must match the file whenever that
 *    file is in the tree (an approved hash is for one exact file); a file that is not in the tree is not checked.
 *  - A number has one row.
 *
 * The parse is strict: a missing heading, a missing table header, a row with the wrong number of cells or zero rows are each reported.
 *
 * It reads two things only: docs/database-environments.md and the file names in supabase/migrations/. No git, no network,
 * no clock. DOCS_ROOT points the test at another checkout (used to show it red against a changed register).
 */
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

type Row = { number: string; production: string; preview: string; heldBy?: string };

const REGISTER = "docs/database-environments.md";
const HEADING = "## 2. Reserved migration numbers";
const HEADER = /^\|\s*Number\s*\|\s*Held by\s*\|\s*Production\s*\|\s*talentrah-preview\s*\|/m;

/**
 * Rows plus every way the table failed to parse. A silent parse is how a guard goes green on nothing: a missing heading, a missing
 * header, a row with the wrong number of cells, or zero rows must each be reported, never skipped.
 */
export function parseRegister(text: string): { rows: Row[]; problems: string[] } {
  const problems: string[] = [];
  const start = text.indexOf(HEADING);
  if (start === -1) return { rows: [], problems: [`${REGISTER} has no "${HEADING}" heading. Restore the heading and its table.`] };
  const end = text.indexOf("\n## ", start + 1);
  const section = text.slice(start, end === -1 ? undefined : end);
  if (!HEADER.test(section)) {
    problems.push(`The table header "| Number | Held by | Production | talentrah-preview |" is missing under "${HEADING}" in ${REGISTER}. Restore it: rows are read by position.`);
  }
  const rows: Row[] = [];
  for (const line of section.split("\n")) {
    if (!/^\|\s*\d{4}\s*\|/.test(line)) continue;
    const cells = line.split("|").map((c) => c.trim());
    // "| 0208 | held by | production | preview |" splits into 6: an empty first cell, four cells, an empty last cell.
    if (cells.length !== 6) {
      problems.push(`${REGISTER} row ${cells[1]} has ${Math.max(cells.length - 2, 0)} cells, expected 4 (number, held by, production, talentrah-preview). Fix the row; a "|" inside a cell splits it.`);
      continue;
    }
    rows.push({ number: cells[1], production: cells[3], preview: cells[4], heldBy: cells[2] });
  }
  if (rows.length === 0) problems.push(`No register rows were parsed under "${HEADING}" in ${REGISTER}. The table is empty or its rows are malformed.`);
  return { rows, problems };
}

/**
 * A row that quotes a sha256 for a migration (or rollback) file must match that file when the file is in the tree. `readFile` returns
 * null when the file is absent.
 *
 * WHICH HASH IS COMPARED: only a sha256 that DIRECTLY follows a `supabase/migrations/...sql` or `supabase/rollbacks/...sql` path (with only
 * a backtick, whitespace and at most one comma or colon between them), and it is compared with the bytes of THAT file. A row may quote
 * several such pairs (a migration and its rollback, backticked or plain): each is checked on its own. A hash that is not directly after
 * such a path is ignored, because it belongs to something else (an apply statement, a data fix, a commit): the approved hash is for one
 * exact file, and comparing any other hash with a file would fail a correct row.
 */
const PAIR = /(supabase\/(?:migrations|rollbacks)\/[A-Za-z0-9_.-]+\.sql)`?\s*[,:]?\s*sha256\s+`?([0-9a-fA-F]{64})`?/g;

export function hashProblems(rows: Row[], readFile: (relativePath: string) => Buffer | null): string[] {
  const problems: string[] = [];
  for (const r of rows) {
    for (const m of (r.heldBy ?? "").matchAll(PAIR)) {
      const file = m[1];
      const quoted = m[2].toLowerCase();
      const bytes = readFile(file);
      if (bytes === null) continue;
      const actual = createHash("sha256").update(bytes).digest("hex");
      if (actual !== quoted) {
        problems.push(
          `${REGISTER} row ${r.number} quotes sha256 ${quoted} for ${file}, but the file in this tree hashes to ${actual}. An approved hash is for one exact file: restore that file, or have the owner approve the new hash and update the row.`,
        );
      }
    }
  }
  return problems;
}

/** Every problem, each worded as what to add and where. Empty when the register and the directory agree. */
export function registerProblems(rows: Row[], files: string[]): string[] {
  const problems: string[] = [];
  const have = new Set(rows.map((r) => r.number));
  const fileSet = new Set(files);
  const first = rows.map((r) => r.number).sort()[0] ?? "9999";

  for (const n of files.filter((f) => f >= first && !have.has(f)).sort()) {
    problems.push(
      `supabase/migrations/${n}_*.sql has no row in ${REGISTER} section 2 (Reserved migration numbers). Add a row in this PR: | ${n} | <session>, <what it does> | <production status> | <talentrah-preview status> |`,
    );
  }
  const heldOnly = (cell: string) => /^(reserved|proposed)\b/i.test(cell) || /n\/a/i.test(cell);
  const reservedStart = (cell: string) => /^(reserved|proposed)\b/i.test(cell);
  for (const r of rows) {
    if (fileSet.has(r.number)) {
      // The file is in this tree. A row that still holds the number in BOTH cells was not flipped by the PR that added the file.
      if (reservedStart(r.production) && reservedStart(r.preview)) {
        problems.push(
          `supabase/migrations/${r.number}_*.sql is in this tree but both cells of its row in ${REGISTER} still say "${r.production}" / "${r.preview}". In the PR that adds the file, flip your own row: | ${r.number} | <unchanged> | applied <hh:mmZ> (<date>) | applied <hh:mmZ> (<date>) |. If the file merges first and is applied after the deploy, start the cells with "merged, not applied".`,
        );
      }
      continue;
    }
    for (const [which, cell] of [["production", r.production], ["talentrah-preview", r.preview]] as const) {
      if (!heldOnly(cell)) {
        problems.push(
          `${REGISTER} has a row for ${r.number} whose ${which} cell says "${cell}" but supabase/migrations has no ${r.number}_*.sql. Add the file in this PR, or make the cell start with "reserved" or "proposed" (for an apply that happened before the file lands: "reserved; applied <hh:mmZ> (<date>), file lands with its PR"), or say "n/a".`,
        );
      }
    }
  }
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.number)) problems.push(`${REGISTER} has two rows for ${r.number}. Keep one: a number has one row.`);
    seen.add(r.number);
  }
  return problems;
}

describe("registerProblems (synthetic cases, independent of the repo's state)", () => {
  const row = (number: string, production: string, preview: string = production): Row => ({ number, production, preview });

  it("a reserved row with no file passes", () => {
    expect(registerProblems([row("0208", "applied 15:33Z"), row("0209", "reserved")], ["0208"])).toEqual([]);
  });
  it("a proposed row with no file passes", () => {
    expect(registerProblems([row("0208", "applied 15:33Z"), row("0209", "proposed")], ["0208"])).toEqual([]);
  });
  it("a row that says n/a with no file passes", () => {
    expect(registerProblems([row("0208", "applied 15:33Z"), row("0209", "applied: n/a, already live on production")], ["0208"])).toEqual([]);
  });
  it("a row that says applied with no file fails, and says what to add", () => {
    const p = registerProblems([row("0208", "applied 15:33Z"), row("0299", "applied 10:00Z", "reserved")], ["0208"]);
    expect(p).toHaveLength(1);
    expect(p[0]).toContain("0299");
    expect(p[0]).toContain("Add the file in this PR");
  });
  it("a file with no row fails, and says which row to add and where", () => {
    const p = registerProblems([row("0208", "applied 15:33Z")], ["0208", "0210"]);
    expect(p).toHaveLength(1);
    expect(p[0]).toContain("supabase/migrations/0210_*.sql");
    expect(p[0]).toContain("Add a row in this PR");
    expect(p[0]).toContain("section 2");
  });
  it("files below the first register row are not required to have a row", () => {
    expect(registerProblems([row("0208", "applied 15:33Z")], ["0100", "0207", "0208"])).toEqual([]);
  });
  it("two rows for one number fail", () => {
    const p = registerProblems([row("0208", "applied 15:33Z"), row("0208", "applied 15:34Z")], ["0208"]);
    expect(p.join("\n")).toContain("two rows for 0208");
  });
});

describe("registerProblems: the wording at each stage of a migration", () => {
  const row = (number: string, production: string, preview: string = production): Row => ({ number, production, preview });
  const base = row("0208", "applied 15:33Z");
  const PENDING = "reserved; applied 10:00Z (5 Oct), file lands with its PR";

  it("stage 1, before any apply: reserved with no file passes", () => {
    expect(registerProblems([base, row("0223", "reserved")], ["0208"])).toEqual([]);
  });
  it("stage 2/3, applied on a hosted project with the file still only on a branch: the pending wording passes", () => {
    expect(registerProblems([base, row("0223", PENDING)], ["0208"])).toEqual([]);
  });
  it("applied, with the file only on a branch (so not in this tree), fails: it must use the pending wording", () => {
    const p = registerProblems([base, row("0223", "applied 10:00Z (5 Oct)", "reserved")], ["0208"]);
    expect(p).toHaveLength(1);
    expect(p[0]).toContain("0223");
  });
  it("a row whose production cell is held but whose preview cell says applied, with no file, fails", () => {
    const p = registerProblems([base, row("0223", "reserved", "applied 10:05Z (5 Oct)")], ["0208"]);
    expect(p).toHaveLength(1);
    expect(p[0]).toContain("talentrah-preview cell");
  });
  it("stage 4, merged: applied with the file on main passes", () => {
    expect(registerProblems([base, row("0223", "applied 10:00Z (5 Oct)")], ["0208", "0223"])).toEqual([]);
  });
  it('"applied: n/a" with no file passes (a number that needs no apply)', () => {
    expect(registerProblems([base, row("0221", "applied: n/a, nothing to apply")], ["0208"])).toEqual([]);
  });
  it('the word "applied" later in the cell does not rescue a row that starts with it and has no file', () => {
    expect(registerProblems([base, row("0223", "applied 10:00Z, reserved earlier", "reserved")], ["0208"])).toHaveLength(1);
  });
});

describe("registerProblems: a file in the tree and the row's cells", () => {
  const row = (number: string, production: string, preview: string = production): Row => ({ number, production, preview });
  const base = row("0208", "applied 15:33Z");

  it("a row still reserved in both cells while its file is in the tree fails, and says to flip the row", () => {
    const p = registerProblems([base, row("0223", "reserved")], ["0208", "0223"]);
    expect(p).toHaveLength(1);
    expect(p[0]).toContain("flip your own row");
  });
  it("a row still proposed in both cells while its file is in the tree fails", () => {
    expect(registerProblems([base, row("0223", "proposed")], ["0208", "0223"])).toHaveLength(1);
  });
  it("the pending wording left in place after the file landed fails", () => {
    const pending = "reserved; applied 10:00Z (5 Oct), file lands with its PR";
    expect(registerProblems([base, row("0223", pending)], ["0208", "0223"])).toHaveLength(1);
  });
  it("production applied with the file in the tree and preview reserved passes", () => {
    expect(registerProblems([base, row("0223", "applied 10:00Z (5 Oct)", "reserved")], ["0208", "0223"])).toEqual([]);
  });
  it("both cells applied with the file in the same PR passes", () => {
    expect(registerProblems([base, row("0223", "applied 10:00Z (5 Oct)", "applied 10:05Z (5 Oct)")], ["0208", "0223"])).toEqual([]);
  });
  it('"merged, not applied" with the file in the tree passes (a file that merges before its apply)', () => {
    expect(registerProblems([base, row("0223", "merged, not applied")], ["0208", "0223"])).toEqual([]);
  });
});

describe("hashProblems (a quoted sha256 must match its file when the file is in the tree)", () => {
  const body = Buffer.from("select 1;\n");
  const good = createHash("sha256").update(body).digest("hex");
  const rowWith = (hash: string): Row => ({
    number: "0223",
    production: "reserved",
    preview: "reserved",
    heldBy: `S3, a thing (\`supabase/migrations/0223_x.sql\`, sha256 \`${hash}\`; additive)`,
  });

  it("a file that hashes to the quoted value passes", () => {
    expect(hashProblems([rowWith(good)], () => body)).toEqual([]);
  });
  it("a file that hashes differently fails, naming both hashes and what to do", () => {
    const p = hashProblems([rowWith("0".repeat(64))], () => body);
    expect(p).toHaveLength(1);
    expect(p[0]).toContain(good);
    expect(p[0]).toContain("restore that file");
  });
  it("plain wording without backticks is checked too (the 0225 row's form)", () => {
    const plain: Row = { number: "0225", production: "reserved", preview: "reserved", heldBy: `S3-21, a thing (supabase/migrations/0225_x.sql, sha256 ${good}; file not yet pushed)` };
    expect(hashProblems([plain], () => body)).toEqual([]);
    expect(hashProblems([{ ...plain, heldBy: plain.heldBy!.replace(good, "0".repeat(64)) }], () => body)).toHaveLength(1);
  });
  it("a file that is not in the tree is not checked", () => {
    expect(hashProblems([rowWith("0".repeat(64))], () => null)).toEqual([]);
  });
  it("a row that quotes no hash is not checked", () => {
    expect(hashProblems([{ number: "0224", production: "reserved", preview: "reserved", heldBy: "S3-21, a thing" }], () => body)).toEqual([]);
  });
  it("an upper-case quoted hash is compared case-insensitively", () => {
    expect(hashProblems([rowWith(good.toUpperCase())], () => body)).toEqual([]);
  });
});

describe("hashProblems edge cases", () => {
  const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
  const mig = Buffer.from("select 1;\n");
  const down = Buffer.from("select 2;\n");
  const files: Record<string, Buffer> = {
    "supabase/migrations/0226_x.sql": mig,
    "supabase/rollbacks/0226_x_down.sql": down,
    "supabase/migrations/0226_y.sql": Buffer.from("select 3;\n"),
  };
  const read = (p: string) => files[p] ?? null;
  const row = (heldBy: string): Row => ({ number: "0226", production: "reserved", preview: "reserved", heldBy });
  const Z = "0".repeat(64);

  it("two hashes in one row (migration and rollback): both match, passes", () => {
    const h = `S1, a thing (supabase/migrations/0226_x.sql, sha256 ${sha(mig)}; rollback supabase/rollbacks/0226_x_down.sql, sha256 ${sha(down)})`;
    expect(hashProblems([row(h)], read)).toEqual([]);
  });
  it("two hashes in one row: only the rollback differs, so only the rollback is reported", () => {
    const h = `S1, a thing (supabase/migrations/0226_x.sql, sha256 ${sha(mig)}; rollback supabase/rollbacks/0226_x_down.sql, sha256 ${Z})`;
    const p = hashProblems([row(h)], read);
    expect(p).toHaveLength(1);
    expect(p[0]).toContain("supabase/rollbacks/0226_x_down.sql");
    expect(p[0]).not.toContain("supabase/migrations/0226_x.sql");
  });
  it("a hash with no file path is ignored", () => {
    expect(hashProblems([row(`S1, a thing (reviewed, sha256 ${Z})`)], read)).toEqual([]);
  });
  it("a hash that belongs to something else in the same sentence is ignored: the apply statement after a semicolon", () => {
    expect(hashProblems([row(`S1, a thing (supabase/migrations/0226_x.sql was reviewed; the apply statement sha256 ${Z})`)], read)).toEqual([]);
  });
  it("a hash that belongs to something else: words between the path and the hash", () => {
    expect(hashProblems([row(`S1, a thing (supabase/migrations/0226_x.sql, applied statement sha256 ${Z})`)], read)).toEqual([]);
  });
  it("a hash after a path that is not a migration or rollback (a data fix) is ignored", () => {
    expect(hashProblems([row(`S1, a thing (data fix supabase/data-fixes/f.sql, sha256 ${Z})`)], read)).toEqual([]);
  });
  it("backticked and plain wording side by side: each pair is checked on its own", () => {
    const ok = `S1, a thing (\`supabase/migrations/0226_x.sql\`, sha256 \`${sha(mig)}\`; supabase/migrations/0226_y.sql, sha256 ${sha(files["supabase/migrations/0226_y.sql"])})`;
    expect(hashProblems([row(ok)], read)).toEqual([]);
    const bad = `S1, a thing (\`supabase/migrations/0226_x.sql\`, sha256 \`${sha(mig)}\`; supabase/migrations/0226_y.sql, sha256 ${Z})`;
    const p = hashProblems([row(bad)], read);
    expect(p).toHaveLength(1);
    expect(p[0]).toContain("0226_y.sql");
  });
});

describe("parseRegister (the guard must not pass on nothing)", () => {
  const table = (rows: string[]) => `${HEADING}\n\n| Number | Held by | Production | talentrah-preview |\n|---|---|---|---|\n${rows.join("\n")}\n\n## 3. next\n`;
  const ok = "| 0208 | S1, a thing | applied 15:33Z | applied 15:40Z |";

  it("parses a well-formed table", () => {
    const r = parseRegister(table([ok, "| 0209 | S3, a thing | reserved | reserved |"]));
    expect(r.problems).toEqual([]);
    expect(r.rows.map((x) => x.number)).toEqual(["0208", "0209"]);
  });
  it("zero rows is a problem, with a message", () => {
    const r = parseRegister(table([]));
    expect(r.problems.join("\n")).toContain("No register rows were parsed");
  });
  it("a missing table header is a problem, with a message", () => {
    const r = parseRegister(`${HEADING}\n\n${ok}\n`);
    expect(r.problems.join("\n")).toContain("table header");
  });
  it("a row with the wrong number of cells is a problem, with a message, and is not skipped silently", () => {
    const r = parseRegister(table([ok, "| 0209 | S3, a thing | reserved |"]));
    expect(r.problems.join("\n")).toMatch(/row 0209 has 3 cells, expected 4/);
  });
  it("a missing section heading is a problem, with a message", () => {
    expect(parseRegister("# nothing here\n").problems.join("\n")).toContain("heading");
  });
});

describe("the real register and the real migrations directory agree", () => {
  // DOCS_ROOT exists only to show this test red against a changed copy. It must never be set where the result is trusted: in CI the
  // test always reads the checkout it runs in.
  if (process.env.CI && process.env.DOCS_ROOT) {
    throw new Error("DOCS_ROOT is set in CI. Unset it: this test must read the real checkout there.");
  }
  const root = process.env.DOCS_ROOT ?? process.cwd();
  const parsed = parseRegister(readFileSync(path.join(root, REGISTER), "utf8"));
  const rows = parsed.rows;
  const numbers = new Set<string>();
  for (const f of readdirSync(path.join(root, "supabase/migrations"))) {
    const m = /^(\d{4})_.+\.sql$/.exec(f);
    if (m) numbers.add(m[1]);
  }
  const files = [...numbers].sort();

  it("both were read (so the checks below are not vacuous)", () => {
    expect(rows.length).toBeGreaterThan(5);
    expect(files.length).toBeGreaterThan(5);
  });

  it("the table parsed cleanly", () => {
    expect(parsed.problems, "\n" + parsed.problems.join("\n")).toEqual([]);
  });

  it("every quoted sha256 matches its file when the file is in the tree", () => {
    const read = (rel: string) => (existsSync(path.join(root, rel)) ? readFileSync(path.join(root, rel)) : null);
    const p = hashProblems(rows, read);
    expect(p, "\n" + p.join("\n")).toEqual([]);
  });

  it("no problems", () => {
    expect(registerProblems(rows, files), "\n" + registerProblems(rows, files).join("\n")).toEqual([]);
  });
});
