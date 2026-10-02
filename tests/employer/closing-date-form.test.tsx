/**
 * The post-a-job form's "Closes" control (EMP-1 / E3): preselects "30 days" when CREATING, keeps "No expiry"
 * selectable, and leaves an existing posting exactly as it is.
 *
 * Only the closing control is asserted here. The date itself is never decided in the browser: the form posts a
 * duration and the server computes the timestamp (tests/employer/closing-date-default.test.ts).
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/employer/actions", () => ({}));

import { JobPostingForm, type JobFormValues } from "@/components/employer/job-posting-form";

const noop = async () => null;

function selectedValue(html: string): string | null {
  const select = html.match(/<select[^>]*id="expiresIn"[^>]*>([\s\S]*?)<\/select>/);
  if (!select) return null;
  const selected = select[1].match(/<option[^>]*value="([^"]*)"[^>]*selected=""|<option[^>]*selected=""[^>]*value="([^"]*)"/);
  return selected ? (selected[1] ?? selected[2]) : null;
}

const existing: JobFormValues = {
  title: "T",
  location: "",
  description: "d".repeat(50),
  workType: null,
  employmentType: null,
  seniority: null,
  yearsExperienceMin: null,
  expiresAt: null,
  salaryMin: null,
  salaryMax: null,
  salaryCurrency: null,
  salaryUnit: null,
  skills: ["sql"],
};

describe("the Closes control", () => {
  it("a new posting preselects 30 days, and 'No expiry' is still an option", () => {
    const html = renderToStaticMarkup(
      <JobPostingForm action={noop} submitLabel="Publish" pendingLabel="…" defaultExpiryDays={30} />,
    );
    expect(selectedValue(html)).toBe("30");
    expect(html).toContain('<option value="">No expiry</option>');
  });

  it("an existing posting with NO expiry stays on 'No expiry' (no default is applied to existing rows)", () => {
    const html = renderToStaticMarkup(
      <JobPostingForm action={noop} submitLabel="Save" pendingLabel="…" initial={existing} />,
    );
    expect(selectedValue(html)).toBe("");
  });

  it("an existing posting WITH an expiry keeps it", () => {
    const html = renderToStaticMarkup(
      <JobPostingForm
        action={noop}
        submitLabel="Save"
        pendingLabel="…"
        initial={{ ...existing, expiresAt: "2026-11-01T12:00:00.000Z" }}
      />,
    );
    expect(selectedValue(html)).toBe("keep");
  });
});
