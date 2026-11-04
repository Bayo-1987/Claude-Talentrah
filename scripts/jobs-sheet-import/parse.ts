/**
 * Reading the jobs sheet (JOBS-SHEET-IMPORT-1). Standard library only: one CSV in, plain rows out. Nothing in a cell is run, followed or trusted: every value is text, control characters are
 * dropped, and an e-mail address or phone number is carried EXACTLY as written (never added, guessed or corrected; a page that spells an address wrongly keeps the wrong spelling).
 *
 * The CSV has 17 columns: id, origin, method, title, company, location, salary, date_posted, deadline, summary, description, requirements, qualifications, apply_email, apply_phone,
 * apply_link, apply_text. It has NO job-board link column and none is ever read; an extra column in a file is kept in `extra` and never copied anywhere.
 * `description` is empty on most rows and `location` on some: that is allowed, it is not a missing column.
 */

export const REQUIRED_COLUMNS = [
  "id", "method", "title", "company", "location", "salary", "date_posted", "deadline", "summary", "description", "requirements", "qualifications",
  "apply_email", "apply_phone", "apply_link", "apply_text",
] as const;

export interface SheetRow {
  /** 1-based line of the record in the file (header = 1), for messages that must not quote the row. */
  line: number;
  id: string;
  origin: string;
  method: string;
  title: string;
  company: string;
  location: string;
  salary: string;
  datePosted: string;
  deadline: string;
  summary: string;
  description: string;
  requirements: string;
  qualifications: string;
  applyEmail: string;
  applyPhone: string;
  applyLink: string;
  applyText: string;
  /** Columns the importer does not know. Never copied to a stored field, a preview line or a log line. */
  extra: Record<string, string>;
}

/** RFC 4180 reader: quoted fields, doubled quotes, CRLF or LF inside and between records, a leading byte-order mark. */
export function parseCsv(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      record.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      record.push(field);
      field = "";
      records.push(record);
      record = [];
    } else {
      field += c;
    }
  }
  if (field !== "" || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  return records.filter((r) => !(r.length === 1 && r[0] === ""));
}

/** Plain text: line endings normalised, control characters (except newline and tab) dropped, ends trimmed. Letters, digits, "@", "+" and spaces inside a value are never touched. */
export function cleanText(value: string): string {
  return value.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
}

export function readSheet(csvText: string): SheetRow[] {
  const records = parseCsv(csvText);
  if (records.length === 0) throw new Error("The CSV is empty.");
  const header = records[0].map((h) => cleanText(h));
  const missing = REQUIRED_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length > 0) throw new Error(`The CSV is missing required column(s): ${missing.join(", ")}.`);
  const at = (name: string) => header.indexOf(name);
  const known = new Set<string>([...REQUIRED_COLUMNS, "origin"]);
  return records.slice(1).map((r, i) => {
    const get = (name: string) => (at(name) >= 0 ? cleanText(r[at(name)] ?? "") : "");
    const extra: Record<string, string> = {};
    header.forEach((h, k) => {
      if (!known.has(h)) extra[h] = cleanText(r[k] ?? "");
    });
    return {
      line: i + 2,
      id: get("id"), origin: get("origin"), method: get("method"), title: get("title"), company: get("company"), location: get("location"), salary: get("salary"),
      datePosted: get("date_posted"), deadline: get("deadline"), summary: get("summary"), description: get("description"), requirements: get("requirements"),
      qualifications: get("qualifications"), applyEmail: get("apply_email"), applyPhone: get("apply_phone"), applyLink: get("apply_link"), applyText: get("apply_text"), extra,
    };
  });
}

/** The job body: summary + description + requirements + qualifications, in that order, empty parts skipped. */
export function jobBody(row: Pick<SheetRow, "summary" | "description" | "requirements" | "qualifications">): string {
  return [row.summary, row.description, row.requirements, row.qualifications].map(cleanText).filter((p) => p !== "").join("\n\n");
}

export type ApplyKind = "link" | "email+link" | "email" | "phone" | "none";

/** What the row gives a seeker to apply with, by the fields it actually has (the `method` label is the sheet's own and is not trusted over the fields). */
export function applyKind(row: Pick<SheetRow, "applyEmail" | "applyPhone" | "applyLink">): ApplyKind {
  const e = row.applyEmail.trim() !== "";
  const l = row.applyLink.trim() !== "";
  if (e && l) return "email+link";
  if (l) return "link";
  if (e) return "email";
  return row.applyPhone.trim() !== "" ? "phone" : "none";
}

/** "Lagos | Abuja" -> first "Lagos", rest ["Abuja"]. An empty location is null (the column is nullable). */
export function splitLocation(location: string): { first: string | null; rest: string[] } {
  const parts = location.split("|").map((p) => cleanText(p)).filter((p) => p !== "");
  return { first: parts[0] ?? null, rest: parts.slice(1) };
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

function lagosInstant(year: number, month: number, day: number, time: string): Date | null {
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return new Date(`${year}-${pad(month)}-${pad(day)}T${time}+01:00`); // Lagos is UTC+1 all year
}

const DATE_RE = /^(?:[A-Za-z]+,?\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\.?,?\s+(\d{4})\.?$/;

function parseDate(text: string, time: string): Date | null {
  const m = DATE_RE.exec(cleanText(text));
  if (!m) return null;
  const month = MONTHS[m[2].slice(0, 3).toLowerCase()];
  return month ? lagosInstant(Number(m[3]), month, Number(m[1]), time) : null;
}

/** "10th November, 2026." -> the END of that day in Lagos. Anything that is not exactly one date ("Not Specified", "Various", a range) is null: the caller applies its own default. */
export function parseDeadline(text: string): Date | null {
  return parseDate(text, "23:59:59");
}

/** "2 Nov 2026" -> the start of that day in Lagos. */
export function parseDatePosted(text: string): Date | null {
  return parseDate(text, "00:00:00");
}

export interface ParsedSalary {
  min: number;
  max: number;
  currency: "NGN";
  unit: "month";
}

const SALARY_RE = /^N\s*(\d[\d,]*)(?:\s*[-–]\s*N?\s*(\d[\d,]*))?\s*(?:\/\s*|per\s+)?month(?:ly)?\.?$/i;

/** "N150,000 - N250,000 monthly", "N250,000 per month", "N250,000 / Month". Only a clean match; any other text (or trailing prose) is null and the caller keeps the text in the description. */
export function parseSalary(text: string): ParsedSalary | null {
  const m = SALARY_RE.exec(cleanText(text));
  if (!m) return null;
  const toNumber = (s: string) => Number(s.replace(/,/g, ""));
  const min = toNumber(m[1]);
  const max = m[2] === undefined ? min : toNumber(m[2]);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max < min) return null;
  return { min, max, currency: "NGN", unit: "month" };
}

export const SOURCE_LINE = "Listed from public job boards";

/**
 * The stored description: the body, the other locations, a salary that did not parse (kept as written), the "How to apply" block as written, and the source line. The e-mail and phone
 * are in the block exactly as the sheet has them; if the apply text does not already contain one, it is added on its own line, still as written.
 */
export function composeDescription(row: SheetRow, rest: string[], salaryParsed: boolean): string {
  const parts: string[] = [jobBody(row)];
  if (rest.length > 0) parts.push(`Other locations: ${rest.join("; ")}`);
  if (!salaryParsed && row.salary !== "") parts.push(`Salary: ${row.salary}`);
  const apply: string[] = [];
  if (row.applyText !== "") apply.push(row.applyText);
  if (row.applyEmail !== "" && !row.applyText.includes(row.applyEmail)) apply.push(`Email: ${row.applyEmail}`);
  if (row.applyPhone !== "" && !row.applyText.includes(row.applyPhone)) apply.push(`Phone: ${row.applyPhone}`);
  if (apply.length > 0) parts.push(`How to apply\n${apply.join("\n")}`);
  parts.push(SOURCE_LINE);
  return parts.filter((p) => p !== "").join("\n\n");
}
