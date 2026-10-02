/**
 * EMP-1 / E2 — the salary currency control on the post-a-job / edit-a-job
 * form is a select of exactly the eight ISO codes, preselected from the
 * employer's country on a new posting and from the STORED value on an edit.
 *
 * Server-rendered (react-dom/server), the same recipe as
 * job-share-button.test.tsx: the initial selection is what is under test, and
 * it is fully determined by the props.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SalaryCurrencyField } from "@/components/employer/salary-currency-field";
import { SALARY_CURRENCIES } from "@/lib/employer/salary-input";

function render(props: Partial<Parameters<typeof SalaryCurrencyField>[0]> = {}) {
  return renderToStaticMarkup(
    <SalaryCurrencyField stored={null} fallback="NGN" required={false} {...props} />,
  );
}

function optionValues(html: string): string[] {
  return [...html.matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]!);
}

function selectedValues(html: string): string[] {
  return [...html.matchAll(/<option value="([^"]*)"[^>]*\sselected/g)].map((m) => m[1]!);
}

describe("SalaryCurrencyField", () => {
  it("is a labelled select, not a free-text input", () => {
    const html = render();
    expect(html).toMatch(/<select[^>]*name="salaryCurrency"/);
    expect(html).not.toMatch(/<input[^>]*name="salaryCurrency"/);
    expect(html).toMatch(/<label[^>]*for="salaryCurrency"[^>]*>Salary currency<\/label>/);
    expect(html).toMatch(/<select[^>]*id="salaryCurrency"/);
  });

  it("offers exactly the eight ISO codes, as values, and nothing else", () => {
    expect(optionValues(render())).toEqual([...SALARY_CURRENCIES]);
  });

  it("preselects the org-country default on a new posting", () => {
    expect(selectedValues(render({ stored: null, fallback: "GBP" }))).toEqual(["GBP"]);
    expect(selectedValues(render({ stored: null, fallback: "KES" }))).toEqual(["KES"]);
    expect(selectedValues(render({ stored: undefined, fallback: "NGN" }))).toEqual(["NGN"]);
  });

  it("the edit form shows the STORED value, not the country default", () => {
    expect(selectedValues(render({ stored: "USD", fallback: "NGN" }))).toEqual(["USD"]);
    expect(selectedValues(render({ stored: "ZAR", fallback: "GBP" }))).toEqual(["ZAR"]);
  });

  it("a stored code outside the list is not relabelled: it asks for a choice", () => {
    const html = render({ stored: "JPY", fallback: "NGN" });
    // The eight codes plus one disabled placeholder, which is the selection.
    expect(optionValues(html)).toEqual(["", ...SALARY_CURRENCIES]);
    expect(selectedValues(html)).toEqual([""]);
    expect(html).toMatch(/<option value=""[^>]*disabled/);
  });

  it("is required only when the form says an amount is present", () => {
    expect(render({ required: true })).toMatch(/<select[^>]*\srequired/);
    expect(render({ required: false })).not.toMatch(/<select[^>]*\srequired/);
  });

  it("keeps a real >=40px hit target, with no border radius", () => {
    const html = render();
    expect(html).toContain("min-h-11");
    expect(html).not.toMatch(/rounded/);
  });
});
