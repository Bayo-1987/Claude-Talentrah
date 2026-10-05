/**
 * What the mentor application form shows (S1-93): which fields are required, the error under each field the server refused, and the typed values coming back after
 * a refusal instead of an empty form. Real renderToStaticMarkup on the form's own view (the same convention as tests/talent-directory/preview-panel.test.tsx).
 * The bio editor is a client-only TipTap component that renders nothing until it hydrates, so its error is rendered by the form, outside the editor, and is
 * asserted here; the editor's own text is not.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { ApplicationFormView, type ApplicationFormState } from "@/app/(app)/mentorship/apply/application-form";
import type { OwnMentorProfile } from "@/lib/mentorship/queries";

const noop = () => {};
const IDLE: ApplicationFormState = { status: "idle", message: "" };

const SAVED: OwnMentorProfile = {
  status: "pending",
  displayName: "Saved Name",
  bio: "Saved bio ".repeat(10),
  expertiseRoles: ["Product Manager"],
  expertiseIndustries: ["Fintech"],
  yearsExperience: 8,
  basePriceNgn: 15000,
  reviewNote: null,
  reviewsVerifications: false,
  selfPaused: false,
};

const render = (existing: OwnMentorProfile | null, state: ApplicationFormState = IDLE, pending = false) =>
  renderToStaticMarkup(<ApplicationFormView existing={existing} state={state} formAction={noop} pending={pending} />);

const REFUSED: ApplicationFormState = {
  status: "error",
  message: "Some details are missing or need fixing. The fields to fix are marked below.",
  fieldErrors: {
    displayName: "Enter the name mentees will see.",
    bio: "Write a bio of at least 80 characters about your experience and who you can help.",
    expertiseRoles: "Add at least one role you can speak to, for example Product Manager.",
    yearsExperience: "Enter your years of experience as a whole number from 0 to 60.",
    basePriceNgn: "Enter the price as a positive whole number of Naira, or leave it blank if you are free or a volunteer.",
  },
  values: { displayName: "", bio: "", expertiseRoles: "", expertiseIndustries: "Fintech", yearsExperience: "99", basePriceNgn: "-5" },
};

describe("a new application", () => {
  const html = render(null);

  it("says which fields are required, and that the price and industries are optional", () => {
    expect(html).toContain("Display name (shown to mentees, required)");
    expect(html).toContain("Roles you can speak to (required, comma-separated)");
    expect(html).toContain("Years of experience (required, 0 to 60)");
    expect(html).toContain("Industries (optional, comma-separated)");
    expect(html).toContain("leave blank if free/volunteer");
  });

  it("the bio label (inside the client-only editor, so not in the static markup) also says required and 80 characters", () => {
    expect(readFileSync(join(__dirname, "../../src/app/(app)/mentorship/apply/application-form.tsx"), "utf8")).toContain('label="Bio (required, at least 80 characters)"');
  });

  it("is a 'Submit application' button with every field empty and no errors", () => {
    expect(html).toContain("Submit application");
    expect(html).not.toContain("Save changes");
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain("text-rust");
  });

  it("has its status region in the page from the first render, empty, so the first message is announced rather than inserted silently", () => {
    expect(html).toMatch(/<div[^>]*role="status"[^>]*aria-live="polite"[^>]*><\/div>/);
  });

  it("leaves the checking to the server: the form is noValidate, so a browser tooltip never replaces the server's message", () => {
    expect(html).toMatch(/<form[^>]* noValidate/);
  });
});

describe("after the server refused the form", () => {
  const html = render(null, REFUSED);

  it("announces the summary through the status region (polite, atomic) and shows an error under each refused field", () => {
    expect(html).toMatch(/<div[^>]*role="status"[^>]*aria-live="polite"[^>]*aria-atomic="true"[^>]*><p[^>]*>Some details are missing or need fixing/);
    for (const message of Object.values(REFUSED.fieldErrors!)) expect(html).toContain(message);
  });

  it("does not also use role=alert, which would announce the same refusal twice", () => {
    expect(html).not.toContain('role="alert"');
  });

  it("marks each refused input invalid and links it to its own error text (aria-describedby points at the element that holds the message)", () => {
    expect((html.match(/aria-invalid="true"/g) ?? []).length).toBe(4);
    for (const [field, message] of [["displayName", REFUSED.fieldErrors!.displayName], ["expertiseRoles", REFUSED.fieldErrors!.expertiseRoles], ["yearsExperience", REFUSED.fieldErrors!.yearsExperience], ["basePriceNgn", REFUSED.fieldErrors!.basePriceNgn]] as const) {
      const input = new RegExp(`<input[^>]*id="${field}"[^>]*>`).exec(html)?.[0] ?? "";
      expect(input, `${field} has no aria-invalid`).toContain('aria-invalid="true"');
      const describedBy = /aria-describedby="([^"]+)"/.exec(input)?.[1];
      expect(describedBy, `${field} is not linked to its error`).toBeTruthy();
      expect(html).toMatch(new RegExp(`id="${describedBy}"[^>]*>${message!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}<`));
    }
  });

  it("an input with no error is not marked invalid and carries no aria-describedby", () => {
    const input = /<input[^>]*id="expertiseIndustries"[^>]*>/.exec(html)?.[0] ?? "";
    expect(input).not.toContain("aria-invalid");
    expect(input).not.toContain("aria-describedby");
  });

  it("the bio error has its own id, and the form hands the editor that id and the invalid state (the editor itself renders only in the browser)", () => {
    expect(html).toContain('id="bio-error"');
    const form = readFileSync(join(__dirname, "../../src/app/(app)/mentorship/apply/application-form.tsx"), "utf8");
    expect(form).toMatch(/<MinimalRichEditor[\s\S]*?describedBy=\{errors\.bio \? "bio-error" : undefined\}[\s\S]*?invalid=\{!!errors\.bio\}/);
    const editor = readFileSync(join(__dirname, "../../src/components/rich-text/minimal-rich-editor.tsx"), "utf8");
    expect(editor).toContain('setAttribute("aria-invalid", "true")');
    expect(editor).toContain('setAttribute("aria-describedby", describedBy)');
    expect(editor).toContain('removeAttribute("aria-invalid")');
  });

  it("shows what was typed again instead of an empty form", () => {
    expect(html).toContain('value="99"');
    expect(html).toContain('value="-5"');
    expect(html).toContain('value="Fintech"');
  });

  it("is still the application, not a saved profile", () => {
    expect(html).toContain("Submit application");
  });
});

describe("an existing application", () => {
  it("is 'Save changes' with the saved values filled in", () => {
    const html = render(SAVED);
    expect(html).toContain("Save changes");
    expect(html).toContain('value="Saved Name"');
    expect(html).toContain('value="Product Manager"');
    expect(html).toContain('value="Fintech"');
    expect(html).toContain('value="8"');
    expect(html).toContain('value="15000"');
  });

  it("a refused edit shows what was typed, not the saved values, and says what to fix", () => {
    const html = render(SAVED, { ...REFUSED, values: { ...REFUSED.values!, displayName: "Typed Over It", yearsExperience: "99" } });
    expect(html).toContain('value="Typed Over It"');
    expect(html).not.toContain('value="Saved Name"');
    expect(html).toContain("Enter your years of experience as a whole number from 0 to 60.");
    expect(html).toContain("Save changes");
  });

  it("a saved edit shows a plain status message and no errors", () => {
    const html = render(SAVED, { status: "success", message: "Saved." });
    expect(html).toMatch(/role="status"[^>]*aria-live="polite"[^>]*aria-atomic="true"[^>]*><p[^>]*>Saved\.</);
    expect(html).not.toContain('role="alert"');
  });

  it("a null years or price is an empty field, not the word 'null' or 0", () => {
    const html = render({ ...SAVED, yearsExperience: null, basePriceNgn: null });
    expect(html).not.toContain('value="null"');
    expect(html).not.toContain('value="0"');
  });
});

describe("while a submit is in flight", () => {
  it("the button is disabled", () => {
    expect(render(null, IDLE, true)).toMatch(/<button[^>]*disabled/);
  });
});
