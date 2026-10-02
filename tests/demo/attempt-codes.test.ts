/**
 * The attempt log's two short-string columns, and the schema guarantee that backs them (0208).
 *
 * `reason` and `error_class` are `text`, and "no personal data" must hold because the SCHEMA refuses anything that is
 * not a short code, not only because today's writer happens to send codes:
 *
 *   reason       CHECK (reason IS NULL OR reason ~ '^[a-z_]{1,32}$')
 *   error_class  CHECK (error_class IS NULL OR error_class ~ '^[A-Za-z0-9_.]{1,64}$')
 *
 * A sentence has spaces and is long, so a visitor's pasted text cannot fit in either column. This file pins, without a
 * database (the constraint itself is tested against the real one in tests/demo/attempt-table.test.ts):
 *   - every code the route writes today fits the shape, taken FROM THE CODE, so a new code that does not fit fails here;
 *   - the shapes refuse sentences, long values, and the characters a code never has;
 *   - the writer's sanitisers can never produce a value the constraint would refuse (a refused insert is a lost row).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  ATTEMPT_REASONS,
  ERROR_CLASS_SHAPE,
  INVALID_REASONS,
  PROVIDER_ERROR_KINDS,
  REASON_SHAPE,
  REFUSAL_REASONS,
  safeErrorClass,
  safeReason,
  _resetUnknownLogForTests,
} from "@/lib/demo/attempt-codes";
import { classifyError, classifyRefusal } from "@/lib/demo/attempt-log";
import { LLMProviderError } from "@/lib/llm/errors";

const SENTENCES = [
  "a visitor pasted a whole job description here",
  "Senior Product Designer at Acme Ltd, Lagos",
  "we are hiring a backend engineer",
  "rate limit exceeded",
  "x ",
  " x",
];

describe("the codes the route writes today", () => {
  it("lists them: five refusal reasons, three invalid-paste reasons, three provider error kinds, and 'other'", () => {
    expect([...REFUSAL_REASONS].sort()).toEqual(["claim_error", "daily_cap", "unidentifiable", "visitor_cookie", "visitor_or_ip"]);
    expect([...INVALID_REASONS].sort()).toEqual(["link_only", "malformed_body", "too_short"]);
    expect([...PROVIDER_ERROR_KINDS].sort()).toEqual(["auth", "rate_limit", "unknown"]);
    // the eight the route chooses between, plus "other": what the writer records for a reason it does not know
    expect(ATTEMPT_REASONS).toHaveLength(9);
    expect(ATTEMPT_REASONS.at(-1)).toBe("other");
  });

  it.each([...REFUSAL_REASONS, ...INVALID_REASONS])("reason %s fits the schema's reason shape", (code) => {
    expect(REASON_SHAPE.test(code)).toBe(true);
    expect(code.length).toBeLessThanOrEqual(32);
  });

  it.each([...PROVIDER_ERROR_KINDS])("error class %s fits the schema's error_class shape", (kind) => {
    expect(ERROR_CLASS_SHAPE.test(kind)).toBe(true);
  });

  it("everything classifyRefusal can return is a listed reason that fits (all claim outcomes, with and without the IP rule)", () => {
    for (const claim of ["already_used", "daily_cap", "no_identifier", "error", "anything_new_the_sql_adds"]) {
      for (const ip of [true, false]) {
        const out = classifyRefusal(claim, ip);
        expect([...ATTEMPT_REASONS], `${claim}/${ip}`).toContain(out);
        expect(REASON_SHAPE.test(out)).toBe(true);
      }
    }
  });

  it("the route's own reason literals are all listed (no code can be written that is not in the list)", () => {
    const route = readFileSync(path.resolve(__dirname, "../../src/app/api/public/jd-demo/route.ts"), "utf8");
    const used = [...route.matchAll(/reason:\s*"([a-z_]+)"/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThanOrEqual(3);
    for (const code of used) expect([...ATTEMPT_REASONS], `route writes "${code}"`).toContain(code);
  });
});

describe("the shapes refuse what must never be stored", () => {
  it.each(SENTENCES)("a sentence (%j) fits neither column", (text) => {
    expect(REASON_SHAPE.test(text)).toBe(false);
    expect(ERROR_CLASS_SHAPE.test(text)).toBe(false);
  });

  it("reason: 32 characters fit, 33 do not; digits, capitals, hyphens and dots do not", () => {
    expect(REASON_SHAPE.test("a".repeat(32))).toBe(true);
    expect(REASON_SHAPE.test("a".repeat(33))).toBe(false);
    for (const bad of ["Daily_cap", "cap2", "daily-cap", "daily.cap", "", "ünïcode"]) expect(REASON_SHAPE.test(bad), bad).toBe(false);
  });

  it("error_class: 64 characters fit, 65 do not; class names, dots and digits fit", () => {
    expect(ERROR_CLASS_SHAPE.test("A".repeat(64))).toBe(true);
    expect(ERROR_CLASS_SHAPE.test("A".repeat(65))).toBe(false);
    for (const ok of ["TypeError", "AbortError", "rate_limit", "node.FetchError", "E500"]) expect(ERROR_CLASS_SHAPE.test(ok), ok).toBe(true);
    for (const bad of ["Type Error", "", "x/y", "x;drop", "ünï"]) expect(ERROR_CLASS_SHAPE.test(bad), bad).toBe(false);
  });
});

describe("what the writer does with a value that does not fit: it NEVER repairs it, it writes the catch-all", () => {
  beforeEach(() => {
    _resetUnknownLogForTests();
  });

  it("safeReason: a listed code passes through unchanged; null stays null", () => {
    for (const code of ATTEMPT_REASONS) expect(safeReason(code)).toBe(code);
    expect(safeReason(null)).toBeNull();
    expect(safeReason(undefined)).toBeNull();
  });

  it("safeReason: an UNKNOWN reason is written as 'other' (which is itself a listed code that fits the schema)", () => {
    expect(ATTEMPT_REASONS).toContain("other");
    expect(REASON_SHAPE.test("other")).toBe(true);
    for (const bad of [...SENTENCES, "a".repeat(40), "NEW_CODE", "some-new-code", "daily_cap_v2", ""]) {
      expect(safeReason(bad), JSON.stringify(bad)).toBe("other");
    }
  });

  it("safeErrorClass: a value that fits is written UNCHANGED, up to 64 characters", () => {
    for (const ok of ["TypeError", "rate_limit", "node.FetchError", "E500", "A".repeat(64)]) expect(safeErrorClass(ok)).toBe(ok);
    expect(safeErrorClass(null)).toBeNull();
    expect(safeErrorClass(undefined)).toBeNull();
  });

  it("safeErrorClass: a value that does NOT fit is written as 'Other', never stripped into a valid-looking different code", () => {
    // Stripping would turn "Type Error!" into "TypeError" and "ünï" into "n": a plausible code that means something else,
    // which is worse than no data. So it is not repaired, and not truncated either.
    for (const bad of ["Type Error!", "ünï", "üï", "A".repeat(65), "A".repeat(100), "", "  ", "x/y", "<script>", ...SENTENCES]) {
      expect(safeErrorClass(bad), JSON.stringify(bad)).toBe("Other");
    }
    expect(ERROR_CLASS_SHAPE.test("Other")).toBe(true);
  });

  it("the stripping path no longer exists in the source (a mutation that re-adds it fails the behaviour tests above, and this)", () => {
    const whole = readFileSync(path.resolve(__dirname, "../../src/lib/demo/attempt-codes.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    // Only the two functions that decide what is WRITTEN: the log helper above them may cut a value for the LOG line.
    const writers = whole.slice(whole.indexOf("export function safeReason"));
    expect(writers).toContain("export function safeErrorClass");
    expect(writers, "no character-stripping replace").not.toMatch(/\.replace\(/);
    expect(writers, "no truncating slice").not.toMatch(/\.slice\(/);
    expect(writers, "no substring either").not.toMatch(/\.substring\(|\.substr\(/);
    expect(writers, "no regex match-and-rebuild").not.toMatch(/\.match\(|\.exec\(/);
  });

  it("the raw value is logged ONCE to the server log (so the code can be added properly), and never again for the same value", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    safeReason("brand_new_reason");
    safeReason("brand_new_reason");
    safeErrorClass("Weird Name!");
    safeErrorClass("Weird Name!");
    safeReason("daily_cap"); // a known code logs nothing
    safeErrorClass("TypeError"); // a fitting one logs nothing
    const lines = warn.mock.calls.map((c) => String(c[0]));
    warn.mockRestore();
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("brand_new_reason");
    expect(lines[0]).toContain("reason");
    expect(lines[1]).toContain("Weird Name!");
    expect(lines[1]).toContain("error_class");
  });

  it("the log line is bounded: a huge raw value is cut for the LOG, not for the table", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    safeErrorClass("x ".repeat(5000));
    const line = String(warn.mock.calls[0]?.[0]);
    warn.mockRestore();
    expect(line.length).toBeLessThan(600);
  });

  it("classifyError: a malformed class name is 'Other', a provider error keeps its kind, a non-error is 'unknown'", () => {
    class Weird extends Error {}
    Object.defineProperty(Weird, "name", { value: "A weird, class name!" });
    expect(classifyError(new Weird("w"))).toBe("Other");
    expect(classifyError(new TypeError("t"))).toBe("TypeError");
    expect(classifyError(new LLMProviderError("groq", "rate_limit", "x"))).toBe("rate_limit");
    expect(classifyError("a string with spaces")).toBe("unknown");
    expect(classifyError(null)).toBe("unknown");
    for (const s of [new Weird("w"), new TypeError("t"), "x y", 42]) expect(ERROR_CLASS_SHAPE.test(classifyError(s))).toBe(true);
  });
});

describe("the migration's own comment and attempt-codes.ts cannot drift apart", () => {
  it("every code the migration's header lists is in attempt-codes.ts; the only code it does not list is 'other'", () => {
    const sql = readFileSync(path.resolve(__dirname, "../../supabase/migrations/0208_anonymous_demo_attempts.sql"), "utf8");
    const header = sql.split("create table")[0];
    // "--   reason   refused: a | b | c" and "--            invalid: x | y": the codes after the colon, split on "|"
    const listed = new Set<string>();
    for (const line of header.split("\n")) {
      const m = line.match(/\b(?:refused|invalid):\s*([a-z_ |]+)$/);
      if (m) for (const code of m[1].split("|")) if (code.trim()) listed.add(code.trim());
    }
    expect(listed.size, "parsed the header's code lists").toBe(8);
    for (const code of [...REFUSAL_REASONS, ...INVALID_REASONS]) expect(listed.has(code), `${code} missing from the migration header`).toBe(true);
    const unlistedInSql = [...ATTEMPT_REASONS].filter((c) => !listed.has(c));
    expect(unlistedInSql).toEqual(["other"]);
  });
});
