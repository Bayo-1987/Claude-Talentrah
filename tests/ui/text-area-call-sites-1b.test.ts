/**
 * Shared TextArea, PR 1b: every remaining raw <textarea> becomes the shared <TextArea>, and converting a field changes NO id, name, placeholder, test id, required/minLength
 * or payload (PR 1a's own promise: "swapping a raw one for this changes no payload and no e2e selector").
 *
 * How it is checked: each converted file is parsed with the TypeScript compiler, every <TextArea> element in it is found, and for each field below (found by a
 * selector attribute that did not change, such as its id or placeholder) the attributes the raw <textarea> carried must still be there, plus a non-empty `label` (the shared
 * component requires one; a field whose heading is already on the page uses `hideLabel`). Reached by source, not by rendering, because most of these components only show
 * the box after a click or a result (a popover, an editing mode, a tailoring result) and the existing e2e specs drive them for real.
 * The ratchet (tests/ui/no-raw-textarea.test.ts) separately fails on any raw <textarea> left outside the scholarship file.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");

interface Attr {
  text: string | true;
}
function textAreas(file: string): Array<Map<string, Attr>> {
  const src = readFileSync(join(ROOT, file), "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: Array<Map<string, Attr>> = [];
  const visit = (n: ts.Node) => {
    if ((ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)) && n.tagName.getText(sf) === "TextArea") {
      const attrs = new Map<string, Attr>();
      for (const a of n.attributes.properties) {
        if (!ts.isJsxAttribute(a)) continue;
        const name = a.name.getText(sf);
        const init = a.initializer;
        if (!init) attrs.set(name, { text: true });
        else if (ts.isStringLiteral(init)) attrs.set(name, { text: init.text });
        else attrs.set(name, { text: init.getText(sf).replace(/^\{|\}$/g, "").trim() });
      }
      found.push(attrs);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}

/** attr name -> the text it must carry ("true" for a bare boolean attribute); `*` = present and not blank. */
type Expect = Record<string, string>;
interface Field {
  file: string;
  /** How to find this field's <TextArea>: an attribute and the text it carries. */
  find: [attr: string, text: string];
  expect: Expect;
}

const FIELDS: Field[] = [
  { file: "src/app/(app)/mentorship/sessions/review-form.tsx", find: ["placeholder", "Optional note for other seekers"], expect: { label: "*", value: "text", onChange: "*" } },
  {
    file: "src/app/employer/talent-directory/[candidateId]/contact-request-form.tsx",
    find: ["id", "contact-message"],
    expect: { name: "message", required: "true", placeholder: "What the role is, and why their profile stood out.", label: "*" },
  },
  { file: "src/components/admin/blog-post-form.tsx", find: ["id", "body"], expect: { name: "body", required: "true", mono: "true", label: "*" } },
  { file: "src/components/admin/decision-form.tsx", find: ["name", "{noteName}".replace(/^\{|\}$/g, "")], expect: { placeholder: "notePlaceholder", label: "*" } },
  { file: "src/components/jobs/screening-gate-apply.tsx", find: ["id", "assessment-response-text"], expect: { value: "responseText", placeholder: "Write your answer here, or attach a file / link below instead.", label: "Your response" } },
  { file: "src/components/marketing/jd-demo-input.tsx", find: ["id", "jd-demo"], expect: { disabled: "busy", placeholder: "Paste the job description here and Farah will tailor a resume to it…", label: "Job description", hideLabel: "true", compact: "true" } },
  { file: "src/components/resume-builder/resume-editor.tsx", find: ["id", "projects-field"], expect: { placeholder: "One project per line", label: "*" } },
  { file: "src/components/resume-builder/resume-editor.tsx", find: ["id", "certifications-field"], expect: { placeholder: "One certification per line", label: "*" } },
  { file: "src/components/resume-builder/resume-editor.tsx", find: ["id", "awards-field"], expect: { placeholder: "One award per line", label: "*" } },
  { file: "src/components/resume-builder/resume-editor.tsx", find: ["id", "publications-field"], expect: { placeholder: "One publication per line", label: "*" } },
  { file: "src/components/resume-builder/resume-editor.tsx", find: ["placeholder", "What you did"], expect: { label: "*" } },
  { file: "src/components/resume-builder/resume-editor.tsx", find: ["id", "`custom-section-${i}-items`"], expect: { label: "Items (one per line)" } },
  { file: "src/components/scholarships/farah-actions.tsx", find: ["id", "`motivation-${scholarshipId}`"], expect: { placeholder: "A sentence or two in your own words.", label: "*" } },
  { file: "src/components/tailoring/tailor-form.tsx", find: ["placeholder", "Paste the full job description here…"], expect: { required: "true", minLength: "50", label: "*" } },
  { file: "src/components/tailoring/tailor-form.tsx", find: ["value", "editedTexts[addition.id] ?? addition.text"], expect: { label: "*", hideLabel: "true" } },
  { file: "src/components/tracker/notes-form.tsx", find: ["name", "notes"], expect: { "data-testid": "notes-textarea", placeholder: "Interview dates, contacts, next steps…", defaultValue: "*", textareaRef: "textareaRef", label: "*" } },
];

describe("TextArea 1b: each converted field keeps what the raw <textarea> carried", () => {
  for (const f of FIELDS) {
    it(`${f.file}: the field with ${f.find[0]} = ${f.find[1]}`, () => {
      const all = textAreas(f.file);
      const [attr, text] = f.find;
      const mine = all.find((a) => {
        const v = a.get(attr);
        return v !== undefined && v.text !== true && v.text.includes(text);
      });
      expect(mine, `no <TextArea ${attr}=…${text}…> in ${f.file} (found ${all.length} <TextArea> elements)`).toBeDefined();
      for (const [name, want] of Object.entries(f.expect)) {
        const got = mine!.get(name);
        expect(got, `<TextArea> for ${text} has no ${name}`).toBeDefined();
        const shown = got!.text === true ? "true" : got!.text;
        if (want === "*") expect(shown.replace(/^["'`]|["'`]$/g, "").trim().length, `${name} is blank`).toBeGreaterThan(0);
        else expect(shown, `${name} of the <TextArea> for ${text}`).toContain(want);
      }
    });
  }

  it("covers every <TextArea> a converted file contains (no field is left without a row in the table above)", () => {
    const expected: Record<string, number> = {};
    for (const f of FIELDS) expected[f.file] = (expected[f.file] ?? 0) + 1;
    for (const [file, n] of Object.entries(expected)) {
      expect(textAreas(file).length, `${file} has a different number of <TextArea> elements than the table`).toBe(n);
    }
  });
});
