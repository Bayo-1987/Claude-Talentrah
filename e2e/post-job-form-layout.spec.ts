/**
 * EMP-1 — the post-a-job / edit-a-job form, driven in a real browser against
 * the REAL `JobPostingForm` mounted by `/dev/job-posting-form-fixture`
 * (no employer account, no database: the same convention as
 * e2e/resume-editor-bullets.spec.ts's `/dev/resume-editor-fixture`).
 *
 *  E2  the salary currency is a select of exactly the eight ISO codes,
 *      defaulted from the employer's country and, on edit, showing the stored
 *      value. (The server-side rejection of non-ISO input is pinned in
 *      tests/employer/salary-currency.test.ts and job-posting-salary-edit.test.ts.)
 *  E4  the assessment exercise-files upload is visible only while "Attach an
 *      assessment" is ticked; unticking hides it without losing what was picked
 *      or uploaded; the Farah button carries the SVG mark.
 *  E5  the job description editor is exposed to assistive technology as a
 *      labelled textbox named "Job description" — checked through Chromium's
 *      real accessibility tree AND with axe-core.
 */
import { test, expect, type Page } from "@playwright/test";
import axe from "axe-core";

const CREATE = "/dev/job-posting-form-fixture";
const EDIT = "/dev/job-posting-form-fixture?mode=edit";

const CODES = ["NGN", "USD", "GBP", "EUR", "CAD", "KES", "GHS", "ZAR"];

async function currencyOptions(page: Page): Promise<string[]> {
  return page.locator("select#salaryCurrency option").evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
}

async function currencyValue(page: Page): Promise<string> {
  return page.locator("select#salaryCurrency").inputValue();
}

test.describe("E2 — salary currency select", () => {
  test("is a select of exactly the eight ISO codes, not a text box", async ({ page }) => {
    await page.goto(CREATE);
    await expect(page.locator("select#salaryCurrency")).toBeVisible();
    await expect(page.locator('input[name="salaryCurrency"]')).toHaveCount(0);
    expect(await currencyOptions(page)).toEqual(CODES);
    await expect(page.getByLabel("Salary currency")).toBeVisible();
  });

  const byCountry: Array<[string, string]> = [
    ["Nigeria", "NGN"],
    ["Ghana", "GHS"],
    ["Kenya", "KES"],
    ["South Africa", "ZAR"],
    ["United Kingdom", "GBP"],
    ["United States", "USD"],
    ["Canada", "CAD"],
    ["Germany", "EUR"],
    ["Other", "NGN"],
  ];
  for (const [country, code] of byCountry) {
    test(`defaults to ${code} for ${country}`, async ({ page }) => {
      await page.goto(`${CREATE}?country=${encodeURIComponent(country)}`);
      expect(await currencyValue(page)).toBe(code);
    });
  }

  test("falls back to NGN when the country is unknown or missing", async ({ page }) => {
    await page.goto(CREATE);
    expect(await currencyValue(page)).toBe("NGN");
    await page.goto(`${CREATE}?country=Narnia`);
    expect(await currencyValue(page)).toBe("NGN");
  });

  test("the edit form shows the STORED currency, not the country default", async ({ page }) => {
    await page.goto(`${EDIT}&country=Nigeria`);
    expect(await currencyValue(page)).toBe("GBP");
  });

  test("picking a currency submits exactly its ISO code", async ({ page }) => {
    await page.goto(CREATE);
    await page.getByLabel("Salary currency").selectOption("KES");
    const submitted = await page.locator("form").evaluate((form) => new FormData(form as HTMLFormElement).get("salaryCurrency"));
    expect(submitted).toBe("KES");
  });
});

test.describe("E4 — assessment exercise files sit under the checkbox", () => {
  test("Create: hidden until ticked, and a pick survives unticking", async ({ page }) => {
    await page.goto(CREATE);
    const section = page.locator("#assessment-exercise-files");
    await expect(section).toBeHidden();
    await expect(page.getByText("Assessment exercise files")).toBeHidden();

    await page.getByLabel("Attach an assessment (optional)").check();
    await expect(section).toBeVisible();
    await expect(page.getByText("Assessment exercise files")).toBeVisible();
    // Under the checkbox, inside the assessment's own box.
    const checkbox = await page.getByLabel("Attach an assessment (optional)").boundingBox();
    const box = await section.boundingBox();
    expect(box!.y).toBeGreaterThan(checkbox!.y);

    await page.setInputFiles("#new-job-assessment-files", {
      name: "brief.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("A short written brief."),
    });
    await expect(page.getByText("brief.txt")).toBeVisible();

    // Unticking hides the section but does not throw the pick away…
    await page.getByLabel("Attach an assessment (optional)").uncheck();
    await expect(section).toBeHidden();
    await expect(page.getByText("brief.txt")).toBeHidden();

    // …and ticking again brings the same file back.
    await page.getByLabel("Attach an assessment (optional)").check();
    await expect(page.getByText("brief.txt")).toBeVisible();
  });

  test("Edit: a saved assessment's files are under the checkbox, hidden on untick, back on re-tick", async ({ page }) => {
    await page.goto(EDIT);
    const section = page.locator("#assessment-exercise-files");
    await expect(page.getByLabel("Attach an assessment (optional)")).toBeChecked();
    await expect(section).toBeVisible();
    await expect(page.getByText("brief.pdf")).toBeVisible();
    await expect(page.getByText("schema.txt")).toBeVisible();

    await page.getByLabel("Attach an assessment (optional)").uncheck();
    await expect(page.getByText("Assessment exercise files")).toHaveCount(0);
    await expect(page.getByText("brief.pdf")).toHaveCount(0);

    // Nothing was deleted by unticking (only Save does that): re-ticking restores the list.
    await page.getByLabel("Attach an assessment (optional)").check();
    await expect(page.getByText("brief.pdf")).toBeVisible();
    await expect(page.getByText("schema.txt")).toBeVisible();
  });

  test("the Farah button renders the SVG mark, has its accessible name, and no text glyph", async ({ page }) => {
    await page.goto(CREATE);
    const button = page.getByRole("button", { name: "Let Farah scope this job" });
    await expect(button).toBeVisible();
    await expect(button.locator("svg")).toHaveCount(1);
    await expect(button.locator("svg circle")).not.toHaveCount(0);
    expect(await button.textContent()).not.toContain("✦");
    // Its name is exactly its words (the mark is aria-hidden).
    await expect(button.locator("svg")).toHaveAttribute("aria-hidden", "true");
    // A real hit target.
    const box = await button.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(40);
  });
});

test.describe("E5 — the job description editor is a labelled textbox", () => {
  test("Chromium's accessibility tree exposes a textbox named 'Job description'", async ({ page }) => {
    await page.goto(CREATE);
    const editor = page.getByRole("textbox", { name: "Job description", exact: true });
    await expect(editor).toHaveCount(1);
    await expect(editor).toBeVisible();

    // What the browser itself computed, not what the source says.
    const snapshot = await page.getByRole("textbox", { name: "Job description", exact: true }).ariaSnapshot();
    expect(snapshot).toContain('textbox "Job description"');

    const attrs = await editor.evaluate((el) => ({
      role: el.getAttribute("role"),
      multiline: el.getAttribute("aria-multiline"),
      labelledby: el.getAttribute("aria-labelledby"),
      label: document.getElementById(el.getAttribute("aria-labelledby") ?? "")?.textContent?.trim(),
      editable: (el as HTMLElement).isContentEditable,
    }));
    expect(attrs.role).toBe("textbox");
    expect(attrs.multiline).toBe("true");
    expect(attrs.label).toBe("Job description");
    expect(attrs.editable).toBe(true);
  });

  test("axe finds no violation on the editor, and the assessment-instructions editor is a different, labelled textbox", async ({ page }) => {
    await page.goto(CREATE);
    await page.getByLabel("Attach an assessment (optional)").check();
    await page.evaluate(axe.source);
    const results = await page.evaluate(async (): Promise<{
      violations: { id: string; impact: string | null; targets: string[] }[];
      passes: string[];
    }> => {
      // axe is injected into the page just above; it is not a global the TS config knows about.
      const injected = (window as unknown as { axe: typeof axe }).axe;
      // `region` ("all content belongs in a landmark") is about the PAGE, and
      // this fixture is deliberately outside the app shell that supplies <main>;
      // it would flag every node on the page whatever the editor does.
      const r = await injected.run(document, { rules: { region: { enabled: false } } });
      return {
        violations: r.violations.map((v) => ({
          id: v.id,
          impact: v.impact ?? null,
          targets: v.nodes.map((n) => n.target.join(" ")),
        })),
        passes: r.passes.map((p) => p.id),
      };
    });

    const touchingEditors = results.violations.filter((v) =>
      v.targets.some((t) => t.includes("#description") || t.includes("#assessment-instructions")),
    );
    expect(touchingEditors).toEqual([]);
    // The textbox-name rules actually ran and passed (an empty result proves nothing on its own).
    expect(results.passes).toContain("aria-input-field-name");

    await expect(page.getByRole("textbox", { name: "Instructions", exact: true })).toHaveCount(1);
    await expect(page.getByRole("textbox", { name: "Job description", exact: true })).toHaveCount(1);
  });
});
