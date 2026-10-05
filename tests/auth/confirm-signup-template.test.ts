/**
 * The "Confirm sign up" email for the code flow (S1-101), as it is pasted into the Supabase dashboard (docs/auth-email-templates/). Nothing in the app sends it:
 * Supabase does, from the template the owner pastes. So the file is the thing under test: what it must contain (the code, the words, the logo, the brand's
 * colours) and what it must never contain (the confirmation link, scripts, external styles, anything that tracks).
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { EMAIL_COLORS } from "@/lib/email/layout";

const DIR = path.resolve(__dirname, "../../docs/auth-email-templates");
const html = readFileSync(path.join(DIR, "confirm-signup.html"), "utf8");
const subject = readFileSync(path.join(DIR, "confirm-signup.subject.txt"), "utf8");
const text = html.replace(/<[^>]+>/g, "\n").replace(/&rsquo;/g, "’").replace(/&middot;/g, "·");
const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

describe("the code", () => {
  it("is the template variable {{ .Token }}, once, large and spaced, as one text node (copying it gives the six digits, no spaces)", () => {
    expect(html.match(/\{\{ \.Token \}\}/g)).toHaveLength(1);
    expect(html).toMatch(/font:600 32px[^"]*letter-spacing:8px[^"]*">\{\{ \.Token \}\}<\/td>/);
  });
});

describe("the words", () => {
  it.each([
    "Confirm your email address",
    "Enter this code on Talentrah to finish signing up:",
    "The code expires in 15 minutes.",
    "If you didn’t sign up for Talentrah, you can ignore this email.",
  ])("says %j", (line) => {
    expect(lines).toContain(line);
  });

  it("has the heading as its title too", () => {
    expect(html).toContain("<title>Confirm your email address</title>");
  });

  it("the subject is the agreed one, with no code (or any template variable) in it", () => {
    expect(subject.trim()).toBe("Confirm your Talentrah email address");
    expect(subject).not.toContain("{{");
  });

  it("the preheader (the line a mail app shows beside the subject) does not contain the code", () => {
    expect(html).toMatch(/<div style="display:none[^"]*">Enter the code on Talentrah to finish signing up\.<\/div>/);
  });
});

describe("what it must not have", () => {
  it("has no confirmation link and no link at all", () => {
    expect(html).not.toContain("ConfirmationURL");
    expect(html).not.toContain("SiteURL");
    expect(html).not.toMatch(/<a[\s>]/i);
    expect(html).not.toMatch(/href=/i);
  });

  it("has no script, no external stylesheet, no @import, no web font, no forms", () => {
    for (const forbidden of [/<script/i, /<link/i, /@import/i, /@font-face/i, /<form/i, /<iframe/i, /url\(/i]) expect(html).not.toMatch(forbidden);
  });

  it("loads exactly one thing from outside: the logo. No tracking pixel, no other image", () => {
    expect(html.match(/<img/gi)).toHaveLength(1);
    expect(html.match(/https?:\/\/[^\s"')<]+/g)).toEqual(["https://www.talentrah.com/icons/talentrah-mark-48.png"]);
  });
});

describe("email-safe layout", () => {
  it("is tables with inline styles, role=presentation, and a width that gives way on a phone", () => {
    expect(html).toContain('<table role="presentation"');
    expect(html).toContain("width:100%;max-width:560px");
    expect(html).not.toMatch(/<div[^>]*(display:flex|display:grid)/);
    expect(html).not.toMatch(/<style/i);
  });

  it("has a language, a charset and a viewport", () => {
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain('name="viewport"');
  });

  it("the logo has the size and the alt text a client that blocks images falls back on", () => {
    expect(html).toMatch(/<img src="https:\/\/www\.talentrah\.com\/icons\/talentrah-mark-48\.png" width="40" height="40" alt="Talentrah"/);
    expect(existsSync(path.resolve(__dirname, "../../public/icons/talentrah-mark-48.png")), "the logo file is in public/, so it is served at that URL").toBe(true);
  });
});

describe("brand", () => {
  it("uses the repo's own email colours, not new ones", () => {
    for (const colour of [EMAIL_COLORS.background, EMAIL_COLORS.ink, EMAIL_COLORS.inkMuted, EMAIL_COLORS.line]) expect(html).toContain(colour);
    const used = new Set(html.match(/#[0-9a-f]{6}/gi)!.map((c) => c.toLowerCase()));
    const allowed = new Set([...Object.values(EMAIL_COLORS), "#fffdf9"].map((c) => c.toLowerCase()));
    for (const c of used) expect(allowed.has(c), `${c} is not one of the brand email colours`).toBe(true);
  });

  it("uses the same type as the other emails: Georgia for the heading, the system sans for the rest", () => {
    expect(html).toContain("Georgia,'Times New Roman',serif");
    expect(html).toContain("-apple-system,Segoe UI,Roboto,sans-serif");
  });

  it("ends with the muted, hairline-divided line the other emails end with", () => {
    expect(html).toContain(`border-top:1px solid ${EMAIL_COLORS.line}`);
    expect(lines.at(-1)).toBe("Talentrah · www.talentrah.com");
  });
});
