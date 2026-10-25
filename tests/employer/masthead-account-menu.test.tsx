/**
 * The employer header's account menu, as far as it can be pinned without a browser: what the header renders closed, that there is ONE menu component shared with the seeker header, and that nothing
 * under the employer pages carries its own copy of Sign out or its own header. What a person does with the open menu (keyboard, focus, outside click, phone width) is e2e/account-menu.spec.ts,
 * which mounts the same two headers in a real browser.
 *
 * No module mocks: the employer layout is an async Server Component, so where it wires the signed-in user's own details into the header is pinned by reading its source, the way
 * tests/pwa/employer-install-strip.test.tsx pins where it mounts the install strip.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { EmployerMasthead } from "@/components/employer/employer-masthead";
import { Masthead } from "@/components/app-shell/masthead";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
/** Source with comments removed and whitespace flattened: the files explain the very things the checks forbid. */
const code = (rel: string) => read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s+/g, " ");
const walk = (dir: string): string[] =>
  readdirSync(path.join(ROOT, dir)).flatMap((n) => {
    const rel = `${dir}/${n}`;
    return statSync(path.join(ROOT, rel)).isDirectory() ? walk(rel) : /\.(ts|tsx)$/.test(n) ? [rel] : [];
  });

const WITH_ORG = { orgInitials: "ST", orgName: "Stonebridge Talent", email: "owner@stonebridge.test", displayName: "Sam Owner", userInitials: "SO" };

describe("what the employer header renders closed", () => {
  it("has no Sign out link or button anywhere in the bar", () => {
    const html = renderToStaticMarkup(<EmployerMasthead {...WITH_ORG} />);
    expect(html).not.toContain("Sign out");
    expect(html, "no form is left in the bar").not.toContain("<form");
  });

  it("the avatar is ONE real button named \"Account menu\": aria-haspopup=menu, aria-expanded=false, carrying the organisation's initials and name", () => {
    const html = renderToStaticMarkup(<EmployerMasthead {...WITH_ORG} />);
    const buttons = html.match(/<button[^>]*aria-label="Account menu"[^>]*>/g) ?? [];
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toContain('type="button"');
    expect(buttons[0]).toContain('aria-haspopup="menu"');
    expect(buttons[0]).toContain('aria-expanded="false"');
    expect(html).toMatch(/<button[^>]*aria-label="Account menu"[^>]*>.*ST<\/span><\/button>/);
    expect(html).toContain('title="Stonebridge Talent"');
  });

  it("the menu is not in the markup until it is opened", () => {
    const html = renderToStaticMarkup(<EmployerMasthead {...WITH_ORG} />);
    expect(html).not.toContain('role="menu" class="absolute top-[calc(100%+8px)] right-0');
    expect(html).not.toContain("owner@stonebridge.test");
  });

  it("with no organisation the avatar button is still there, with the user's own initials, so Sign out stays reachable", () => {
    const html = renderToStaticMarkup(<EmployerMasthead {...WITH_ORG} orgInitials={null} orgName="" />);
    expect(html).toMatch(/<button[^>]*aria-label="Account menu"/);
    expect(html).toContain("SO</span></button>");
    expect(html, "the square organisation badge is still omitted").not.toContain('class="flex h-[34px] w-[34px] items-center justify-center bg-ink');
  });

  it("\"Looking for work?\" is still in the bar, once", () => {
    const html = renderToStaticMarkup(<EmployerMasthead {...WITH_ORG} />);
    expect(html.match(/Looking for work\?/g)).toHaveLength(1);
  });
});

describe("one menu component, two headers", () => {
  it("both headers render AccountMenu from the same module, and neither renders a menu of its own", () => {
    for (const file of ["src/components/app-shell/masthead.tsx", "src/components/employer/employer-masthead.tsx"]) {
      const c = code(file);
      expect(c, file).toMatch(/import \{ AccountMenu \} from "@\/components\/app-shell\/account-menu"/);
      expect(c, file).toContain("<AccountMenu");
      expect(c, file).not.toContain("Account menu");
      expect(c, file).not.toContain("accountOpen");
    }
  });

  it("the words \"Account menu\" (the button's name) and the sign-out form exist in exactly one component file under src", () => {
    const files = walk("src").filter((f) => /^src\/(components|app)\//.test(f));
    const withName = files.filter((f) => code(f).includes('aria-label="Account menu"'));
    expect(withName).toEqual(["src/components/app-shell/account-menu.tsx"]);
    const withForm = files.filter((f) => /<form action=\{signOutAction\}/.test(code(f)));
    expect(withForm).toEqual(["src/components/app-shell/account-menu.tsx"]);
  });

  it("the sign-out action is imported by the shared menu and by no header", () => {
    const importers = walk("src").filter((f) => f !== "src/lib/auth/actions.ts" && /import \{[^}]*\bsignOutAction\b[^}]*\} from "@\/lib\/auth\/actions"/.test(code(f)));
    expect(importers).toEqual(["src/components/app-shell/account-menu.tsx"]);
  });

  it("the shared menu never logs and never builds an address from the user's details", () => {
    const c = code("src/components/app-shell/account-menu.tsx");
    expect(c).not.toMatch(/console\./);
    expect(c).not.toMatch(/encodeURIComponent|URLSearchParams|\?email|searchParams/);
  });
});

describe("every place an employer header can appear", () => {
  const EMPLOYER_FILES = [...walk("src/app/employer"), ...walk("src/components/employer")].filter((f) => f !== "src/components/employer/employer-masthead.tsx");

  it("no employer page, layout, error, loading or component carries its own Sign out", () => {
    const offenders = EMPLOYER_FILES.filter((f) => /Sign out|signOutAction|signOut\(/.test(code(f)));
    expect(offenders).toEqual([]);
  });

  it("the employer header is rendered by the employer layout and by nothing else, so every page under /employer gets the shared menu", () => {
    const users = walk("src").filter((f) => f !== "src/components/employer/employer-masthead.tsx" && /<EmployerMasthead\b/.test(code(f)));
    expect(users).toEqual(["src/app/employer/layout.tsx"]);
  });

  it("the pages that sit under that layout are all listed here, so a new one is looked at (a page with its own header would show up as a new entry)", () => {
    const shells = EMPLOYER_FILES.filter((f) => f.startsWith("src/app/employer/") && /\/(layout|error|not-found|global-error|template)\.tsx$/.test(f));
    expect(shells).toEqual(["src/app/employer/layout.tsx"]);
  });
});

describe("where the employer layout gets the details it shows", () => {
  const layout = () => code("src/app/employer/layout.tsx");

  it("the email, name and initials are the signed-in user's own profile, and the organisation's name is only the badge", () => {
    const c = layout();
    expect(c).toContain("email={session.profile.email}");
    expect(c).toMatch(/displayName=\{fullVisibleName\(session\.profile\.first_name, session\.profile\.last_name\)\}/);
    expect(c).toMatch(/userInitials=\{accountInitials\(session\.profile\.first_name, session\.profile\.last_name, session\.profile\.email\)\}/);
    expect(c).toContain("orgName={orgName}");
  });
});

describe("the seeker header, closed, exactly as before the menu became shared", () => {
  const SEEKER = { creditsBalance: 5, activePass: null, initials: "SH", email: "sam.hall@example.test", displayName: "Sam Hall" };
  const region = (html: string) => {
    const start = html.indexOf('<div class="relative flex items-center"><button type="button" aria-expanded="false" aria-haspopup="menu" aria-label="Account menu"');
    expect(start, "the account control was not found").toBeGreaterThan(-1);
    return html.slice(start, html.indexOf("</button>", start) + "</button></div>".length);
  };

  it("the account control renders byte for byte as it did", () => {
    expect(region(renderToStaticMarkup(<Masthead {...SEEKER} />))).toBe(SEEKER_ACCOUNT_REGION);
  });

  it("has no Sign out in the closed bar and one account button", () => {
    const html = renderToStaticMarkup(<Masthead {...SEEKER} />);
    expect(html).not.toContain("Sign out");
    expect(html.match(/aria-label="Account menu"/g)).toHaveLength(1);
  });
});

/** Captured from the header at origin/main 2794952, before the menu was extracted. */
const SEEKER_ACCOUNT_REGION =
  "<div class=\"relative flex items-center\"><button type=\"button\" aria-expanded=\"false\" aria-haspopup=\"menu\" aria-label=\"Account menu\" class=\"inline-flex h-10 w-10 items-center justify-center\"><span class=\"flex h-[34px] w-[34px] items-center justify-center rounded-full bg-ink font-display text-[12px] font-bold text-paper\">SH</span></button></div>";
