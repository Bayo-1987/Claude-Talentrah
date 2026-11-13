/**
 * P5 (JOBS-POLISH-1): every writer of a closing date records whether it was STATED (job_postings.expires_at_source, 0278).
 *   - the sheet importer: 'stated' only when the sheet gave a deadline; the 30-day lifetime it applies otherwise is 'default';
 *   - ingest: 'stated' when the source gave a validThrough, else NULL (no date, nothing to state);
 *   - the employer's own writes, through the service role in the same updates that write closing_date_source: 'chosen' is stated, 'default' stays default, and no expiry clears it.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildPlan } from "@/lib/jobs/sheet-import/plan";
import { expiresAtSourceFor } from "@/lib/employer/expiry-input";

const HEADER = ["id", "origin", "method", "title", "company", "location", "salary", "date_posted", "deadline", "summary", "description", "requirements", "qualifications", "apply_email", "apply_phone", "apply_link", "apply_text"];
const quote = (v: string) => `"${v.replace(/"/g, '""')}"`;
const sheet = (rows: Record<string, string>[]) => [HEADER.join(","), ...rows.map((r) => HEADER.map((h) => quote(r[h] ?? "")).join(","))].join("\r\n") + "\r\n";
const row = (n: number, deadline: string) => ({
  id: String(n), origin: "recheck", method: "Link", title: `Role ${n}`, company: `Company ${n}`, location: "Lagos", date_posted: "2 Nov 2026", deadline,
  summary: `Summary ${n}.`, apply_link: `https://careers.example.test/jobs/${n}`, apply_text: `Apply at the link ${n}.`,
});
const NOW = new Date("2026-11-03T12:00:00Z");

describe("the sheet importer", () => {
  const plan = buildPlan(sheet([row(1, "20th November, 2026"), row(2, ""), row(3, "Not Specified")]), { now: NOW });
  const byTitle = (t: string) => plan.items.find((i) => i.insert.title === t)!.insert;

  it("POSITIVE CONTROL: all three rows are planned", () => {
    expect(plan.items).toHaveLength(3);
  });
  it("a row with a deadline in the sheet is 'stated', and its date is that deadline", () => {
    expect(byTitle("Role 1").expires_at_source).toBe("stated");
    expect(byTitle("Role 1").expires_at).toBe("2026-11-20T22:59:59.000Z");
  });
  it("a row with no deadline, or one that cannot be read as a date, is 'default' and gets the 30-day lifetime", () => {
    for (const t of ["Role 2", "Role 3"]) {
      expect(byTitle(t).expires_at_source, t).toBe("default");
      expect(byTitle(t).expires_at, t).toBe(new Date(NOW.getTime() + 30 * 86_400_000).toISOString());
    }
  });
});

describe("ingest", () => {
  // Code only: the comments between the two keys are not part of the claim.
  const src = readFileSync(path.join(process.cwd(), "src/lib/jobs/ingest.ts"), "utf8").replace(/^\s*\/\/.*$/gm, "").replace(/\s+/g, " ");
  it("writes the source in the same upsert row as the date: 'stated' when the source gave one, else null, never omitted", () => {
    expect(src).toContain("expires_at: job.expiresAt ?? null, expires_at_source: job.expiresAt ? \"stated\" : null,");
  });
});

describe("the employer's writes", () => {
  it("map closing_date_source to expires_at_source: chosen is stated, default is default, none is cleared, and 'do not touch' stays untouched", () => {
    expect(expiresAtSourceFor("chosen")).toBe("stated");
    expect(expiresAtSourceFor("default")).toBe("default");
    expect(expiresAtSourceFor(null)).toBeNull();
    expect(expiresAtSourceFor(undefined)).toBeUndefined();
  });
});
