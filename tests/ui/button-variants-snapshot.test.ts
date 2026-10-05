/**
 * The exact class string of every existing Button variant at both sizes, pinned. Adding the `onDark` variant (a button on the ink
 * panel) must move none of them: a change to an existing string fails here and has to be made on purpose.
 */
import { describe, expect, it } from "vitest";
import { buttonClasses } from "@/lib/button-classes";

const BASE =
  "inline-flex items-center justify-center rounded-none font-body font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50";

const EXPECTED = {
  md: {
    primary: "bg-ink text-paper border-none min-h-[48px] px-[30px] py-[15px] text-[15px] hover:bg-rust",
    secondary:
      "bg-transparent text-ink border-[1.5px] border-ink min-h-[44px] px-[28px] py-[13px] text-[15px] hover:border-rust hover:text-rust",
    ghost: "bg-transparent text-ink border-none min-h-[44px] px-[6px] py-[10px] text-[15px] hover:text-rust",
    text: "bg-transparent text-ink-soft border-none min-h-[44px] px-[2px] py-[10px] text-[13.5px] underline underline-offset-3 hover:text-rust",
  },
  sm: {
    primary: "bg-ink text-paper border-none min-h-[40px] px-[18px] py-[10px] text-[13.5px] hover:bg-rust",
    secondary:
      "bg-transparent text-ink border border-line min-h-[40px] px-[16px] py-[10px] text-[13px] hover:border-rust hover:text-rust",
    ghost: "bg-transparent text-ink-soft border-none min-h-[40px] px-[4px] py-[8px] text-[13px] hover:text-rust",
    text: "bg-transparent text-ink-soft border-none min-h-[40px] px-[2px] py-[8px] text-[13px] underline underline-offset-2 hover:text-rust",
  },
} as const;

describe("existing Button variants are unchanged", () => {
  for (const size of ["md", "sm"] as const) {
    for (const variant of ["primary", "secondary", "ghost", "text"] as const) {
      it(`${variant} / ${size}`, () => {
        expect(buttonClasses(variant, size)).toBe(`${BASE} ${EXPECTED[size][variant]}`);
      });
    }
  }

  it("a custom className is still appended last", () => {
    expect(buttonClasses("primary", "md", "w-full")).toBe(`${BASE} ${EXPECTED.md.primary} w-full`);
  });
});

describe("the onDarkText variant", () => {
  it("is paper text on a transparent ground, at least 44px tall, at both sizes, with its own focus ring", () => {
    for (const size of ["md", "sm"] as const) {
      const c = buttonClasses("onDarkText", size);
      expect(c).toMatch(/bg-transparent/);
      expect(c).toMatch(/text-paper/);
      expect(c).toMatch(/min-h-\[(4[4-9]|5\d)px\]/);
      expect(c).toMatch(/focus-visible:outline/);
    }
  });
});

describe("the onDark variant", () => {
  it("is paper on ink at least 44px tall, at both sizes, and has its own focus ring", () => {
    for (const size of ["md", "sm"] as const) {
      const c = buttonClasses("onDark", size);
      expect(c).toMatch(/bg-paper/);
      expect(c).toMatch(/text-ink/);
      expect(c).toMatch(/min-h-\[(4[4-9]|5\d)px\]/);
      expect(c).toMatch(/focus-visible:outline/);
    }
  });
});
