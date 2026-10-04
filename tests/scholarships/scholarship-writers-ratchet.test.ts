/**
 * #704 (gap C) — nothing may edit a scholarship's public text, or publish one, except the paths listed here. Each entry says why it cannot carry reviewer
 * commentary into a public column. A new writer fails this test until someone decides, in a diff, which of the two it is: guarded, or covered another way.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CHECKED_PUBLIC_TEXT_COLUMNS, EXCLUDED_PUBLIC_TEXT_COLUMNS } from "@/lib/scholarships/reviewer-commentary";

/** file → why it may write. Hand-run data fixes (SQL through the connector) are not code; their rule is the RECORD in tests/supabase/data-fixes.test.ts. */
const ALLOWED_WRITERS: Record<string, string> = {
  "src/lib/scholarships/ingest.ts":
    "Ingest: a NEW row lands pending, or auto-publishes only from the source config (checked by reviewer-commentary.test.ts); a CHANGED row on a verified listing returns to pending and so needs approval again; the expiry sweep only rejects.",
  "src/lib/admin/moderation/actions.ts":
    "The approval path: the one place a pending listing becomes verified (admin_moderate_scholarship), behind the reviewer-commentary guard; it writes status and note only, never public text.",
  "scripts/seed-catalog.ts": "Dev and CI catalogue seed: publishes only the source config, which reviewer-commentary.test.ts checks field by field.",
  "scripts/seed.ts": "Dev and CI seed: sets status and note on config rows only; adds no public text.",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const WRITE = /from\(\s*["']scholarships["']\s*\)[\s\S]{0,400}?\.(insert|update|upsert|delete)\(|rpc\(\s*["']admin_moderate_scholarship["']/;
const writers = [...walk("src"), ...walk("scripts")].filter((f) => WRITE.test(readFileSync(f, "utf8"))).sort();

describe("who writes scholarships", () => {
  it("finds the known writers (the scan is not vacuous)", () => {
    expect(writers).toContain("src/lib/scholarships/ingest.ts");
    expect(writers).toContain("src/lib/admin/moderation/actions.ts");
  });

  it("every writer is on the allowlist, and every allowlist entry still writes", () => {
    expect(writers).toEqual(Object.keys(ALLOWED_WRITERS).sort());
  });

  it("every allowlist entry says why", () => {
    for (const [file, why] of Object.entries(ALLOWED_WRITERS)) expect(why.length, file).toBeGreaterThan(30);
  });

  it("the columns ingest writes are all accounted for by the shared list (checked, or excluded with a reason, or not text)", () => {
    const types = readFileSync("src/lib/supabase/types.ts", "utf8");
    const row = types.split("scholarships: {")[1].split("Insert:")[0];
    const text = new Set([...row.matchAll(/^\s+([a-z_]+): string(?:\[\])?(?: \| null)?$/gm)].map((m) => m[1]));
    const written = [...readFileSync("src/lib/scholarships/ingest.ts", "utf8").matchAll(/^\s{4}([a-z_]+): listing\./gm)].map((m) => m[1]);
    expect(written.length).toBeGreaterThan(8);
    const covered = new Set<string>([...CHECKED_PUBLIC_TEXT_COLUMNS, ...Object.keys(EXCLUDED_PUBLIC_TEXT_COLUMNS)]);
    expect(written.filter((c) => text.has(c) && !covered.has(c))).toEqual([]);
  });

  it("the unused, unguarded setModerationStatus is gone (no function, no caller anywhere)", () => {
    const hits = [...walk("src"), ...walk("scripts"), ...walk("tests"), ...walk("e2e")].filter(
      (f) => !f.endsWith("scholarship-writers-ratchet.test.ts") && /setModerationStatus/.test(readFileSync(f, "utf8")),
    );
    expect(hits).toEqual([]);
  });
});
