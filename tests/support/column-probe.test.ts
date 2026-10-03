/**
 * "Does this column exist yet?" probes, used by a test that must start running by itself the day a migration lands (tests/referrals/referrals.test.ts,
 * the pending-deletion case). The danger is a probe that treats ANY failure as "not there": a network error or a permission error would then skip the
 * test silently, forever, and nobody would see it. Only SQLSTATE 42703 (undefined_column) means missing; success means exists; everything else is
 * inconclusive, and the caller fails a test on it instead of skipping.
 */
import { describe, expect, it } from "vitest";
import { classifyColumnProbe } from "./column-probe";

describe("classifyColumnProbe", () => {
  it("no error: the column exists", () => {
    expect(classifyColumnProbe(null)).toBe("exists");
  });

  it("SQLSTATE 42703 exactly: the column is missing", () => {
    expect(classifyColumnProbe({ code: "42703", message: "column profiles.x does not exist" })).toBe("missing");
  });

  it("every OTHER error is inconclusive, never 'missing': permission, undefined table, a PostgREST code, a network failure with no code", () => {
    for (const error of [
      { code: "42501", message: "permission denied for table profiles" },
      { code: "42P01", message: "relation does not exist" },
      { code: "PGRST301", message: "JWT expired" },
      { code: "PGRST204", message: "schema cache" },
      { code: "08006", message: "connection failure" },
      { code: "", message: "fetch failed" },
      { code: null, message: "TypeError: fetch failed" },
      { message: "no code at all" },
      { code: "42703x", message: "not exactly 42703" },
      { code: "42703 ", message: "not exactly 42703" },
    ]) {
      expect(classifyColumnProbe(error), JSON.stringify(error)).toBe("inconclusive");
    }
  });
});
