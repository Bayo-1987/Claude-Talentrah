/**
 * The mentor apply page and its actions read only columns the signed-in role may SELECT (S1-93).
 *
 * Migration 0225 withdrew table-wide SELECT on public.mentor_profiles from the API roles and granted these eleven columns. A session-client read of any other column
 * fails 42501 (for the page, an error screen rather than an empty form). The nine withheld columns (applied_at, reviewed_at, reviewed_by, review_note, the five payout
 * columns) are read on the server with the service role only, as readOwnReviewNote and getOwnPayoutDetails do.
 *
 * Pure source scan, no database. The list below is the migration's own list; if a column is granted later, add it here in the same change.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const GRANTED = [
  "user_id",
  "status",
  "self_paused",
  "display_name",
  "bio",
  "expertise_roles",
  "expertise_industries",
  "expertise_seniority",
  "years_experience",
  "base_price_ngn",
  "reviews_verifications",
] as const;
const WITHHELD = ["applied_at", "reviewed_at", "reviewed_by", "review_note", "payout_bank_code", "payout_account_number", "payout_account_name", "payout_recipient_code", "payout_bank_verified_at"];

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/** Every column a `.from("mentor_profiles")` call selects or filters on, for the calls made with the SESSION client (service-role calls are the sanctioned way to read the rest). */
function sessionReads(source: string): Array<{ columns: string[]; at: string }> {
  const out: Array<{ columns: string[]; at: string }> = [];
  const marker = '.from("mentor_profiles")';
  let from = 0;
  for (;;) {
    const i = source.indexOf(marker, from);
    if (i < 0) break;
    from = i + marker.length;
    const before = source.slice(Math.max(0, i - 90), i);
    if (/createServiceRoleClient\(\)\s*$/.test(before.trimEnd()) || /service/i.test(before.split("\n").slice(-2).join(" "))) continue;
    const end = source.indexOf(";", i);
    const stmt = source.slice(i, end < 0 ? i + 700 : end);
    const columns: string[] = [];
    for (const m of stmt.matchAll(/\.select\(\s*"([^"]+)"/g)) {
      // Drop embedded relations such as `profiles!fk(first_name)`, whose columns belong to another table.
      const flat = m[1].replace(/[a-z_]+!?[a-z_]*\([^)]*\)/g, "");
      columns.push(...flat.split(",").map((c) => c.trim()).filter(Boolean));
    }
    for (const m of stmt.matchAll(/\.(?:eq|neq|in|order|is|gt|lt)\(\s*"([a-z_]+)"/g)) columns.push(m[1]);
    out.push({ columns, at: stmt.slice(0, 60).replace(/\s+/g, " ") });
  }
  return out;
}

function functionBody(source: string, name: string): string {
  const start = source.indexOf(`export async function ${name}`);
  if (start < 0) throw new Error(`${name} not found`);
  const end = source.indexOf("\n}\n", start);
  return source.slice(start, end + 3);
}

describe("the apply page reads only granted columns (0225)", () => {
  it("the guard's own list is the eleven columns and none of the nine withheld", () => {
    expect(GRANTED).toHaveLength(11);
    expect(GRANTED.filter((c) => WITHHELD.includes(c))).toEqual([]);
  });

  it("getOwnMentorProfile selects, and filters on, only granted columns", () => {
    const body = functionBody(read("src/lib/mentorship/queries.ts"), "getOwnMentorProfile");
    expect(body).toContain('.from("mentor_profiles")');
    const reads = sessionReads(body);
    expect(reads, "the scan found no session read in getOwnMentorProfile, so it proves nothing").toHaveLength(1);
    const outside = reads[0].columns.filter((c) => !(GRANTED as readonly string[]).includes(c));
    expect(outside, "a column outside the eleven granted ones is read with the session client").toEqual([]);
    // It does read the columns the form needs, so the guard is not passing on an empty select.
    for (const c of ["status", "display_name", "bio", "expertise_roles", "expertise_industries", "years_experience", "base_price_ngn", "reviews_verifications", "self_paused", "user_id"]) {
      expect(reads[0].columns, `getOwnMentorProfile no longer reads ${c}`).toContain(c);
    }
  });

  it("the withheld columns are read only through the service role in queries.ts (reviewer note, payout details)", () => {
    const src = read("src/lib/mentorship/queries.ts");
    const sessionColumns = sessionReads(src).flatMap((r) => r.columns);
    expect(sessionColumns.filter((c) => WITHHELD.includes(c)), "a withheld column is read with the session client").toEqual([]);
  });

  it("every mentor_profiles call in the mentorship actions selects or filters only granted columns", () => {
    const reads = sessionReads(read("src/lib/mentorship/actions.ts"));
    expect(reads.length, "the scan found no mentor_profiles call in actions.ts, so it proves nothing").toBeGreaterThanOrEqual(4);
    for (const r of reads) {
      const outside = r.columns.filter((c) => !(GRANTED as readonly string[]).includes(c));
      expect(outside, `actions.ts ${r.at}`).toEqual([]);
    }
  });

  it("nothing under the apply route reads mentor_profiles directly (the page goes through the query functions)", () => {
    const dir = join(ROOT, "src/app/(app)/mentorship/apply");
    const files = readdirSync(dir).filter((f) => /\.tsx?$/.test(f) && statSync(join(dir, f)).isFile());
    expect(files.length).toBeGreaterThan(3);
    for (const f of files) expect(readFileSync(join(dir, f), "utf8"), f).not.toContain('from("mentor_profiles")');
  });
});
