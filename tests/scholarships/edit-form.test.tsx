/**
 * The edit-a-listing form (src/app/admin/(protected)/scholarships/[id]/edit/edit-scholarship-form.tsx), rendered to static markup: pre-filled with every stored field, "Save changes"
 * as its button, and for a PUBLISHED listing the owner's warning shown BEFORE saving (a pending listing shows none).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/scholarships/admin-edit-action", () => ({ updateScholarshipAction: async () => ({ status: "idle" }) }));
vi.mock("@/components/rich-text/minimal-rich-editor", () => ({
  MinimalRichEditor: ({ name, defaultValue, label }: { name: string; defaultValue?: string; label: string }) => (
    <div data-testid="editor" data-name={name} data-label={label}>{defaultValue}</div>
  ),
}));

import { EditScholarshipForm, type EditInitial } from "@/app/admin/(protected)/scholarships/[id]/edit/edit-scholarship-form";
import { PUBLISHED_EDIT_WARNING } from "@/lib/scholarships/admin-edit";

const initial: EditInitial = {
  provider: "QA Provider",
  programName: "QA Programme",
  hostInstitution: "Original host e1",
  degreeLevels: ["msc", "phd"],
  fieldTags: "Engineering, Geosciences",
  fundingType: "full",
  fundingCovers: "Tuition, Stipend",
  eligibilityNationalities: "Nigeria",
  eligibilityPriorDegree: "BSc",
  eligibilityAge: "Under 35",
  eligibilityOther: "Original note e1",
  applicationDeadline: "2026-12-01",
  cycleYear: "2027",
  officialUrl: "https://example.org/qa",
  sourceName: "Provider site",
  deadlineNote: "",
  reviewNote: "",
};

describe("EditScholarshipForm", () => {
  const pending = renderToStaticMarkup(<EditScholarshipForm id="s1" published={false} initial={initial} />);
  const published = renderToStaticMarkup(<EditScholarshipForm id="s1" published initial={initial} />);

  it("is pre-filled with every stored field, including the rich-text note", () => {
    for (const v of ["QA Provider", "QA Programme", "Original host e1", "Engineering, Geosciences", "Tuition, Stipend", "Nigeria", "BSc", "Under 35", "2026-12-01", "2027", "https://example.org/qa", "Provider site"]) {
      expect(pending, v).toContain(`value="${v}"`);
    }
    expect(pending).toMatch(/data-name="eligibilityOther"[^>]*>Original note e1</);
    const box = (level: string) => (pending.match(/<input[^>]*>/g) ?? []).find((t) => t.includes('name="degreeLevels"') && t.includes(`value="${level}"`)) ?? "";
    expect(box("msc")).toContain("checked");
    expect(box("phd")).toContain("checked");
    expect(box("bsc")).not.toBe("");
    expect(box("bsc")).not.toContain("checked");
  });

  it("has a 'Save changes' button and the labels the add form uses", () => {
    expect(pending).toContain("Save changes");
    for (const label of ["Host institution (optional)", "Deadline note — shown when there&#x27;s no single date", "Official source URL", "Programme name"]) expect(pending, label).toContain(label);
  });

  it("a PUBLISHED listing shows the warning before saving; a pending one shows none", () => {
    expect(published).toContain(PUBLISHED_EDIT_WARNING.replace("'", "&#x27;"));
    expect(pending).not.toContain("take this off the site");
  });

  it("submits through the form action (the keep-input helper hands the typed values back on an error, so no private submit handler is needed)", () => {
    const source = readFileSync(join(__dirname, "../../src/app/admin/(protected)/scholarships/[id]/edit/edit-scholarship-form.tsx"), "utf8");
    expect(source).toContain("<form action={formAction}");
    expect(source).not.toContain("onSubmit");
  });
});

describe("a refused save is brought into view (as on the New listing form, #849)", () => {
  it("the error banner sits at the top of a long form and Save at the bottom, so it scrolls into view when a save is refused", () => {
    const source = readFileSync(join(__dirname, "../../src/app/admin/(protected)/scholarships/[id]/edit/edit-scholarship-form.tsx"), "utf8");
    expect(source).toMatch(/scrollIntoView\(\{ block: "center"/);
    expect(source).toContain("ref={bannerRef}");
    expect(source).toMatch(/if \(state\.status === "idle"\) return;/);
  });
});

describe("the form is a client component and must stay free of server-only code", () => {
  it("imports only the client-safe constants module (not admin-edit, which pulls in the ingest writer and the service-role client)", async () => {
    const source = readFileSync(join(__dirname, "../../src/app/admin/(protected)/scholarships/[id]/edit/edit-scholarship-form.tsx"), "utf8");
    expect(source).not.toMatch(/from "@\/lib\/scholarships\/admin-edit"/);
    expect(source).toMatch(/from "@\/lib\/scholarships\/admin-edit-constants"/);
    const constants = readFileSync(join(__dirname, "../../src/lib/scholarships/admin-edit-constants.ts"), "utf8");
    expect(constants).not.toMatch(/import /);
  });
});
