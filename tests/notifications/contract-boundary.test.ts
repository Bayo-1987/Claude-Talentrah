import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { NOTIFICATION_RPCS, NOTIFICATION_TABLES } from "@/lib/notifications/contract-db";
import {
  buildNamePattern,
  describeHits,
  isAllowed,
  scanTree,
  type Allowlist,
} from "./contract-boundary-scan";

/**
 * THE BOUNDARY. The new tables and functions are named in ONE file
 * (`contract-db.ts`) and reached only through its accessors. Everything else in
 * `src/` and `tests/` is scanned, the contract, the fakes and this test
 * included, so a name appears nowhere else.
 *
 * The list of names is built from the constants the accessor module exports.
 * This file never spells one, or it would fail on itself.
 *
 * The allowlist is explicit and nothing else is excused: the accessor module,
 * the generated types, the migrations, and the two database test folders (they
 * talk to a real database and have to name its objects).
 */
const ROOT = path.resolve(__dirname, "..", "..");
const ALLOWLIST: Allowlist = {
  files: ["src/lib/notifications/contract-db.ts", "src/lib/supabase/types.ts"],
  dirs: ["supabase/migrations/", "tests/rls/", "tests/supabase/"],
};
const NAMES: string[] = [...Object.values(NOTIFICATION_TABLES), ...Object.values(NOTIFICATION_RPCS)];

describe("notifications contract boundary: the real tree", () => {
  it("builds its name list from the accessor module's constants", () => {
    expect(NAMES.length).toBe(Object.keys(NOTIFICATION_TABLES).length + Object.keys(NOTIFICATION_RPCS).length);
    expect(new Set(NAMES).size).toBe(NAMES.length);
  });

  it("no file outside the allowlist spells a new table or function name", () => {
    const { hits, scanned } = scanTree(ROOT, ["src", "tests"], NAMES, ALLOWLIST);
    // A scan that read nothing would pass for the wrong reason.
    expect(scanned).toBeGreaterThan(500);
    expect(describeHits(hits)).toBe("");
  });

  it("every allowlisted path exists, so the allowlist cannot quietly excuse a path that is gone", () => {
    for (const file of ALLOWLIST.files) expect(existsSync(path.join(ROOT, file))).toBe(true);
    for (const dir of ALLOWLIST.dirs) expect(existsSync(path.join(ROOT, dir))).toBe(true);
  });
});

describe("notifications contract boundary: the scanner has teeth", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "contract-boundary-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const table = NOTIFICATION_TABLES.deliveries;
  const rpc = NOTIFICATION_RPCS.claimNotification;
  const put = (relative: string, text: string) => {
    mkdirSync(path.dirname(path.join(dir, relative)), { recursive: true });
    writeFileSync(path.join(dir, relative), text);
  };

  put("src/lib/a.ts", `export const x = client.from("${table}");\n`);
  put("src/lib/comment.ts", `// reads ${table} directly\n`);
  put("src/lib/template.ts", "export const y = `${prefix}" + rpc + "`;\n");
  put("tests/other/uses-rpc.test.ts", `rpc('${rpc}', {});\n`);
  put("tests/rls/db.test.ts", `from("${table}"); rpc("${rpc}");\n`);
  put("tests/supabase/db.test.ts", `from("${table}");\n`);
  put("src/lib/notifications/contract-db.ts", `"${table}" "${rpc}"\n`);
  put("src/lib/clean.ts", `const notification_deliveries_archive_x = 1; const my${table}er = 2;\n`);

  const result = scanTree(dir, ["src", "tests"], NAMES, ALLOWLIST);
  const flagged = new Set(result.hits.map((hit) => hit.file));

  it("flags a name in a call, a comment, a template and a test outside the database folders", () => {
    expect(flagged).toContain("src/lib/a.ts");
    expect(flagged).toContain("src/lib/comment.ts");
    expect(flagged).toContain("src/lib/template.ts");
    expect(flagged).toContain("tests/other/uses-rpc.test.ts");
  });

  it("excuses exactly the allowlist: the accessor module and the two database test folders", () => {
    expect(flagged).not.toContain("src/lib/notifications/contract-db.ts");
    expect(flagged).not.toContain("tests/rls/db.test.ts");
    expect(flagged).not.toContain("tests/supabase/db.test.ts");
  });

  it("matches whole words only, so a longer identifier that contains a name is not a hit", () => {
    expect(flagged).not.toContain("src/lib/clean.ts");
  });

  it("reports the file, the line and the name", () => {
    const hit = result.hits.find((h) => h.file === "src/lib/a.ts");
    expect(hit).toEqual({ file: "src/lib/a.ts", line: 1, name: table });
  });

  it("refuses an empty name list instead of matching nothing", () => {
    expect(() => buildNamePattern([])).toThrow();
  });

  it("isAllowed uses exact files and directory prefixes", () => {
    expect(isAllowed("tests/rls/x.test.ts", ALLOWLIST)).toBe(true);
    expect(isAllowed("tests/rlsx/x.test.ts", ALLOWLIST)).toBe(false);
    expect(isAllowed("src/lib/notifications/contract-db.ts.bak", ALLOWLIST)).toBe(false);
  });
});
