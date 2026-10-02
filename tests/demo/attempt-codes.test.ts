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
import { describe, expect, it } from "vitest";
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
  it("lists them: five refusal reasons, three invalid-paste reasons, three provider error kinds", () => {
    expect([...REFUSAL_REASONS].sort()).toEqual(["claim_error", "daily_cap", "unidentifiable", "visitor_cookie", "visitor_or_ip"]);
    expect([...INVALID_REASONS].sort()).toEqual(["link_only", "malformed_body", "too_short"]);
    expect([...PROVIDER_ERROR_KINDS].sort()).toEqual(["auth", "rate_limit", "unknown"]);
    expect(ATTEMPT_REASONS).toHaveLength(8);
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

describe("the writer's sanitisers never emit a value the schema would refuse", () => {
  it("safeReason: listed codes pass through; null stays null; anything else becomes 'other' (which fits)", () => {
    for (const code of ATTEMPT_REASONS) expect(safeReason(code)).toBe(code);
    expect(safeReason(null)).toBeNull();
    expect(safeReason(undefined)).toBeNull();
    for (const bad of [...SENTENCES, "a".repeat(40), "NEW_CODE", "some-new-code"]) {
      const out = safeReason(bad);
      expect(out).toBe("other");
      expect(REASON_SHAPE.test(out!)).toBe(true);
    }
  });

  it("safeErrorClass: strips what a class name never has and caps the length, so the result always fits", () => {
    expect(safeErrorClass(null)).toBeNull();
    expect(safeErrorClass("TypeError")).toBe("TypeError");
    expect(safeErrorClass("Type Error!")).toBe("TypeError");
    expect(safeErrorClass("ünï")).toBe("n"); // the non-ASCII letters go, the plain one stays
    expect(safeErrorClass("üï")).toBe("unknown"); // nothing left after stripping
    expect(safeErrorClass("   ")).toBe("unknown");
    expect(safeErrorClass("A".repeat(100))).toHaveLength(64);
    for (const bad of [...SENTENCES, "a".repeat(200), "<script>", "É", "", "  "]) {
      const out = safeErrorClass(bad);
      expect(out === null || ERROR_CLASS_SHAPE.test(out), JSON.stringify(bad)).toBe(true);
    }
  });

  it("classifyError output always fits, for provider errors, odd constructor names, and non-errors", () => {
    class Weird extends Error {}
    Object.defineProperty(Weird, "name", { value: "A weird, class name!" });
    const samples: unknown[] = [
      new LLMProviderError("groq", "rate_limit", "x"),
      new LLMProviderError("gemini", "auth", "x"),
      new TypeError("t"),
      new Weird("w"),
      "a string with spaces",
      null,
      undefined,
      42,
    ];
    for (const s of samples) {
      const out = classifyError(s);
      expect(ERROR_CLASS_SHAPE.test(out), `${String(s)} -> ${out}`).toBe(true);
    }
  });
});
