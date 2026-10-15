/**
 * Moving the lists out of the zod-bearing modules (PERF-WEIGHT-1) must not change them. The sign-up country list is pinned by value and ORDER (length, first
 * entries, last entry, and a hash of the whole sequence, taken from the list before the move); the feedback categories by literal. Each is also checked to be
 * the SAME export through the old import path, so no existing importer sees a different list.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SIGNUP_COUNTRIES as fromCountries } from "@/lib/auth/countries";
import { SIGNUP_COUNTRIES as fromSchemas } from "@/lib/auth/schemas";
import { FEEDBACK_CATEGORIES as catsFromCategories, FEEDBACK_CATEGORY_VALUES as valuesFromCategories } from "@/lib/feedback/categories";
import { FEEDBACK_CATEGORIES as catsFromSchemas, FEEDBACK_CATEGORY_VALUES as valuesFromSchemas } from "@/lib/feedback/schemas";

const ROOT = path.join(__dirname, "../..");

describe("sign-up country list is unchanged", () => {
  it("has the same values in the same order as before the move", () => {
    expect(fromCountries).toHaveLength(251);
    expect(fromCountries.slice(0, 6)).toEqual(["Nigeria", "United Kingdom", "United States", "Canada", "Afghanistan", "Åland Islands"]);
    expect(fromCountries.at(-1)).toBe("Other");
    expect(
      createHash("sha256").update(JSON.stringify(fromCountries)).digest("hex"),
      "The sign-up country list's values or ORDER changed. If that is intended (the owner added or reordered a country), recompute the hash with " +
        'createHash("sha256").update(JSON.stringify(fromCountries)).digest("hex") (fromCountries is SIGNUP_COUNTRIES from @/lib/auth/countries), ' +
        "update this pinned value and the length / first / last checks above in the same commit, and say so in the PR. If it is not intended, revert the list change.",
    ).toBe("06c216b47561e22633fbe7ed05444d2810750d7f884428c4f193a13f8368fc80");
  });
  it("is the identical list through the old schemas path", () => {
    expect(fromSchemas).toBe(fromCountries);
  });
  it("is what the sign-up and settings forms import, from the zod-free module", () => {
    for (const file of ["src/components/auth/signup-form.tsx", "src/app/(app)/settings/settings-form.tsx"]) {
      const source = readFileSync(path.join(ROOT, file), "utf8");
      expect(source, file).toMatch(/SIGNUP_COUNTRIES[^;]*from "@\/lib\/auth\/countries"/);
      expect(source, file).not.toMatch(/from "@\/lib\/auth\/schemas"/);
    }
  });
});

describe("feedback categories are unchanged", () => {
  it("are the same three, in order, with the same labels", () => {
    const why =
      "The feedback categories changed (a value, a label, or the order). The values are a database enum and the labels are shown to people. If that is intended, update this literal " +
      "and the migration/enum that backs the values in the same commit, and say so in the PR. If it is not intended, revert the change to src/lib/feedback/categories.ts.";
    expect(
      catsFromCategories,
      why,
    ).toEqual([
      { value: "bug", label: "Something's broken" },
      { value: "idea", label: "An idea or a request" },
      { value: "other", label: "Something else" },
    ]);
    expect(valuesFromCategories, why).toEqual(["bug", "idea", "other"]);
  });
  it("schemas.ts still exposes the identical lists", () => {
    expect(catsFromSchemas).toBe(catsFromCategories);
    expect(valuesFromSchemas).toBe(valuesFromCategories);
  });
  it("categories.ts has no zod import, and the feedback form reads it", () => {
    expect(readFileSync(path.join(ROOT, "src/lib/feedback/categories.ts"), "utf8")).not.toMatch(/from\s+["']zod["']/);
    expect(readFileSync(path.join(ROOT, "src/app/(app)/feedback/feedback-form.tsx"), "utf8")).toMatch(/from "@\/lib\/feedback\/categories"/);
  });
});
