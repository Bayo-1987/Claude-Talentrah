/**
 * Resume editor fields are PROGRAMMATICALLY associated with their labels,
 * not just visually adjacent.
 *
 * TextField (src/components/ui/text-field.tsx) only wires
 * `<label htmlFor={inputId}>` to `<input id={inputId}>` when the caller
 * passes `id` or `name` — `const inputId = id ?? props.name` is `undefined`
 * otherwise, so the label renders right next to the input but the two are
 * not connected in the accessibility tree. resume-editor.tsx's Contact,
 * Experience and Education fields passed neither: the form looked correct
 * and worked with a mouse, but `getByLabel("Full name")` found nothing
 * (confirmed directly against the rendered page before this fix) and a
 * screen reader could not announce which field was which. Fixed by giving
 * every field a stable, and — for the repeated Experience/Education rows —
 * per-entry-unique, id.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { StructuredResume } from "@/lib/resume/types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));

const { ResumeEditor } = await import("@/components/resume-builder/resume-editor");

const CONTENT: StructuredResume = {
  contact: {
    name: "Ada Bello",
    email: "ada@example.com",
    phone: "+234 800 000 0000",
    location: "Lagos, Nigeria",
  },
  summary: "",
  experience: [
    {
      title: "Backend Engineer",
      company: "Zaria Digital",
      location: "Lagos",
      startDate: "2022",
      endDate: "",
      description: "",
    },
    {
      title: "Support Engineer",
      company: "Acme",
      location: "Abuja",
      startDate: "2020",
      endDate: "2022",
      description: "",
    },
  ],
  education: [{ school: "University of Lagos", degree: "BSc Computer Science", field: "" }],
  skills: [],
  projects: [],
  certifications: [],
};

const html = renderToStaticMarkup(
  <ResumeEditor resumeId="r1" initialTitle="My Resume" initialContent={CONTENT} />,
);

/** `for="id"` on a label and `id="id"` on an input is exactly the pairing getByLabel/screen readers rely on. */
function isAssociated(id: string) {
  return html.includes(`for="${id}"`) && html.includes(`id="${id}"`);
}

describe("every Contact field is associated with its label", () => {
  it.each([
    ["contact-full-name", "Full name"],
    ["contact-location", "Location"],
    ["contact-email", "Email"],
    ["contact-phone", "Phone"],
  ])("%s -> %s", (id, label) => {
    expect(isAssociated(id), `no matching for="${id}"/id="${id}" pair`).toBe(true);
    expect(html).toContain(`>${label}</label>`);
  });
});

describe("repeated Experience rows get distinct ids, not one id reused across rows", () => {
  it("row 0 and row 1 each have their own real, associated 'Title' field", () => {
    expect(isAssociated("experience-0-title")).toBe(true);
    expect(isAssociated("experience-1-title")).toBe(true);
    // Not the same id rendered twice — that would make getByLabel("Title")
    // ambiguous and leave it undefined which row's input actually gets focus.
    expect(html.split('id="experience-0-title"')).toHaveLength(2);
    expect(html.split('id="experience-1-title"')).toHaveLength(2);
  });

  it("Company, Start date and End date are associated on both rows", () => {
    for (const field of ["company", "start-date", "end-date"]) {
      expect(isAssociated(`experience-0-${field}`)).toBe(true);
      expect(isAssociated(`experience-1-${field}`)).toBe(true);
    }
  });
});

describe("Education fields are associated", () => {
  it("School and Degree", () => {
    expect(isAssociated("education-0-school")).toBe(true);
    expect(isAssociated("education-0-degree")).toBe(true);
  });
});
