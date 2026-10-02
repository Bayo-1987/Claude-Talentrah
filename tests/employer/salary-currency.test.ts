/**
 * EMP-1 / E2 — salary currency is one of eight ISO codes, chosen from a select
 * that defaults from the employer's country, and re-checked on the SERVER.
 *
 * The select is a convenience; the gate is `readSalaryForm`, because a
 * hand-crafted POST never touches the client. Pure functions, no database.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SALARY_CURRENCY,
  SALARY_CURRENCIES,
  defaultSalaryCurrency,
  readSalaryForm,
  salaryCurrencySelection,
} from "@/lib/employer/salary-input";

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

describe("the currency list", () => {
  it("is exactly NGN, USD, GBP, EUR, CAD, KES, GHS, ZAR", () => {
    expect([...SALARY_CURRENCIES]).toEqual(["NGN", "USD", "GBP", "EUR", "CAD", "KES", "GHS", "ZAR"]);
  });
  it("falls back to NGN", () => {
    expect(DEFAULT_SALARY_CURRENCY).toBe("NGN");
  });
});

describe("defaultSalaryCurrency — from the employer's country", () => {
  const cases: Array<[string, string]> = [
    // The names the signup form stores in profiles.country.
    ["Nigeria", "NGN"],
    ["Ghana", "GHS"],
    ["Kenya", "KES"],
    ["South Africa", "ZAR"],
    ["United Kingdom", "GBP"],
    ["United States", "USD"],
    ["Canada", "CAD"],
    // ISO alpha-2, in case a country column ever stores codes.
    ["NG", "NGN"],
    ["GH", "GHS"],
    ["KE", "KES"],
    ["ZA", "ZAR"],
    ["GB", "GBP"],
    ["US", "USD"],
    ["CA", "CAD"],
    // Common spellings.
    ["UK", "GBP"],
    ["USA", "USD"],
    ["ng", "NGN"],
    ["  Nigeria  ", "NGN"],
    // The EU: a sample across the list, including a code and a name.
    ["Germany", "EUR"],
    ["France", "EUR"],
    ["Ireland", "EUR"],
    ["Italy", "EUR"],
    ["Spain", "EUR"],
    ["Netherlands", "EUR"],
    ["Poland", "EUR"],
    ["Sweden", "EUR"],
    ["DE", "EUR"],
    ["FR", "EUR"],
    ["IE", "EUR"],
    ["PT", "EUR"],
  ];
  it.each(cases)("%s -> %s", (country, expected) => {
    expect(defaultSalaryCurrency(country)).toBe(expected);
  });

  const unknown: Array<string | null | undefined> = [
    "Other",
    "",
    "   ",
    null,
    undefined,
    "Narnia",
    "Japan",
    "JP",
    "Australia",
  ];
  it.each(unknown)("unknown country %j falls back to NGN", (country) => {
    expect(defaultSalaryCurrency(country)).toBe("NGN");
  });

  it("every country maps into the allowed list", () => {
    for (const [country] of cases) expect(SALARY_CURRENCIES).toContain(defaultSalaryCurrency(country));
  });
});

describe("readSalaryForm — the server rejects anything that is not one of the eight ISO codes", () => {
  const base = { salaryMin: "100000", salaryMax: "200000", salaryUnit: "month" };

  it.each([...SALARY_CURRENCIES])("accepts %s and stores the ISO code", (code) => {
    const r = readSalaryForm(form({ ...base, salaryCurrency: code }));
    expect(r).toEqual({
      ok: true,
      value: { salary_min: 100000, salary_max: 200000, salary_currency: code, salary_unit: "month" },
    });
  });

  const bad = ["naira", "usd ", " USD", "USD ", "XXX", "US$", "usd", "Usd", "ngn", "JPY", "EURO", "NG", "$", "€"];
  it.each(bad)("rejects %j when an amount is present", (value) => {
    const r = readSalaryForm(form({ ...base, salaryCurrency: value }));
    expect(r.ok).toBe(false);
  });

  it.each(bad)("rejects %j even when no amount is present (a tampered field is not silently dropped)", (value) => {
    const r = readSalaryForm(form({ salaryCurrency: value }));
    expect(r.ok).toBe(false);
  });

  it("keeps the rule: an amount with no currency is an error", () => {
    expect(readSalaryForm(form({ ...base, salaryCurrency: "" })).ok).toBe(false);
    expect(readSalaryForm(form(base)).ok).toBe(false);
  });

  it("keeps the rule: no amount stores no salary at all, whatever the select sent", () => {
    for (const code of SALARY_CURRENCIES) {
      const r = readSalaryForm(form({ salaryCurrency: code, salaryUnit: "month" }));
      expect(r).toEqual({
        ok: true,
        value: { salary_min: null, salary_max: null, salary_currency: null, salary_unit: null },
      });
    }
  });

  it("still rejects max < min", () => {
    expect(readSalaryForm(form({ salaryMin: "5", salaryMax: "1", salaryCurrency: "USD" })).ok).toBe(false);
  });
});

describe("salaryCurrencySelection — what the select shows", () => {
  it("shows the stored code when it is one of the eight (the edit form)", () => {
    expect(salaryCurrencySelection("GBP", "NGN")).toBe("GBP");
  });
  it("shows the org-country default when nothing is stored", () => {
    expect(salaryCurrencySelection(null, "KES")).toBe("KES");
    expect(salaryCurrencySelection(undefined, "KES")).toBe("KES");
    expect(salaryCurrencySelection("", "KES")).toBe("KES");
  });
  it("never silently re-labels a stored code outside the list: it forces an explicit choice", () => {
    expect(salaryCurrencySelection("JPY", "NGN")).toBe("");
  });
});
