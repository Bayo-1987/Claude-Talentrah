/**
 * Two rendering rules that hold for EVERY template, so each is checked
 * against every registered slug and every skeleton demo config:
 *
 *  1. Bulleted content is real list markup. A stored achievement is one `<li>`
 *     in a `<ul>`. (Text typed with dashes, or glued into one string, is split
 *     when a resume is TAILORED, not on render: see
 *     old-format-resume-render.test.tsx.)
 *
 *  2. Certifications go into two compact columns from 8 entries up (a long
 *     single column of one-line items runs a resume onto an extra page), and
 *     stay a single column below that. Layouts that cannot take two columns
 *     (a 200px rail or sidebar, a label:value register, a half-width or
 *     narrow footer column, the run-in line Statute uses) are listed explicitly in
 *     SINGLE_COLUMN_BY_DESIGN, so a template added later is held to the rule
 *     unless someone decides otherwise on purpose.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DEMO_CONFIGS, CATALOG_TEMPLATE_CONFIGS, renderTemplateConfig } from "@/components/resume-builder/skeletons";
import { TemplateRenderer, registeredSlugs } from "@/components/resume-builder/templates";
import { EMPTY_RESUME, type StructuredResume } from "@/lib/resume/types";

const TWO_COLUMN_MIN = 8;

const NARROW_SKELETONS = new Set(["sidebar-left", "rail-right"]);
/** Bespoke templates whose certifications are not a full-width list. */
const SINGLE_COLUMN_BY_DESIGN = new Set(["statute", "public-record", "portfolio-grid", "pipeline", "critical-path"]);

type Case = { name: string; render: (resume: StructuredResume) => string; narrow: boolean };

const cases: Case[] = [
  ...Object.entries(DEMO_CONFIGS).map(([key, config]) => ({
    name: `demo:${key}`,
    render: (resume: StructuredResume) => renderToStaticMarkup(renderTemplateConfig(config, resume)),
    narrow: NARROW_SKELETONS.has(config.skeleton),
  })),
  ...registeredSlugs().map((slug) => ({
    name: `slug:${slug}`,
    render: (resume: StructuredResume) => renderToStaticMarkup(createElement(TemplateRenderer, { slug, resume })),
    narrow:
      SINGLE_COLUMN_BY_DESIGN.has(slug) ||
      (slug in CATALOG_TEMPLATE_CONFIGS && NARROW_SKELETONS.has(CATALOG_TEMPLATE_CONFIGS[slug].skeleton)),
  })),
];

function resumeWith(overrides: Partial<StructuredResume>): StructuredResume {
  return {
    ...EMPTY_RESUME,
    contact: { name: "Ada Obi" },
    summary: "A summary.",
    experience: [{ title: "Head of Ops", company: "Northbridge", startDate: "Sep 2022", endDate: "Present" }],
    education: [{ school: "UniLag", degree: "B.Sc." }],
    skills: ["SQL"],
    projects: ["A project"],
    ...overrides,
  };
}

const certs = (n: number) => Array.from({ length: n }, (_, i) => `ZQCERT${String(i + 1).padStart(2, "0")} Certification ${i + 1}`);

/** The opening tag of the <ul> that holds the first certification, or undefined if certifications are not in a <ul>. */
function certificationListTag(html: string): string | undefined {
  const at = html.indexOf("ZQCERT01");
  if (at < 0) return undefined;
  const open = html.lastIndexOf("<ul", at);
  const close = html.lastIndexOf("</ul>", at);
  return open > close ? html.slice(open, html.indexOf(">", open) + 1) : undefined;
}

describe("achievements are real list items in every template", () => {
  const bulleted = resumeWith({
    experience: [
      { title: "Head of Ops", company: "Northbridge", startDate: "Sep 2022", endDate: "Present", bullets: ["ZQBUL1 Cut cycle time.", "ZQBUL2 Grew the team.", "ZQBUL3 Ran the audit."] },
    ],
  });

  it("there are templates to check", () => {
    expect(cases.length).toBeGreaterThanOrEqual(8);
  });

  for (const { name, render } of cases) {
    it(`${name}: each stored achievement is its own <li>`, () => {
      const html = render(bulleted);
      for (const n of [1, 2, 3]) {
        expect(html, `${name}: ZQBUL${n} is not inside an <li>`).toMatch(new RegExp(`<li[^>]*>ZQBUL${n} `));
      }
    });
  }
});

describe("certifications: two columns from 8 entries, one column below", () => {
  for (const { name, render, narrow } of cases) {
    it(`${name}`, () => {
      const few = certificationListTag(render(resumeWith({ certifications: certs(TWO_COLUMN_MIN - 1) })));
      const many = certificationListTag(render(resumeWith({ certifications: certs(TWO_COLUMN_MIN) })));
      const manyHtml = render(resumeWith({ certifications: certs(18) }));

      if (few === undefined && many === undefined) {
        // This template does not put certifications in a list (Statute's run-in line, label:value rows) or
        // its config leaves the section out. Either way there is no column to count.
        return;
      }

      expect(few, `${name}: 7 certifications must stay a single column`).not.toMatch(/grid-cols-2/);
      if (narrow) {
        expect(many, `${name}: a narrow column cannot take two columns`).not.toMatch(/grid-cols-2/);
      } else {
        expect(many, `${name}: 8 certifications should be two columns`).toMatch(/grid-cols-2/);
        expect(certificationListTag(manyHtml), `${name}: 18 certifications should be two columns`).toMatch(/grid-cols-2/);
      }
    });
  }

  it("at least a few templates actually exercise the two-column branch (the loop above must not be vacuous)", () => {
    const twoColumn = cases.filter(({ render, narrow }) => {
      if (narrow) return false;
      return /grid-cols-2/.test(certificationListTag(render(resumeWith({ certifications: certs(18) }))) ?? "");
    });
    expect(twoColumn.length).toBeGreaterThanOrEqual(5);
  });
});
