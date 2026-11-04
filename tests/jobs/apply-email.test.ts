/**
 * The one place an "apply by email" address is judged and turned into a link (src/lib/jobs/apply-email.ts).
 *
 * The rule is an ALLOWLIST that REFUSES and never repairs: anything that is not one plain ASCII address comes back null, so a stored value
 * can never put a second recipient, a header, a query parameter or a fragment into the mailto link. Trim and lower-case are the only changes made.
 * Every address below is invented (example domains and the reserved .test / .co names used throughout this repo's tests).
 */
import { describe, expect, it } from "vitest";
import { applyEmailHref, normaliseApplyEmail } from "@/lib/jobs/apply-email";

describe("normaliseApplyEmail: what is accepted", () => {
  it.each([
    ["a@b.co", "a@b.co"],
    ["  Careers@Example.TEST  ", "careers@example.test"],
    ["\tHR@Example.Test\n", "hr@example.test"],
    ["first.last+tag@sub.example.co.uk", "first.last+tag@sub.example.co.uk"],
    ["a_b-c@x-y.io", "a_b-c@x-y.io"],
    ["+a@b.co", "+a@b.co"],
    [`${"a".repeat(64)}@b.co`, `${"a".repeat(64)}@b.co`],
    ["a@b1.c2", "a@b1.c2"],
  ])("%j -> %j", (raw, expected) => {
    expect(normaliseApplyEmail(raw)).toBe(expected);
  });

  it("an address at exactly 254 characters is accepted, one more is refused", () => {
    const label = "d".repeat(63);
    const at254 = `a@${label}.${label}.${label}.${"e".repeat(254 - 2 - 63 * 3 - 3)}`;
    expect(at254).toHaveLength(254);
    expect(normaliseApplyEmail(at254)).toBe(at254);
    expect(normaliseApplyEmail(`${at254}e`)).toBeNull();
  });
});

describe("normaliseApplyEmail: nothing, or not text", () => {
  it.each([[null], [undefined], [""], ["   "], [42], [{}], [["a@b.co"]]])("%j -> null", (raw) => {
    expect(normaliseApplyEmail(raw as string | null | undefined)).toBeNull();
  });
});

describe("normaliseApplyEmail: every refusal", () => {
  const refused: Array<[string, string]> = [
    ["a space inside", "a b@c.co"],
    ["a space in the domain", "a@b c.co"],
    ["a comma list", "a@b.co,c@d.co"],
    ["a semicolon list", "a@b.co;c@d.co"],
    ["angle brackets", "<a@b.co>"],
    ["a display name", "Ann <a@b.co>"],
    ["quotes", '"a"@b.co'],
    ["two @", "a@@b.co"],
    ["two addresses with @", "a@b@c.co"],
    ["no @", "ab.co"],
    ["no local part", "@b.co"],
    ["no domain", "a@"],
    ["no dot in the domain", "a@localhost"],
    ["an empty label (double dot)", "a@b..co"],
    ["a leading dot in the domain", "a@.b.co"],
    ["a trailing dot in the domain", "a@b.co."],
    ["a leading hyphen in a label", "a@-b.co"],
    ["a trailing hyphen in a label", "a@b-.co"],
    ["an underscore in the domain", "a@b_c.co"],
    ["a local part of 65", `${"a".repeat(65)}@b.co`],
    ["255 characters", `a@${"d".repeat(63)}.${"d".repeat(63)}.${"d".repeat(63)}.${"e".repeat(254 - 2 - 63 * 3 - 3 + 1)}`],
    ["a hash in the local part", "a#b@c.co"],
    ["an apostrophe", "o'x@c.co"],
    ["a question mark in the local part", "a?x@b.co"],
    ["an ampersand", "a&b@c.co"],
    ["an equals sign", "a=b@c.co"],
    ["a slash", "a/b@c.co"],
    ["a percent sign", "a%b@c.co"],
    ["parentheses", "a(b)@c.co"],
    ["braces", "a{b}@c.co"],
    ["a pipe", "a|b@c.co"],
    ["a backslash", "a\\b@c.co"],
    ["a colon", "a:b@c.co"],
    ["a mailto: prefix", "mailto:a@b.co"],
    ["a query tail (header injection)", "a@b.co?cc=x"],
    ["an encoded newline tail", "a@b.co%0ABcc:x"],
    ["an encoded newline address", "%0ABcc:x"],
    ["a raw newline address", "\nBcc:x"],
    ["a raw newline tail", "a@b.co\nBcc:x"],
    ["a CRLF tail", "a@b.co\r\nBcc: x"],
    ["a parameter tail", "&cc=x"],
    ["a fragment tail", "a@b.co#x"],
    ["a NUL", "a\u0000@b.co"],
    ["a tab inside", "a\t@b.co"],
    ["U+2028 inside", "a b@c.co"],
    ["U+0085 inside", "a\u0085b@c.co"],
    ["a non-ASCII local part", "é@b.co"],
    ["a non-ASCII domain", "a@bé.co"],
    ["the Kelvin sign (which lower-cases to a plain k)", "K@b.co"],
    ["a full-width @", "a＠b.co"],
    ["a local part that starts with a dot", ".a@b.co"],
    ["a local part that ends with a dot", "a.@b.co"],
    ["a local part with two dots in a row", "a..b@c.co"],
    ["a local part that is only a dot", ".@b.co"],
  ];
  it.each(refused)("refuses %s", (_name, raw) => {
    expect(normaliseApplyEmail(raw)).toBeNull();
  });
  it("is refused, not repaired: no refused input comes back as a different address", () => {
    for (const [, raw] of refused) expect(normaliseApplyEmail(raw)).toBeNull();
  });
});

describe("applyEmailHref", () => {
  const subjectOf = (href: string) => new URL(href).searchParams.get("subject");

  it("is mailto: + the normalised address + ?subject= + the encoded subject, and nothing else", () => {
    expect(applyEmailHref(" Careers@Example.TEST ", "Operations Officer")).toBe("mailto:careers@example.test?subject=Application%3A%20Operations%20Officer");
  });
  it("is null for an address that is refused, so no link is ever built from it", () => {
    expect(applyEmailHref("a@b.co?cc=x", "Role")).toBeNull();
    expect(applyEmailHref(null, "Role")).toBeNull();
    expect(applyEmailHref(undefined, "Role")).toBeNull();
  });
  it("has exactly one query parameter, whatever the address or the title", () => {
    const href = applyEmailHref("a@b.co", "Cook & Chef ?cc=x&bcc=y #1")!;
    expect([...new URL(href).searchParams.keys()]).toEqual(["subject"]);
    expect(href.split("?")).toHaveLength(2);
    expect(href).not.toContain("#");
    expect(href).not.toMatch(/[\s"<>&]/);
  });
  it.each([
    ["ampersand", "Sales & Marketing Lead"],
    ["hash", "Level #2 Engineer"],
    ["percent", "100% Remote Analyst"],
    ["question mark", "Who? Analyst"],
    ["double quote", 'The "Best" Cook'],
    ["newline", "Line one\nLine two"],
    ["all of them", 'A & B # C % D ? E " F\nG'],
    ["unicode", "Ingénieur Données – Zürich ☕ 日本語 🚀"],
    ["plus and equals", "C++ = fun"],
  ])("the subject round-trips for a title with a %s", (_name, title) => {
    expect(subjectOf(applyEmailHref("a@b.co", title)!)).toBe(`Application: ${title}`);
  });
  it("the title is cut to 120 characters before encoding", () => {
    expect(subjectOf(applyEmailHref("a@b.co", "x".repeat(300))!)).toBe(`Application: ${"x".repeat(120)}`);
    expect(subjectOf(applyEmailHref("a@b.co", "y".repeat(120))!)).toBe(`Application: ${"y".repeat(120)}`);
  });
  it("the cut never splits an emoji (a split pair cannot be encoded)", () => {
    const title = `${"a".repeat(119)}🚀${"b".repeat(50)}`;
    const href = applyEmailHref("a@b.co", title);
    expect(href).not.toBeNull();
    expect(subjectOf(href!)).toBe(`Application: ${"a".repeat(119)}🚀`);
  });
  it("a title with a lone surrogate does not throw", () => {
    const href = applyEmailHref("a@b.co", `Bad \uD800 title \uDC00`);
    expect(href).toMatch(/^mailto:a@b\.co\?subject=/);
  });
  it("a missing or empty title still gives a valid subject", () => {
    expect(subjectOf(applyEmailHref("a@b.co", "")!)).toBe("Application: ");
    expect(subjectOf(applyEmailHref("a@b.co", undefined as unknown as string)!)).toBe("Application: ");
  });
});
