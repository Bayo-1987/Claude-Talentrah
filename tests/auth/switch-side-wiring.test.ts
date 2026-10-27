/**
 * Where the side switch is wired in, pinned by reading the source (the pieces are Server Components, Server Actions and client components that a unit test cannot render without module mocks, which
 * tests/ci/mock-factory-ratchet.test.ts forbids adding). The behaviour itself is in switch-side-logic.test.ts, and in a browser in e2e/account-menu.spec.ts and e2e/dashboard-switch-side.spec.ts.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const read = (rel: string) => readFileSync(path.resolve(__dirname, "../..", rel), "utf8");
/** Source with comments removed and whitespace flattened: the files explain the very things the checks forbid. */
const code = (rel: string) => read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s+/g, " ");
const body = (rel: string, fn: string) => new RegExp(`export async function ${fn}\\([^)]*\\)(?:: [^{]+)? \\{(.*?)\\} (?:/\\*\\*|export|$)`).exec(code(rel))?.[1] ?? "";

describe("the Server Action", () => {
  const c = code("src/lib/auth/switch-side.ts");

  it("is a 'use server' file whose only export is switchSideAction", () => {
    expect(read("src/lib/auth/switch-side.ts").trimStart().startsWith('"use server"')).toBe(true);
    expect([...c.matchAll(/export (?:async )?(?:function|const|class) (\w+)/g)].map((m) => m[1])).toEqual(["switchSideAction"]);
  });

  it("supplies the REAL session, membership lookup, cookie jar and redirect to the rules", () => {
    expect(c).toContain("switchSide(formData.get(\"side\"), {");
    expect(c).toContain("(await getOptionalUser())?.user.id ?? null");
    expect(c).toContain("isMember: isOrganisationMember");
    expect(c).toContain("(await cookies()).set(SIDE_COOKIE, side, sideCookieOptions(process.env.NODE_ENV === \"production\"))");
    expect(c).toContain("go: (path) => redirect(path)");
  });

  it("reads nothing but the side from the form, and builds no destination from input", () => {
    expect([...c.matchAll(/formData\.get\(("[^"]*")\)/g)].map((m) => m[1])).toEqual(['"side"']);
    expect(c).not.toMatch(/redirect\((?!path\))/);
  });
});

describe("both sign-outs remove the remembered side", () => {
  const actions = "src/lib/auth/actions.ts";
  it.each(["signOutAction", "signOutEverywhereAction"])("%s calls clearSideCookie on the cookie jar before it redirects", (fn) => {
    const b = body(actions, fn);
    expect(b, `${fn} body was not found`).not.toBe("");
    expect(b).toContain("clearSideCookie(await cookies())");
    expect(b.indexOf("clearSideCookie")).toBeLessThan(b.indexOf('redirect("/login")'));
  });
});

describe("/dashboard", () => {
  const c = code("src/app/dashboard/page.tsx");
  it("still finds the membership first, and passes the parsed cookie only as the second argument", () => {
    expect(c.indexOf("organization_members")).toBeGreaterThan(-1);
    expect(c).toContain("dashboardDestination(error || !data ? null : { organizationId: data.organization_id }, parseSide((await cookies()).get(SIDE_COOKIE)?.value))");
  });
});

describe("the two headers", () => {
  it("the seeker header offers 'Switch to Employer' only to a member, and AppShell supplies the membership from its existing parallel lookups", () => {
    expect(code("src/components/app-shell/masthead.tsx")).toContain('switchSide={isOrganisationMember ? { to: "employer", label: "Switch to Employer" } : undefined}');
    const shell = code("src/components/app-shell/app-shell.tsx");
    expect(shell).toContain("const [activePass, hasUnread, isMember] = await Promise.all([ getActivePass(session.user.id), hasUnreadNotification(session.user.id), isOrganisationMember(session.user.id), ]);");
    expect(shell).toContain("isOrganisationMember={isMember}");
  });

  it("the employer header offers 'Switch to Job seeker' when told to, and the employer layout always tells it to", () => {
    expect(code("src/components/employer/employer-masthead.tsx")).toContain('switchSide={canSwitchToSeeker ? { to: "seeker", label: "Switch to Job seeker" } : undefined}');
    expect(code("src/app/employer/layout.tsx")).toMatch(/<EmployerMasthead [^>]*\bcanSwitchToSeeker\b/);
  });

  it("the two cross links stay PLAIN links that remember nothing: 'Post a job' to /employer and 'Looking for work?' to /jobs", () => {
    const seeker = read("src/components/app-shell/masthead.tsx");
    expect([...seeker.matchAll(/href="\/employer"/g)].length).toBeGreaterThanOrEqual(2);
    const employer = read("src/components/employer/employer-masthead.tsx");
    expect([...employer.matchAll(/href="\/jobs"/g)].length).toBeGreaterThanOrEqual(2);
    for (const file of ["src/components/app-shell/masthead.tsx", "src/components/employer/employer-masthead.tsx"]) {
      expect(code(file), file).not.toContain("switchSideAction");
    }
  });

  it("the menu component alone imports the action, and offers the item through a form with a hidden side field, between Settings and Sign out", () => {
    const menu = code("src/components/app-shell/account-menu.tsx");
    expect(menu).toContain('import { switchSideAction } from "@/lib/auth/switch-side"');
    expect(menu).toContain('<form action={switchSideAction}> <input type="hidden" name="side" value={switchSide.to} />');
    expect(menu.indexOf("Settings </Link>")).toBeLessThan(menu.indexOf("switchSide &&"));
    expect(menu.indexOf("switchSide &&")).toBeLessThan(menu.indexOf("<form action={signOutAction}>"));
  });
});
