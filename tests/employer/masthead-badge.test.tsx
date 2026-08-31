/**
 * The org badge is omitted when there is no organisation.
 *
 * It used to fall back to a literal em dash, rendered inside a 34x34 solid-ink
 * square. A dash centred in a black box does not read as "no organisation
 * yet" — it reads as a badge that failed to load, and the screen where it
 * appeared was /employer/onboarding, where having no organisation is the
 * normal state rather than an error.
 *
 * A badge is an identity marker. With no identity there is nothing to mark.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { EmployerMasthead } from "@/components/employer/employer-masthead";
import { orgInitials } from "@/lib/employer/org-initials";

const BADGE = 'class="flex h-[34px] w-[34px] items-center justify-center bg-ink';

describe("with no organisation", () => {
  it("renders no badge at all", () => {
    const html = renderToStaticMarkup(<EmployerMasthead orgInitials={null} orgName="" />);
    expect(html, "an empty badge square was rendered").not.toContain(BADGE);
  });

  it("renders no stray placeholder character", () => {
    const html = renderToStaticMarkup(<EmployerMasthead orgInitials={null} orgName="" />);
    // The specific regression: an em dash sitting where initials belong.
    expect(html).not.toContain("—</div>");
  });

  it("still renders the masthead itself", () => {
    // The badge going missing must not take the nav with it.
    const html = renderToStaticMarkup(<EmployerMasthead orgInitials={null} orgName="" />);
    expect(html.length).toBeGreaterThan(200);
  });
});

describe("with an organisation", () => {
  it("renders the badge with its initials", () => {
    const html = renderToStaticMarkup(<EmployerMasthead orgInitials="ZD" orgName="Zaria Digital" />);
    expect(html).toContain(BADGE);
    expect(html).toContain("ZD");
    expect(html).toContain('title="Zaria Digital"');
  });
});

describe("the initials rule itself", () => {
  // Extracted from the layout precisely so this can be asserted: the previous
  // `|| "—"` typechecked fine against `string | null` and no test could see it.
  it.each([
    ["", null],
    ["   ", null],
    [null, null],
    [undefined, null],
    ["Zaria Digital", "ZD"],
    ["Moniepoint", "M"],
    ["a b c d", "AB"],
  ])("%s -> %s", (input, expected) => {
    expect(orgInitials(input as string | null | undefined)).toBe(expected);
  });

  it("never returns a placeholder character", () => {
    for (const empty of ["", "   ", null, undefined]) {
      const out = orgInitials(empty as string | null | undefined);
      expect(out, "an empty name produced a renderable placeholder").toBeNull();
    }
  });
});
