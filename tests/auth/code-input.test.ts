/** What the code field accepts (S1-101): a paste of six digits works however the email formatted it; anything else is not a complete code. */
import { describe, expect, it } from "vitest";
import { CODE_LENGTH, isCompleteCode, normalizeCodeInput } from "@/lib/auth/code-input";

describe("normalizeCodeInput", () => {
  it.each([
    ["123456", "123456"],
    ["123 456", "123456"],
    ["123-456", "123456"],
    ["  12 34 56\n", "123456"],
    ["Your code: 123456", "123456"],
    ["12345678", "123456"],
    ["abc", ""],
    [null, ""],
    [undefined, ""],
    [123456, "123456"],
  ])("%j -> %j", (raw, expected) => {
    expect(normalizeCodeInput(raw)).toBe(expected);
  });

  it("is six digits long", () => {
    expect(CODE_LENGTH).toBe(6);
  });
});

describe("isCompleteCode", () => {
  it("is true only for exactly six digits", () => {
    expect(isCompleteCode("123456")).toBe(true);
    expect(isCompleteCode("12345")).toBe(false);
    expect(isCompleteCode("1234567")).toBe(false);
    expect(isCompleteCode("12345a")).toBe(false);
    expect(isCompleteCode("")).toBe(false);
  });
});
