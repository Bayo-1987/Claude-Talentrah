/**
 * JOBS-SHEET-IMPORT-1, Phase 1 (scripts/import-jobs-sheet.ts and scripts/jobs-sheet-import/*). Everything here uses a SYNTHETIC sheet built in the test: no real address, e-mail or phone
 * from the real CSV is in this file (every e-mail below ends in example.test), and no job-board address is written out in full anywhere in the repository: the board names are built from
 * fragments at run time, here and in the code.
 *
 * What is pinned, in the task's words: the parser (e-mail, phone, link, "10th November, 2026.", "N" and per month, "A | B" locations); e-mail and phone carried exactly as written, the
 * misspelt address included; Phase 1 imports exactly the link rows and the e-mail-plus-link rows and no e-mail-only row; insert-only, ON CONFLICT DO NOTHING, never an update; skips
 * counted with a reason, a job already on Talentrah included; llm_enrichment_attempted_at set; the URL rules; no imported address with a tracker, "hnj" or a board name; a batch above 50
 * refused and the first batch a canary of 10; no notification, e-mail or push on insert; link-out only (a real https external_url, so no Apply button inside Talentrah and none pointing at "#");
 * the undo closes exactly this import's rows; and the host-pattern test over every stored field, preview line, log line and new repo file. The database-backed block needs the local stack
 * (like the other database tests) and uses its own import key, so it can never touch a real import's rows.
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { isLinkOutPosting } from "@/lib/jobs/link-out";
import { NOTIFICATION_TABLES } from "@/lib/notifications/contract-db";
import { computeDedupFingerprint } from "@/lib/jobs/dedup";
import {
  batchRows,
  buildPlan,
  CANARY_SIZE,
  insertBatch,
  main,
  MAX_BATCH,
  PROD_CONFIRM_ENV,
  sha256Hex,
  UNDO_CONFIRM,
  renderPreview,
  SOURCE_KEY,
  undoImport,
  type ImportClient,
  type JobInsert,
} from "../../scripts/import-jobs-sheet";
import { applyKind, composeDescription, jobBody, parseCsv, parseDatePosted, parseDeadline, parseSalary, readSheet, splitLocation } from "../../scripts/jobs-sheet-import/parse";
import { BOARD_HOST_PATTERN, cleanApplyUrl, textNamesBoard } from "../../scripts/jobs-sheet-import/url";
import { assignFingerprints } from "../../scripts/jobs-sheet-import/fingerprint";

const ROOT = path.join(__dirname, "../..");
const NEW_FILES = [
  "scripts/import-jobs-sheet.ts",
  "scripts/jobs-sheet-import/parse.ts",
  "scripts/jobs-sheet-import/url.ts",
  "scripts/jobs-sheet-import/fingerprint.ts",
  "tests/scripts/jobs-sheet-import.test.ts",
];

// Board addresses exist in this file only as run-time strings built from fragments.
const BOARD_A = ["hotnigerian", "jobs"].join("");
const BOARD_B = ["myjob", "mag"].join("");
const boardUrl = (n: 1 | 2 = 1, sub = "www") => `https://${sub}.${n === 1 ? BOARD_A : BOARD_B}.com/job/12345`;

const HEADER = ["id", "origin", "method", "title", "company", "location", "salary", "date_posted", "deadline", "summary", "description", "requirements", "qualifications", "apply_email", "apply_phone", "apply_link", "apply_text"];
type Cells = Partial<Record<(typeof HEADER)[number] | "job_link", string>>;
const NOW = new Date("2026-11-03T12:00:00Z");

let seq = 0;
function cells(over: Cells = {}): Cells {
  seq++;
  return {
    id: String(seq), origin: "recheck", method: "Link", title: `Synthetic Role ${seq}`, company: `Synthetic Co ${seq}`, location: "Lagos", salary: "", date_posted: "2 Nov 2026", deadline: "",
    summary: `Summary text ${seq}.`, description: "", requirements: "", qualifications: "", apply_email: "", apply_phone: "", apply_link: `https://careers.example.test/jobs/${seq}`,
    apply_text: `Apply at the link ${seq}.`, ...over,
  };
}
const quote = (v: string) => `"${v.replace(/"/g, '""')}"`;
function csv(rows: Cells[], extra: string[] = []): string {
  const header = [...HEADER, ...extra];
  return [header.join(","), ...rows.map((r) => header.map((h) => quote((r as Record<string, string>)[h] ?? "")).join(","))].join("\r\n") + "\r\n";
}
const linkRow = (over: Cells = {}) => cells({ method: "Link", ...over });
const emailPlusLink = (over: Cells = {}) => cells({ method: "Email", apply_email: "jobs@example.test", apply_text: "Send your CV to jobs@example.test or use the link.", ...over });
const emailOnly = (over: Cells = {}) => cells({ method: "Email", apply_link: "", apply_email: "hr@example.test", apply_text: "Email hr@example.test.", ...over });

describe("the parser", () => {
  it("reads quoted fields, doubled quotes, embedded newlines, CRLF and a byte-order mark", () => {
    const text = `﻿a,b,c\r\n"x, y","say ""hi""","line1\nline2"\r\n1,2,3`;
    expect(parseCsv(text)).toEqual([["a", "b", "c"], ["x, y", 'say "hi"', "line1\nline2"], ["1", "2", "3"]]);
  });

  it("refuses a CSV that lacks a needed column and names it, but accepts empty description and empty location cells", () => {
    expect(() => readSheet("id,title\r\n1,x\r\n")).toThrow(/missing required column\(s\): .*company/);
    const rows = readSheet(csv([linkRow({ description: "", location: "" })]));
    expect(rows).toHaveLength(1);
    expect(rows[0].description).toBe("");
    expect(rows[0].location).toBe("");
  });

  it("the job body is summary + description + requirements + qualifications, in that order, empty parts skipped", () => {
    expect(jobBody({ summary: "S", description: "D", requirements: "R", qualifications: "Q" })).toBe("S\n\nD\n\nR\n\nQ");
    expect(jobBody({ summary: "S", description: "", requirements: "R", qualifications: "" })).toBe("S\n\nR");
    expect(jobBody({ summary: "", description: "", requirements: "", qualifications: "Q" })).toBe("Q");
  });

  it('"A | B" keeps the first location and the rest; an empty location is null', () => {
    expect(splitLocation("Lagos | Abuja | Kano")).toEqual({ first: "Lagos", rest: ["Abuja", "Kano"] });
    expect(splitLocation("Lagos")).toEqual({ first: "Lagos", rest: [] });
    expect(splitLocation("")).toEqual({ first: null, rest: [] });
  });

  it.each([
    ["10th November, 2026", "2026-11-10T22:59:59.000Z"],
    ["10th November, 2026.", "2026-11-10T22:59:59.000Z"],
    ["1st December 2026", "2026-12-01T22:59:59.000Z"],
    ["Monday, 23rd November, 2026", "2026-11-23T22:59:59.000Z"],
  ])("the deadline %j is the END of that day in Lagos", (text, iso) => {
    expect(parseDeadline(text)?.toISOString()).toBe(iso);
  });

  it.each(["Not Specified", "Various", "Various, from 3rd November 2026 to 20th November 2026", "31st February, 2026", ""])("the deadline %j is null (the caller defaults it)", (text) => {
    expect(parseDeadline(text)).toBeNull();
  });

  it('"2 Nov 2026" is the start of that day in Lagos', () => {
    expect(parseDatePosted("2 Nov 2026")?.toISOString()).toBe("2026-11-01T23:00:00.000Z");
    expect(parseDatePosted("nonsense")).toBeNull();
  });

  it.each([
    ["N150,000 - N250,000 monthly", 150000, 250000],
    ["N150,000 – N250,000 Monthly", 150000, 250000],
    ["N250,000 per month", 250000, 250000],
    ["N250,000 / Month", 250000, 250000],
    ["N100,000 - N150,000 / month", 100000, 150000],
  ])("the salary %j parses to NGN per month", (text, min, max) => {
    expect(parseSalary(text)).toEqual({ min, max, currency: "NGN", unit: "month" });
  });

  it.each(["N250,000 per month. Interested candidates should have a degree", "$500 a month", "Negotiable", "N300,000 - N100,000 monthly", ""])("the salary %j does not parse (kept as text)", (text) => {
    expect(parseSalary(text)).toBeNull();
  });

  it("classifies the apply method by the fields the row actually has", () => {
    expect(applyKind({ applyEmail: "", applyPhone: "", applyLink: "https://a.example.test/x" })).toBe("link");
    expect(applyKind({ applyEmail: "a@example.test", applyPhone: "", applyLink: "https://a.example.test/x" })).toBe("email+link");
    expect(applyKind({ applyEmail: "a@example.test", applyPhone: "", applyLink: "" })).toBe("email");
    expect(applyKind({ applyEmail: "", applyPhone: "08000000000", applyLink: "" })).toBe("phone");
    expect(applyKind({ applyEmail: "", applyPhone: "", applyLink: "" })).toBe("none");
  });

  it("an e-mail and a phone number come out exactly as written, the misspelt address included, and nothing is added", () => {
    const row = readSheet(csv([emailPlusLink({ apply_email: "recuitment@example.test", apply_phone: "0800 000 0000", apply_text: "Mail recuitment@example.test or call 0800 000 0000." })]))[0];
    const description = composeDescription(row, [], true);
    expect(description).toContain("recuitment@example.test");
    expect(description).toContain("0800 000 0000");
    expect(description).not.toContain("recruitment@");
    expect(description.match(/[\w.+-]+@[\w.-]+\.\w+/g)).toEqual(["recuitment@example.test"]);
  });

  it("an e-mail or phone missing from the apply text is added on its own line, still as written", () => {
    const row = readSheet(csv([emailPlusLink({ apply_email: "x.y@example.test", apply_phone: "+234 800 000 0000", apply_text: "See the link." })]))[0];
    const description = composeDescription(row, [], true);
    expect(description).toContain("Email: x.y@example.test");
    expect(description).toContain("Phone: +234 800 000 0000");
  });
});

describe("the apply-link rules", () => {
  const ok = (raw: string) => {
    const v = cleanApplyUrl(raw);
    if (!v.ok) throw new Error(`expected accepted, got: ${v.reason}`);
    return v;
  };
  it.each([
    ["http://careers.example.test/job/1", "not https"],
    ["https://192.168.1.10/job", "IP address host"],
    ["https://[::1]/job", "IP address host"],
    ["https://2130706433/job", "IP address host"],
    ["https://bit.ly/abc123", "link shortener"],
    ["https://t.co/abc", "link shortener"],
    ["https://user:secret@careers.example.test/job", "has user info"],
    ["https://careers.example.test:8443/job", "non-standard port"],
    ["https://localhost/job", "not a public host"],
    ["https://intranet/job", "not a public host"],
    ["https://careers.example.test/job https://other.example.test/x", "more than one address, or spaces in it"],
    ["ftp://careers.example.test/job", "not https"],
    ["not a url", "more than one address, or spaces in it"],
    ["", "no link"],
  ])("rejects %j (%s)", (raw, reason) => {
    const v = cleanApplyUrl(raw);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe(reason);
  });

  it("rejects both job boards, any subdomain, with or without www, and a board marker in the address", () => {
    for (const raw of [boardUrl(1), boardUrl(2), boardUrl(1, "jobs"), boardUrl(2, "m"), `https://${BOARD_A}.com/x`, `https://company.example.test/apply?source=hnj`, `https://company.example.test/hnj/apply`]) {
      expect(cleanApplyUrl(raw).ok, "board address must be rejected").toBe(false);
    }
  });

  it("accepts the hosts the sheet uses for forms, as they are", () => {
    for (const raw of ["https://forms.gle/AbCdEf123", "https://docs.google.com/forms/d/e/1FAIpQLSc/viewform", "https://forms.cloud.microsoft/r/AbCdEf", "https://jobs.workable.com/view/abc123/engineer-in-lagos", "https://company.example.test:443/careers"]) {
      expect(ok(raw).url.startsWith("https://")).toBe(true);
    }
    expect(ok("https://forms.gle/AbCdEf123").url).toBe("https://forms.gle/AbCdEf123");
  });

  it("removes fbclid, gclid and utm_* and nothing else, byte for byte", () => {
    const v = ok("https://company.example.test/apply?id=42&utm_source=x&fbclid=abc&ref=a%20b&UTM_Medium=y&gclid=z#section");
    expect(v.url).toBe("https://company.example.test/apply?id=42&ref=a%20b#section");
    expect(v.removed.sort()).toEqual(["UTM_Medium", "fbclid", "gclid", "utm_source"]);
    expect(ok("https://company.example.test/apply?utm_source=x").url).toBe("https://company.example.test/apply");
    expect(ok("https://company.example.test/apply?id=1").url).toBe("https://company.example.test/apply?id=1");
  });
});

describe("Phase 1 imports the link rows and the e-mail-plus-link rows, and nothing else", () => {
  const sheet = () =>
    csv([
      linkRow({ title: "Link A", company: "Co A" }),
      emailOnly({ title: "Email only A", company: "Co B" }),
      emailPlusLink({ title: "Both A", company: "Co C" }),
      linkRow({ title: "Link B", company: "Co D" }),
      emailOnly({ title: "Email only B", company: "Co E" }),
      cells({ method: "Email", apply_link: "", apply_email: "", apply_phone: "08000000000", title: "Phone only", company: "Co F" }),
    ]);

  it("imports exactly the link rows and the e-mail-plus-link row, link rows first", () => {
    const plan = buildPlan(sheet(), { now: NOW });
    expect(plan.items.map((i) => i.insert.title)).toEqual(["Link A", "Link B", "Both A"]);
    expect(plan.counts).toMatchObject({ rows: 6, importable: 3, batches: 1 });
  });

  it("never builds an e-mail-only row, and lists it in the preview with the reason", () => {
    const plan = buildPlan(sheet(), { now: NOW });
    const skipped = plan.preview.filter((p) => p.skipReason !== "");
    expect(skipped.map((p) => p.title).sort()).toEqual(["Email only A", "Email only B", "Phone only"]);
    expect(plan.counts.skippedByReason["email-only row: not built in Phase 1"]).toBe(2);
    expect(plan.counts.skippedByReason["no way to apply"]).toBe(1);
  });

  it("a rejected link skips only that row and is counted with its reason", () => {
    const plan = buildPlan(csv([linkRow({ title: "Good" }), linkRow({ title: "Insecure", apply_link: "http://careers.example.test/x" }), linkRow({ title: "Short", apply_link: "https://bit.ly/x1" })]), { now: NOW });
    expect(plan.items.map((i) => i.insert.title)).toEqual(["Good"]);
    expect(plan.counts.skippedByReason["link rejected: not https"]).toBe(1);
    expect(plan.counts.skippedByReason["link rejected: link shortener"]).toBe(1);
  });

  it("a row whose deadline has already passed is skipped with a reason", () => {
    const plan = buildPlan(csv([linkRow({ title: "Late", deadline: "1st November, 2026" }), linkRow({ title: "On time", deadline: "20th November, 2026" })]), { now: NOW });
    expect(plan.items.map((i) => i.insert.title)).toEqual(["On time"]);
    expect(plan.counts.skippedByReason["deadline already passed"]).toBe(1);
  });

  it("a row missing title or company is skipped, not guessed", () => {
    const plan = buildPlan(csv([linkRow({ title: "", company: "X" }), linkRow({ title: "Y", company: "" })]), { now: NOW });
    expect(plan.items).toHaveLength(0);
    expect(plan.counts.skippedByReason["missing title or company"]).toBe(2);
  });
});

describe("the rows it would insert", () => {
  const row = (over: Cells = {}) => buildPlan(csv([linkRow(over)]), { now: NOW }).items[0].insert;

  it("is link-out with a real https apply address: no Apply button inside Talentrah, no applicant count, and no button pointing at '#'", () => {
    const r = row();
    expect(r.source_type).toBe("external");
    expect(r.organization_id).toBeNull();
    expect(isLinkOutPosting({ source_type: r.source_type })).toBe(true);
    expect(r.external_url).toMatch(/^https:\/\/[^\s]+$/);
    expect(r.status).toBe("open");
  });

  it("carries the import key, the fingerprint ingest would compute, and llm_enrichment_attempted_at set to the import time", () => {
    const r = row({ title: "Accountant", company: "Acme", location: "Lagos | Abuja" });
    expect(r.external_source).toBe(SOURCE_KEY);
    expect(SOURCE_KEY.startsWith("manual-")).toBe(true);
    expect(r.dedup_fingerprint).toBe(computeDedupFingerprint("Acme", "Accountant", "Lagos"));
    expect(r.llm_enrichment_attempted_at).toBe(NOW.toISOString());
    expect(r.last_checked_at).toBe(NOW.toISOString());
  });

  it("maps location, other locations, salary, dates and the source line", () => {
    const r = row({ location: "Lagos | Abuja", salary: "N150,000 - N250,000 monthly", deadline: "20th November, 2026", date_posted: "2 Nov 2026" });
    expect(r.location).toBe("Lagos");
    expect(r.description).toContain("Other locations: Abuja");
    expect([r.salary_min, r.salary_max, r.salary_currency, r.salary_unit]).toEqual([150000, 250000, "NGN", "month"]);
    expect(r.expires_at).toBe("2026-11-20T22:59:59.000Z");
    expect(r.posted_at).toBe("2026-11-01T23:00:00.000Z");
    expect(r.description.trim().endsWith("Listed from public job boards")).toBe(true);
  });

  it("with no deadline the row expires 30 days after the import; with an unparsed salary the text stays in the description", () => {
    const r = row({ deadline: "Not Specified", salary: "Negotiable" });
    expect(r.expires_at).toBe(new Date(NOW.getTime() + 30 * 86400000).toISOString());
    expect([r.salary_min, r.salary_max, r.salary_currency, r.salary_unit]).toEqual([null, null, null, null]);
    expect(r.description).toContain("Salary: Negotiable");
  });

  it("an empty location is stored as null and an empty description is not an error", () => {
    const r = row({ location: "", description: "" });
    expect(r.location).toBeNull();
    expect(r.description.length).toBeGreaterThan(20);
  });

  it("no imported address contains a tracker, the hnj marker or a board name", () => {
    const plan = buildPlan(csv([linkRow({ apply_link: "https://company.example.test/apply?utm_source=hnjx&fbclid=1&id=7" }), linkRow({ apply_link: "https://company.example.test/hnj/apply" })]), { now: NOW });
    for (const i of plan.items) {
      expect(i.insert.external_url).not.toMatch(/utm_|fbclid|gclid/i);
      expect(textNamesBoard(i.insert.external_url)).toBe(false);
    }
    expect(plan.items).toHaveLength(1);
  });
});

describe("identity and duplicates", () => {
  it("the same title + company + apply address twice is one job; the same title + company with another apply address is a second job", () => {
    const plan = buildPlan(
      csv([
        linkRow({ title: "Engineer", company: "Acme", location: "Lagos", apply_link: "https://acme.example.test/1" }),
        linkRow({ title: "Engineer", company: "Acme", location: "Lagos", apply_link: "https://acme.example.test/1" }),
        linkRow({ title: "Engineer", company: "Acme", location: "Lagos", apply_link: "https://acme.example.test/2" }),
      ]),
      { now: NOW },
    );
    expect(plan.items).toHaveLength(2);
    expect(new Set(plan.items.map((i) => i.insert.dedup_fingerprint)).size).toBe(2);
    expect(plan.counts.skippedByReason["duplicate of an earlier row in this import"]).toBe(1);
  });

  it("fingerprints are deterministic and the first of a group keeps the plain ingest fingerprint", () => {
    const input = [{ company: "Acme", title: "Engineer", location: "Lagos", applyKey: "https://a.example.test/1" }, { company: "Acme", title: "Engineer", location: "Lagos", applyKey: "https://a.example.test/2" }];
    const a = assignFingerprints(input);
    const b = assignFingerprints(input);
    expect(a).toEqual(b);
    expect(a[0].fingerprint).toBe(computeDedupFingerprint("Acme", "Engineer", "Lagos"));
    expect(a[1].fingerprint).not.toBe(a[0].fingerprint);
  });

  it("a job already on Talentrah (a known fingerprint) is skipped and counted with its reason", () => {
    const sheet = csv([linkRow({ title: "Engineer", company: "Acme", location: "Lagos" }), linkRow({ title: "New", company: "Beta" })]);
    const existing = new Set([computeDedupFingerprint("Acme", "Engineer", "Lagos")]);
    const plan = buildPlan(sheet, { now: NOW, existingFingerprints: existing });
    expect(plan.items.map((i) => i.insert.title)).toEqual(["New"]);
    expect(plan.counts.skippedByReason["already on Talentrah (same fingerprint)"]).toBe(1);
  });
});

describe("batches: a canary of 10, then 50 or fewer; a batch above 50 is refused", () => {
  const many = (n: number) => csv(Array.from({ length: n }, (_, i) => linkRow({ title: `Bulk ${i}`, company: `Bulk Co ${i}` })));

  it("276 importable rows make a canary of 10, five batches of 50 and a last batch of 16", () => {
    const plan = buildPlan(many(276), { now: NOW });
    const sizes = new Map<number, number>();
    for (const i of plan.items) sizes.set(i.batch, (sizes.get(i.batch) ?? 0) + 1);
    expect([...sizes.entries()]).toEqual([[1, 10], [2, 50], [3, 50], [4, 50], [5, 50], [6, 50], [7, 16]]);
    expect(CANARY_SIZE).toBe(10);
    expect(MAX_BATCH).toBe(50);
  });

  it("no planned batch exceeds 50", () => {
    for (const n of [1, 10, 11, 60, 61, 276]) {
      const sizes = new Map<number, number>();
      for (const i of buildPlan(many(n), { now: NOW }).items) sizes.set(i.batch, (sizes.get(i.batch) ?? 0) + 1);
      expect(Math.max(...sizes.values())).toBeLessThanOrEqual(50);
    }
  });

  it("insertBatch refuses 51 rows before anything is sent", async () => {
    const calls: string[] = [];
    const client = fakeClient(calls, () => []);
    const rows = buildPlan(many(60), { now: NOW }).items.map((i) => i.insert);
    await expect(insertBatch(client, rows.slice(0, 51))).rejects.toThrow(/limit is 50/);
    expect(calls).toEqual([]);
  });
});

/** A fake client that records the calls the importer makes and answers `returned` rows for an upsert. */
function fakeClient(calls: string[], returned: (rows: JobInsert[]) => Array<{ id: string }>, seen: { upsert?: unknown; update?: Record<string, unknown>; filters?: string[] } = {}): ImportClient {
  return {
    from: () => ({
      upsert(rows, options) {
        calls.push("upsert");
        seen.upsert = options;
        return { select: () => Promise.resolve({ data: returned(rows), error: null }) };
      },
      select: () => ({ in: () => Promise.resolve({ data: [], error: null }) }),
      update(values) {
        calls.push("update");
        seen.update = values;
        seen.filters = [];
        const chain = {
          eq(column: string, value: string) {
            seen.filters!.push(`${column}=${value}`);
            return chain;
          },
          select: () => Promise.resolve({ data: [{ id: "a" }, { id: "b" }], error: null }),
        };
        return chain;
      },
    }),
  };
}

describe("insert-only", () => {
  const rows = () => buildPlan(csv([linkRow(), linkRow(), linkRow()]), { now: NOW }).items.map((i) => i.insert);

  it("sends INSERT ... ON CONFLICT (dedup_fingerprint) DO NOTHING and never an update", async () => {
    const calls: string[] = [];
    const seen: { upsert?: unknown } = {};
    const result = await insertBatch(fakeClient(calls, (r) => r.slice(0, 2).map((_, i) => ({ id: String(i) })), seen), rows());
    expect(seen.upsert).toEqual({ onConflict: "dedup_fingerprint", ignoreDuplicates: true });
    expect(calls).toEqual(["upsert"]);
    expect(result).toEqual({ attempted: 3, inserted: 2, skippedExisting: 1 });
  });

  it("an error from the database is thrown, never swallowed", async () => {
    const failing: ImportClient = {
      from: () => ({
        upsert: () => ({ select: () => Promise.resolve({ data: null, error: { message: "boom" } }) }),
        select: () => { throw new Error("no"); },
        update: () => { throw new Error("no"); },
      }),
    };
    await expect(insertBatch(failing, rows())).rejects.toThrow(/boom/);
  });
});

describe("the undo", () => {
  it("closes only open rows of this import's key (status and closed_at only), and reports the count", async () => {
    const calls: string[] = [];
    const seen: { update?: Record<string, unknown>; filters?: string[] } = {};
    const out = await undoImport(fakeClient(calls, () => [], seen), NOW);
    expect(out).toEqual({ closed: 2 });
    expect(seen.update).toEqual({ status: "closed", closed_at: NOW.toISOString() });
    expect(seen.filters!.sort()).toEqual([`external_source=${SOURCE_KEY}`, "source_type=external", "status=open"].sort());
  });
});

describe("the preview file", () => {
  const plan = () => buildPlan(csv([linkRow({ title: "A", company: "X" }), emailOnly({ title: "B", company: "Y" })], ["job_link"]), { now: NOW });

  it("has exactly the agreed columns, one line per CSV row, the batch on importable rows and the reason on skipped ones", () => {
    const lines = renderPreview(plan()).trim().split("\n");
    expect(lines[0]).toBe("title,company,kind,apply_method_type,external_key,batch,skip_reason");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toMatch(/^A,X,link,link,manual-sheet-2026-11-02:[0-9a-f]{12},1,$/);
    expect(lines[2]).toBe("B,Y,email,email,,,email-only row: not built in Phase 1");
  });

  it("holds no address, no e-mail, no phone number and no job-board name", () => {
    const text = renderPreview(buildPlan(csv([linkRow({ apply_phone: "08000000000" }), emailPlusLink(), emailOnly()]), { now: NOW }));
    expect(text).not.toMatch(/@|https?:|08000000000/);
    expect(textNamesBoard(text)).toBe(false);
  });
});

describe("a job-board link is never copied, stored, previewed or logged (host-pattern test)", () => {
  // A hostile sheet: an extra column holding a board address, an apply link that is a board address, and a text that names a board.
  const hostile = csv(
    [
      linkRow({ title: "Clean", company: "Clean Co", job_link: boardUrl(1) }),
      linkRow({ title: "Board link", company: "B Co", apply_link: boardUrl(2), job_link: boardUrl(2) }),
      linkRow({ title: "Board text", company: "T Co", summary: `Originally listed at ${boardUrl(1, "jobs")} on the board.`, job_link: boardUrl(1) }),
    ],
    ["job_link"],
  );
  const tmp: string[] = [];
  afterEach(() => {
    vi.restoreAllMocks();
    for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("no stored field and no preview line of any row matches a board hostname, www or not, http or https", () => {
    const plan = buildPlan(hostile, { now: NOW });
    expect(plan.items.map((i) => i.insert.title)).toEqual(["Clean"]);
    const everything = JSON.stringify(plan.items.map((i) => i.insert)) + renderPreview(plan);
    expect(BOARD_HOST_PATTERN.test(everything)).toBe(false);
    expect(everything).not.toContain("job_link");
    expect(plan.counts.skippedByReason["link rejected: job-board host"]).toBe(1);
    expect(plan.counts.skippedByReason["job-board address in the text"]).toBe(1);
  });

  it("the patterns see every shape (any subdomain, http or https, with or without www)", () => {
    for (const n of [1, 2] as const) for (const sub of ["www", "jobs", "m", "a.b"]) for (const scheme of ["http", "https"]) expect(BOARD_HOST_PATTERN.test(boardUrl(n, sub).replace("https", scheme))).toBe(true);
    expect(BOARD_HOST_PATTERN.test(`${BOARD_A}.com`)).toBe(true);
    expect(BOARD_HOST_PATTERN.test("https://careers.example.test/jobs")).toBe(false);
  });

  it("the dry run's log lines and the only file it writes hold no board name, no e-mail and no row", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "jobs-sheet-"));
    tmp.push(dir);
    const csvPath = path.join(dir, "in.csv");
    const previewPath = path.join(dir, "preview.csv");
    writeFileSync(csvPath, hostile);
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void lines.push(a.join(" ")));
    await main(["--csv", csvPath, "--preview", previewPath]);
    expect(readdirSync(dir).sort()).toEqual(["in.csv", "preview.csv"]);
    const logged = lines.join("\n");
    expect(BOARD_HOST_PATTERN.test(logged)).toBe(false);
    expect(logged).not.toMatch(/@|Clean Co|Synthetic/);
    expect(logged).toMatch(/Rows 3; importable 1/);
    expect(logged).toMatch(/no database was contacted/);
    expect(existsSync(previewPath)).toBe(true);
    expect(BOARD_HOST_PATTERN.test(readFileSync(previewPath, "utf8"))).toBe(false);
  });

  it("no new repo file contains a full job-board address, and none holds an e-mail address except on the synthetic example.test domain", () => {
    for (const f of NEW_FILES) {
      const text = readFileSync(path.join(ROOT, f), "utf8");
      expect(BOARD_HOST_PATTERN.test(text), `${f} must not contain a job-board address`).toBe(false);
      for (const mail of text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? []) expect(mail.endsWith("example.test"), `${f} holds an address that is not on the synthetic example.test domain`).toBe(true);
    }
  });
});

describe("the dry run writes only the preview file, and --apply and --undo refuse production", () => {
  const tmp: string[] = [];
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("a dry run needs no database settings at all", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const dir = mkdtempSync(path.join(tmpdir(), "jobs-sheet-"));
    tmp.push(dir);
    writeFileSync(path.join(dir, "in.csv"), csv([linkRow()]));
    vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(main(["--csv", path.join(dir, "in.csv"), "--preview", path.join(dir, "p.csv")])).resolves.toBeUndefined();
  });

  it.each([["--apply", "--batch", "1"], ["--undo"]])("%j against the production project is refused before any call", async (...args) => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://nytwbbzfpytctjsoczzq.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "placeholder-not-a-key");
    const dir = mkdtempSync(path.join(tmpdir(), "jobs-sheet-"));
    tmp.push(dir);
    writeFileSync(path.join(dir, "in.csv"), csv([linkRow()]));
    vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(main(["--csv", path.join(dir, "in.csv"), ...args])).rejects.toThrow(/refuses to run against production/);
  });

  it("an --apply without a valid --batch is refused", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:1");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "placeholder-not-a-key");
    const dir = mkdtempSync(path.join(tmpdir(), "jobs-sheet-"));
    tmp.push(dir);
    writeFileSync(path.join(dir, "in.csv"), csv([linkRow()]));
    vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(main(["--csv", path.join(dir, "in.csv"), "--apply"])).rejects.toThrow(/Pass --batch/);
    await expect(main(["--csv", path.join(dir, "in.csv"), "--apply", "--batch", "9"])).rejects.toThrow(/Pass --batch/);
  });
});


describe("the guarded production mode (a fake client; nothing real is contacted)", () => {
  const dirs: string[] = [];
  afterEach(() => {
    vi.restoreAllMocks();
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  // The real sheet gives 248 importable rows: batches of 10, 50, 50, 50, 50, 38. A synthetic sheet of that size has the same shape.
  const sheet = csv(Array.from({ length: 248 }, (_, i) => linkRow({ title: `Prod Role ${i}`, company: `Prod Co ${i}` })));
  const plan = buildPlan(sheet, { now: NOW });
  const sha = sha256Hex(sheet);
  const size = (n: number) => batchRows(plan, n).length;
  const fingerprints = (n: number) => batchRows(plan, n).map((i) => i.insert.dedup_fingerprint);
  const confirm = (batch: number, rows = size(batch)) => `${sha.slice(0, 12)}:${batch}:${rows}`;

  function csvFile(text = sheet): string {
    const dir = mkdtempSync(path.join(tmpdir(), "jobs-sheet-prod-"));
    dirs.push(dir);
    writeFileSync(path.join(dir, "in.csv"), text);
    return path.join(dir, "in.csv");
  }

  interface Log {
    calls: string[];
    upserted: JobInsert[];
    selects: Array<{ columns: string; column: string; values: string[] }>;
  }
  /** A fake client: `present` are the fingerprints already in job_postings (under any source). Records every call. */
  function prodClient(present: Iterable<string> = []): { client: ImportClient; log: Log } {
    const have = new Set(present);
    const log: Log = { calls: [], upserted: [], selects: [] };
    const client: ImportClient = {
      from: () => ({
        upsert(rows) {
          log.calls.push("upsert");
          log.upserted.push(...rows);
          return { select: () => Promise.resolve({ data: rows.map((_, i) => ({ id: String(i) })), error: null }) };
        },
        select(columns) {
          log.calls.push("select");
          return {
            in(column, values) {
              log.selects.push({ columns, column, values });
              return Promise.resolve({ data: values.filter((v) => have.has(v)).map((v) => ({ dedup_fingerprint: v })), error: null });
            },
          };
        },
        update() {
          log.calls.push("update");
          throw new Error("an insert run must never update");
        },
      }),
    };
    return { client, log };
  }

  const logged = () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void lines.push(a.join(" ")));
    return lines;
  };
  const run = (args: string[], env: Record<string, string | undefined>, client?: ImportClient) => main(args, { client, env, now: NOW });
  const apply = (batch: number | string) => ["--csv", csvFile(), "--apply", "--production", "--batch", String(batch)];

  it("the synthetic sheet has the real shape: 6 batches, a canary of 10, none above 50", () => {
    expect([1, 2, 3, 4, 5, 6].map(size)).toEqual([10, 50, 50, 50, 50, 38]);
    expect(size(7)).toBe(0);
  });

  it("no confirm at all: refused before any call", async () => {
    logged();
    const { client, log } = prodClient();
    await expect(run(apply(1), {}, client)).rejects.toThrow(/Production refused/);
    expect(log.calls).toEqual([]);
  });

  it.each(["", "nonsense", "8e99231b2771:1", "8e99231b2771:1:10:extra"])("a malformed confirm %j is refused before any call", async (value) => {
    logged();
    const { client, log } = prodClient();
    await expect(run(apply(1), { [PROD_CONFIRM_ENV]: value }, client)).rejects.toThrow(/must be/);
    expect(log.calls).toEqual([]);
  });

  it("a wrong confirm is refused: a typed hash that is not the hash of the file read, even with the right batch and row count", async () => {
    logged();
    const { client, log } = prodClient();
    await expect(run(apply(1), { [PROD_CONFIRM_ENV]: `${"0".repeat(12)}:1:10` }, client)).rejects.toThrow(/CSV hash/);
    // the very hash of a DIFFERENT file is just as wrong
    const other = `${sha256Hex(csv([linkRow()])).slice(0, 12)}:1:10`;
    await expect(run(apply(1), { [PROD_CONFIRM_ENV]: other }, client)).rejects.toThrow(/CSV hash/);
    expect(log.calls).toEqual([]);
  });

  it("a wrong batch number is refused: the confirm for batch 1 does not open batch 2", async () => {
    logged();
    const { client, log } = prodClient(fingerprints(1));
    await expect(run(apply(2), { [PROD_CONFIRM_ENV]: confirm(1, size(2)) }, client)).rejects.toThrow(/batch number/);
    expect(log.calls).toEqual([]);
  });

  it("a wrong row count is refused", async () => {
    logged();
    const { client, log } = prodClient();
    await expect(run(apply(1), { [PROD_CONFIRM_ENV]: confirm(1, 11) }, client)).rejects.toThrow(/row count/);
    await expect(run(apply(1), { [PROD_CONFIRM_ENV]: confirm(1, 9) }, client)).rejects.toThrow(/row count/);
    expect(log.calls).toEqual([]);
  });

  it("the canary cannot be skipped: batch 2 with nothing of batch 1 in is refused, and only the read-only select ran", async () => {
    logged();
    const { client, log } = prodClient();
    await expect(run(apply(2), { [PROD_CONFIRM_ENV]: confirm(2) }, client)).rejects.toThrow(/batch 1 is not fully in/);
    expect(log.calls).toEqual(["select"]);
  });

  it("batch 2 is refused when ONE batch-1 fingerprint is missing", async () => {
    logged();
    const nine = fingerprints(1).slice(1);
    const { client, log } = prodClient(nine);
    await expect(run(apply(2), { [PROD_CONFIRM_ENV]: confirm(2) }, client)).rejects.toThrow(/9 of 10 present/);
    expect(log.calls).toEqual(["select"]);
  });

  it("batch 2 is accepted when every batch-1 fingerprint exists, even under another source; the check is on fingerprints, not on rows with the key", async () => {
    logged();
    const { client, log } = prodClient(fingerprints(1));
    await run(apply(2), { [PROD_CONFIRM_ENV]: confirm(2) }, client);
    expect(log.selects).toEqual([{ columns: "dedup_fingerprint", column: "dedup_fingerprint", values: fingerprints(1) }]);
    expect(log.calls).toEqual(["select", "upsert"]);
    expect(log.upserted.map((r) => r.dedup_fingerprint)).toEqual(fingerprints(2));
  });

  it("batch 1 needs no earlier batch and inserts exactly its 10 rows", async () => {
    const lines = logged();
    const { client, log } = prodClient();
    await run(apply(1), { [PROD_CONFIRM_ENV]: confirm(1) }, client);
    expect(log.calls).toEqual(["upsert"]);
    expect(log.upserted).toEqual(batchRows(plan, 1).map((i) => i.insert));
    expect(log.upserted).toHaveLength(10);
    expect(lines.at(-1)).toBe("Production batch 1: attempted 10, inserted 10, skipped as already present 0.");
  });

  it("the right confirm inserts exactly that batch's rows (batch 6, the last, 38 rows)", async () => {
    logged();
    const { client, log } = prodClient(fingerprints(5));
    await run(apply(6), { [PROD_CONFIRM_ENV]: confirm(6) }, client);
    expect(log.upserted).toEqual(batchRows(plan, 6).map((i) => i.insert));
    expect(log.upserted).toHaveLength(38);
  });

  it("batch 7 (there are only 6), batch 0, a fraction and a missing --batch are refused before any check or call", async () => {
    logged();
    const { client, log } = prodClient(fingerprints(6));
    for (const b of ["7", "0", "1.5", "x"]) await expect(run(apply(b), { [PROD_CONFIRM_ENV]: confirm(7, 0) }, client)).rejects.toThrow(/Pass --batch/);
    await expect(run(["--csv", csvFile(), "--apply", "--production"], { [PROD_CONFIRM_ENV]: confirm(1) }, client)).rejects.toThrow(/Pass --batch/);
    expect(log.calls).toEqual([]);
  });

  it("a batch above 50 stays refused by the insert itself", async () => {
    const { client, log } = prodClient();
    await expect(insertBatch(client, plan.items.slice(0, 51).map((i) => i.insert))).rejects.toThrow(/limit is 50/);
    expect(log.calls).toEqual([]);
  });

  it("--production with the env var missing is refused for --apply and for --undo", async () => {
    logged();
    const { client, log } = prodClient();
    await expect(run(apply(1), { [PROD_CONFIRM_ENV]: undefined }, client)).rejects.toThrow(/Production refused/);
    await expect(run(["--undo", "--production"], {}, client)).rejects.toThrow(/Production refused/);
    expect(log.calls).toEqual([]);
  });

  it("--production alone, or with both --apply and --undo, is refused", async () => {
    logged();
    const { client, log } = prodClient();
    const file = csvFile();
    await expect(run(["--csv", file, "--production", "--preview", path.join(path.dirname(file), "p.csv")], { [PROD_CONFIRM_ENV]: confirm(1) }, client)).rejects.toThrow(/exactly one of/);
    await expect(run(["--csv", csvFile(), "--apply", "--undo", "--production", "--batch", "1"], { [PROD_CONFIRM_ENV]: UNDO_CONFIRM }, client)).rejects.toThrow(/exactly one of/);
    expect(log.calls).toEqual([]);
  });

  it("absent service credentials are refused with the right confirm, and nothing says where the database is", async () => {
    logged();
    for (const env of [{}, { NEXT_PUBLIC_SUPABASE_URL: "https://example.test", SUPABASE_SERVICE_ROLE_KEY: "" }, { SUPABASE_SERVICE_ROLE_KEY: "k" }]) {
      const err = await run(apply(1), { ...env, [PROD_CONFIRM_ENV]: confirm(1) }).catch((e: Error) => e);
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toMatch(/service credentials are not set/);
      expect((err as Error).message).not.toMatch(/example\.test|supabase\.co/);
    }
  });

  describe("the production undo", () => {
    type Row = { id: string; external_source: string; source_type: string; status: string };
    function table(rows: Row[]): ImportClient {
      return {
        from: () => ({
          upsert: () => { throw new Error("an undo must never insert"); },
          select: () => { throw new Error("an undo must never select"); },
          update(values) {
            const filters: Array<[string, string]> = [];
            const chain = {
              eq(column: string, value: string) {
                filters.push([column, value]);
                return chain;
              },
              select: () => {
                const hit = rows.filter((r) => filters.every(([c, v]) => (r as unknown as Record<string, string>)[c] === v));
                for (const r of hit) Object.assign(r, { status: values.status });
                return Promise.resolve({ data: hit.map((r) => ({ id: r.id })), error: null });
              },
            };
            return chain;
          },
        }),
      };
    }

    it("without its own confirm it is refused, whatever else is set", async () => {
      logged();
      const rows: Row[] = [{ id: "1", external_source: SOURCE_KEY, source_type: "external", status: "open" }];
      for (const env of [{}, { [PROD_CONFIRM_ENV]: "UNDO" }, { [PROD_CONFIRM_ENV]: confirm(1) }, { [PROD_CONFIRM_ENV]: `UNDO:${SOURCE_KEY}x` }]) {
        await expect(run(["--undo", "--production"], env, table(rows))).rejects.toThrow(/Production refused/);
      }
      expect(rows[0].status).toBe("open");
    });

    it("closes only this key's open rows, leaves another key's open rows open, and prints only the count", async () => {
      const lines = logged();
      const rows: Row[] = [
        { id: "a", external_source: SOURCE_KEY, source_type: "external", status: "open" },
        { id: "b", external_source: SOURCE_KEY, source_type: "external", status: "open" },
        { id: "c", external_source: SOURCE_KEY, source_type: "external", status: "closed" },
        { id: "d", external_source: "manual-sheet-other-key", source_type: "external", status: "open" },
        { id: "e", external_source: "jobberman", source_type: "external", status: "open" },
        { id: "f", external_source: SOURCE_KEY, source_type: "internal", status: "open" },
      ];
      await run(["--undo", "--production"], { [PROD_CONFIRM_ENV]: UNDO_CONFIRM }, table(rows));
      expect(rows.map((r) => `${r.id}:${r.status}`)).toEqual(["a:closed", "b:closed", "c:closed", "d:open", "e:open", "f:open"]);
      expect(lines).toEqual(["Production undo: closed 2."]);
    });
  });

  it("production mode prints counts only: no title, address, e-mail, key or project address", async () => {
    const lines = logged();
    const { client } = prodClient(fingerprints(1));
    await run(apply(2), { [PROD_CONFIRM_ENV]: confirm(2), NEXT_PUBLIC_SUPABASE_URL: "https://abcdefgh.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-key-value" }, client);
    const text = lines.join("\n");
    expect(text).not.toMatch(/Prod Role|Prod Co|https?:|@|supabase|service-key-value|careers\.example/);
    expect(text).not.toContain(sha.slice(0, 12));
  });

  it("the dry run stays the default: even with --production's env var set it contacts nothing and writes only the preview", async () => {
    logged();
    const { client, log } = prodClient();
    const file = csvFile();
    const previewPath = path.join(path.dirname(file), "p.csv");
    await run(["--csv", file, "--preview", previewPath], { [PROD_CONFIRM_ENV]: confirm(1) }, client);
    expect(log.calls).toEqual([]);
    expect(readdirSync(path.dirname(file)).sort()).toEqual(["in.csv", "p.csv"]);
  });
});

describe("no notification, e-mail or push can come from the importer", () => {
  it("none of the new source files imports the ingest route, the alert sender, the post-ingest refresh, a mailer or the notifications code, or calls them", () => {
    const FORBIDDEN = /notifications\/|proactive-match|post-ingest-refresh|api\/admin\/ingest-jobs|\bresend\b|sendEmail|sendAdminAlert|lib\/email\b|web-push|ingestAllSources|runPostIngestRefresh|enrichThinPostings/i;
    for (const f of NEW_FILES.filter((x) => x.startsWith("scripts/"))) {
      const code = readFileSync(path.join(ROOT, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
      expect(code, `${f} must not reach any notification path`).not.toMatch(FORBIDDEN);
    }
  });
});

describe("against a real database (the local stack): insert-only, no update, no notification, an exact undo", () => {
  const key = `manual-sheet-test-${randomUUID().slice(0, 8)}`;
  type Admin = typeof import("../support/auth")["admin"];
  let admin: Admin;
  let client: ImportClient;
  const otherId: string[] = [];
  const count = async (table: typeof NOTIFICATION_TABLES.deliveries | typeof NOTIFICATION_TABLES.adminMessageEvents) => {
    const { count: n, error } = await admin.from(table).select("*", { count: "exact", head: true });
    if (error) throw new Error(`${table}: ${error.message}`);
    return n ?? 0;
  };

  beforeAll(async () => {
    ({ admin } = await import("../support/auth"));
    client = admin as unknown as ImportClient;
  });

  afterEach(async () => {
    await admin.from("job_postings").delete().eq("external_source", key);
    if (otherId.length > 0) await admin.from("job_postings").delete().in("id", otherId.splice(0));
  });

  const plan = () => buildPlan(csv([linkRow({ title: `DB ${randomUUID().slice(0, 6)}` }), linkRow({ title: `DB ${randomUUID().slice(0, 6)}` }), linkRow({ title: `DB ${randomUUID().slice(0, 6)}` })]), { now: new Date(), sourceKey: key });

  it("inserts link-out rows that are open, public, external and marked as already enriched, and raises nothing", async () => {
    const before = [await count(NOTIFICATION_TABLES.deliveries), await count(NOTIFICATION_TABLES.adminMessageEvents)];
    const p = plan();
    const result = await insertBatch(client, p.items.map((i) => i.insert));
    expect(result).toEqual({ attempted: 3, inserted: 3, skippedExisting: 0 });
    const { data } = await admin.from("job_postings").select("source_type, organization_id, status, external_url, external_source, llm_enrichment_attempted_at, superseded_at, unlisted_at").eq("external_source", key);
    expect(data).toHaveLength(3);
    for (const r of data!) {
      expect(r).toMatchObject({ source_type: "external", organization_id: null, status: "open", external_source: key, superseded_at: null, unlisted_at: null });
      expect(r.external_url).toMatch(/^https:\/\//);
      expect(r.llm_enrichment_attempted_at).not.toBeNull();
    }
    expect([await count(NOTIFICATION_TABLES.deliveries), await count(NOTIFICATION_TABLES.adminMessageEvents)]).toEqual(before);
  });

  it("running the same batch again inserts nothing and changes nothing", async () => {
    const p = plan();
    const rows = p.items.map((i) => i.insert);
    await insertBatch(client, rows);
    const { data: first } = await admin.from("job_postings").select("id, title, description, last_checked_at, status").eq("external_source", key).order("id");
    const again = await insertBatch(client, rows.map((r) => ({ ...r, description: `${r.description} CHANGED`, last_checked_at: new Date().toISOString() })));
    expect(again).toEqual({ attempted: 3, inserted: 0, skippedExisting: 3 });
    const { data: second } = await admin.from("job_postings").select("id, title, description, last_checked_at, status").eq("external_source", key).order("id");
    expect(second).toEqual(first);
  });

  it("a job that is already on Talentrah from another source is skipped, counted and left exactly as it was", async () => {
    const p = plan();
    const rows = p.items.map((i) => i.insert);
    const { data: existing, error } = await admin
      .from("job_postings")
      .insert({ source_type: "external", title: "Existing title", company_name: "Existing Co", description: "Existing description.", external_url: "https://existing.example.test/1", external_source: "greenhouse", dedup_fingerprint: rows[0].dedup_fingerprint, status: "open" })
      .select("id, title, description, external_source")
      .single();
    expect(error).toBeNull();
    otherId.push(existing!.id);
    const result = await insertBatch(client, rows);
    expect(result).toEqual({ attempted: 3, inserted: 2, skippedExisting: 1 });
    const { data: after } = await admin.from("job_postings").select("id, title, description, external_source").eq("id", existing!.id).single();
    expect(after).toEqual(existing);
  });

  it("the undo closes exactly this import's open rows and no others", async () => {
    const p = plan();
    await insertBatch(client, p.items.map((i) => i.insert));
    const { data: other, error } = await admin
      .from("job_postings")
      .insert({ source_type: "external", title: "Other import", company_name: "Other Co", description: "Other.", external_url: "https://other.example.test/1", external_source: `${key}-other`, dedup_fingerprint: randomUUID(), status: "open" })
      .select("id")
      .single();
    expect(error).toBeNull();
    otherId.push(other!.id);
    const out = await undoImport(client, new Date(), key);
    expect(out).toEqual({ closed: 3 });
    const { data: mine } = await admin.from("job_postings").select("status, closed_at").eq("external_source", key);
    expect(mine!.every((r) => r.status === "closed" && r.closed_at !== null)).toBe(true);
    const { data: untouched } = await admin.from("job_postings").select("status").eq("id", other!.id).single();
    expect(untouched!.status).toBe("open");
    expect(await undoImport(client, new Date(), key)).toEqual({ closed: 0 });
  });
});
