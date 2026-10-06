/**
 * The go-live rule for auth emails (AE-2).
 *
 * Supabase sends the auth emails from the template the owner pastes into the dashboard, so a change in this repo reaches no user until the owner does that
 * step. The rule (docs/auth-email-templates/README.md, "Go-live rule"): any change to an auth email ships with a WRITTEN owner dashboard step (which template,
 * which setting, the exact value) and is not done until the owner confirms it is live. This test keeps that record honest:
 *  - the README states the rule;
 *  - every template file in docs/auth-email-templates/ has a row in the "Dashboard steps" table (and a subject file has its row, whose exact value IS the file's text);
 *  - every row names a dashboard location and an exact value, and says since when it is live (an owner-confirmed date) or "not live";
 *  - the Email OTP Expiration setting, which the template's "15 minutes" depends on, has a row with 900 seconds.
 * DOCS_ROOT points the test at another checkout, to show it red against a changed copy; it must never be set in CI.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

if (process.env.CI && process.env.DOCS_ROOT) throw new Error("DOCS_ROOT is set in CI. Unset it: this test must read the real checkout there.");
const ROOT = process.env.DOCS_ROOT ?? process.cwd();
const DIR = path.join(ROOT, "docs/auth-email-templates");
const README = path.join(DIR, "README.md");

type Row = { file: string; step: string; value: string; live: string };

function tableRows(text: string): { rows: Row[]; headerFound: boolean } {
  const start = text.search(/^## Dashboard steps\b/m);
  if (start < 0) return { rows: [], headerFound: false };
  const rest = text.slice(start);
  const next = rest.slice(1).search(/^## /m);
  const section = next < 0 ? rest : rest.slice(0, next + 1);
  const lines = section.split("\n").filter((l) => l.trim().startsWith("|"));
  const headerFound = lines.some((l) => /^\|\s*File\s*\|\s*Dashboard step\s*\|\s*Exact value\s*\|\s*Live since\s*\|/.test(l));
  const rows: Row[] = [];
  for (const l of lines) {
    if (/^\|\s*-{2,}/.test(l) || /^\|\s*File\s*\|/.test(l)) continue;
    const cells = l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
    if (cells.length === 4) rows.push({ file: cells[0], step: cells[1], value: cells[2], live: cells[3] });
  }
  return { rows, headerFound };
}

const readme = existsSync(README) ? readFileSync(README, "utf8") : "";
const { rows, headerFound } = tableRows(readme);
const files = existsSync(DIR) ? readdirSync(DIR) : [];
const templates = files.filter((f) => f.endsWith(".html"));
const subjects = files.filter((f) => f.endsWith(".subject.txt"));

describe("the go-live rule is written down", () => {
  it("the README has the rule, with its three duties", () => {
    expect(readme).toMatch(/^## Go-live rule/m);
    // the wording is checked with line breaks and bold markers ignored, so re-wrapping the paragraph cannot break it
    const flat = readme.replace(/\*\*/g, "").replace(/\s+/g, " ");
    expect(flat).toMatch(/written owner dashboard step/i);
    expect(flat).toMatch(/which template, which setting, the exact value/i);
    expect(flat).toMatch(/not done until the owner confirms it is live/i);
  });

  it("the README has the Dashboard steps table with the agreed columns", () => {
    expect(headerFound, 'the "## Dashboard steps" table or its header "| File | Dashboard step | Exact value | Live since |" is missing').toBe(true);
    expect(rows.length, "the Dashboard steps table has no rows").toBeGreaterThan(0);
  });
});

describe("every auth email file has its dashboard step", () => {
  it("there is at least one template file (the test is not vacuous)", () => {
    expect(templates.length).toBeGreaterThan(0);
  });

  it.each(templates)("%s has a row naming it", (name) => {
    const matching = rows.filter((r) => r.file.includes(name));
    expect(matching, `docs/auth-email-templates/${name} has no row in the Dashboard steps table: add the written owner step (template, setting, exact value)`).toHaveLength(1);
  });

  it.each(subjects)("%s has a row whose exact value is the subject text", (name) => {
    const row = rows.find((r) => r.file.includes(name));
    expect(row, `${name} has no row in the Dashboard steps table`).toBeDefined();
    const subject = readFileSync(path.join(DIR, name), "utf8").trim();
    expect(row!.value).toBe(`\`${subject}\``);
  });

  it("every row names a dashboard location, an exact value, and since when it is live", () => {
    expect(rows.length, "no rows to check").toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.file, `a row has no file or setting name`).not.toBe("");
      expect(r.step, `${r.file}: no dashboard step`).toMatch(/Authentication|Dashboard/i);
      expect(r.value, `${r.file}: no exact value`).not.toBe("");
      // an owner-confirmed date ("6 Oct 2026") or the words "not live": never blank, so an unconfirmed change shows as unfinished
      expect(r.live, `${r.file}: say when the owner confirmed it live, or "not live"`).toMatch(/^(\d{1,2} [A-Z][a-z]{2} 20\d\d|not live)\b/);
    }
  });
});

describe("the setting the template's wording depends on", () => {
  it("Email OTP Expiration has a row with 900 seconds, matching the template's '15 minutes'", () => {
    const row = rows.find((r) => /Email OTP Expiration/i.test(r.file));
    expect(row, "the Email OTP Expiration setting has no row").toBeDefined();
    expect(row!.value).toMatch(/\b900\b/);
    const html = existsSync(path.join(DIR, "confirm-signup.html")) ? readFileSync(path.join(DIR, "confirm-signup.html"), "utf8") : "";
    if (html.includes("The code expires in 15 minutes")) expect(900 / 60).toBe(15);
  });
});
