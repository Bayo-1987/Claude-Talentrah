/**
 * The password rule checklist (signup and reset): a rule that is not met yet must be easy to see, and not by colour alone.
 *
 * It used to show a faint dot for a rule not yet met, which is easy to miss. Now:
 *   - met: a green check, and the text "Met: <rule>" for a screen reader;
 *   - not met: a cross (a different SHAPE, not only a different colour), normal-weight text, and "Not met: <rule>" for a screen reader;
 *   - the two states take exactly the same room, so the list does not jump while someone types;
 *   - every marker and text has a contrast of at least 4.5:1 against the backgrounds the form sits on.
 * Static markup, no browser: the pixel-level check that the list's height does not change is in e2e/password-checklist.spec.ts.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PasswordRequirements } from "@/components/auth/password-requirements";
import { PASSWORD_RULES } from "@/lib/auth/password-rules";
import { fakeSecret } from "../support/fake-secret";
import { contrast } from "../support/contrast";

const html = (password: string) => renderToStaticMarkup(createElement(PasswordRequirements, { password }));
const items = (markup: string) => [...markup.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map((m) => ({ outer: m[0], inner: m[1] }));
const plain = (inner: string) => inner.replace(/<[^>]*>/g, "");
const open = (li: string) => /<li\b[^>]*>/.exec(li)![0];

describe("what each rule says to a screen reader", () => {
  it("an empty password: every rule reads 'Not met: <the rule>'", () => {
    const lis = items(html(""));
    expect(lis).toHaveLength(PASSWORD_RULES.length);
    PASSWORD_RULES.forEach((rule, i) => expect(plain(lis[i].inner)).toContain(`Not met: ${rule.label}`));
  });

  it("a password that meets every rule: every rule reads 'Met: <the rule>'", () => {
    const lis = items(html(fakeSecret("password")));
    PASSWORD_RULES.forEach((rule, i) => expect(plain(lis[i].inner)).toContain(`Met: ${rule.label}`));
  });

  it("only the unmet rules read 'Not met'", () => {
    const noUpper = fakeSecret("password").toLowerCase();
    const lis = items(html(noUpper));
    const states = PASSWORD_RULES.map((r, i) => [r.key, /Not met:/.test(plain(lis[i].inner))] as const);
    expect(states).toEqual([["length", false], ["upper", true], ["lower", false], ["number", false]]);
  });

  it("the visible text of a rule is its label in both states (the prefix is for screen readers only)", () => {
    for (const markup of [html(""), html(fakeSecret("password"))]) {
      for (const li of items(markup)) expect(li.inner).toMatch(/<span class="sr-only">(Met|Not met): <\/span>/);
    }
  });
});

describe("the states differ in shape, not only in colour", () => {
  const svgOf = (li: string) => /<svg\b[\s\S]*?<\/svg>/.exec(li)![0];

  it("a met rule draws a check and an unmet rule draws a cross: different shapes", () => {
    const met = svgOf(items(html(fakeSecret("password")))[0].inner);
    const unmet = svgOf(items(html(""))[0].inner);
    expect(met).toContain('data-icon="check"');
    expect(unmet).toContain('data-icon="cross"');
    expect(met).not.toBe(unmet);
    expect(met.replace(/currentColor|stroke="[^"]*"/g, "")).not.toBe(unmet.replace(/currentColor|stroke="[^"]*"/g, ""));
  });

  it("the icons are decorative: hidden from screen readers (the text carries the state)", () => {
    for (const li of items(html(""))) expect(svgOfAria(li.inner)).toBe("true");
  });
  const svgOfAria = (inner: string) => /<svg\b[^>]*aria-hidden="([^"]*)"/.exec(inner)?.[1];

  it("an unmet rule is not a faint dot any more", () => {
    expect(html("")).not.toMatch(/<circle/);
  });
});

describe("the list does not move when a rule changes state", () => {
  it("every row has the same box in both states: same classes outside the colour, same icon size", () => {
    const strip = (tag: string) => tag.replace(/\btext-[a-z-]+\b/g, "").replace(/\s+/g, " ").trim();
    const empty = items(html(""));
    const full = items(html(fakeSecret("password")));
    for (let i = 0; i < PASSWORD_RULES.length; i++) {
      expect(strip(open(empty[i].outer))).toBe(strip(open(full[i].outer)));
      const size = (li: string) => /<svg\b[^>]*\bwidth="(\d+)"[^>]*\bheight="(\d+)"/.exec(li)?.slice(1, 3).join("x");
      expect(size(empty[i].inner), "icon size").toBe(size(full[i].inner));
      expect(size(empty[i].inner)).toBeTruthy();
    }
  });

  it("neither state changes the weight of the text (no bold on 'met' or 'not met')", () => {
    for (const markup of [html(""), html(fakeSecret("password"))]) expect(markup).not.toMatch(/font-(semibold|bold|medium)/);
  });
});

describe("contrast: every marker and text is at least 4.5:1 on the backgrounds the form sits on", () => {
  it.each(["paper", "card", "paper-alt"])("met (green) and unmet (rust marker, ink-soft text) on --%s", (bg) => {
    for (const fg of ["green", "rust", "ink-soft"]) expect(contrast(fg, bg), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
  });

  it("the markup uses those tokens: green for met, rust for the unmet marker, ink-soft for the unmet text", () => {
    const met = items(html(fakeSecret("password")))[0].outer;
    const unmet = items(html(""))[0].outer;
    expect(met).toContain("text-green");
    expect(unmet).toContain("text-ink-soft");
    expect(items(html(""))[0].inner).toContain("text-rust");
  });
});
