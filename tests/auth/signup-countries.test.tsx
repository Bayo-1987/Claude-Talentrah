/**
 * S1-26 item 1 (P12 / A2 / A3 / X6): the country field and the password minimum.
 *
 * BEFORE: signup and settings offered eight countries ("Nigeria, Ghana, Kenya, South Africa, Other, United Kingdom, United
 * States, Canada") with "Other" in the middle; the <select> had no autocomplete="country-name"; and the password rule was
 * shown but only the server enforced it (no client minLength).
 *
 * NOW: the full ISO 3166-1 list (the 249 entries plus Kosovo that src/lib/jobs/countries.ts already carries), Nigeria first,
 * then the diaspora markets (United Kingdom, United States, Canada), then the rest A to Z, then "Other" LAST so an existing
 * account that stored "Other" still validates and saves. autocomplete="country-name" on both selects, and minLength on the
 * signup and reset password fields, from the same constant the server rule uses.
 *
 * profiles.country is read by exactly three things, and each is pinned below for EVERY country on the list, so a new country
 * cannot land in the wrong place:
 *   billing region   Nigeria vs "outside Nigeria"; billing is naira for everyone (src/lib/billing/region.ts)
 *   feed default     the four tracked countries only; everything else is "no filter"
 *   salary currency  an employer's preselected currency; unknown or unmapped is NGN
 */
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SIGNUP_COUNTRIES, DIASPORA_COUNTRIES, signUpSchema } from "@/lib/auth/schemas";
import { settingsSchema } from "@/lib/profile/settings-schemas";
import { COUNTRY_DISPLAY_NAMES, countryCodeForLabel, resolveCountryCode } from "@/lib/jobs/countries";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { billingRegionLabel } from "@/lib/billing/region";
import { defaultCountryForProfile, TRACKED_COUNTRIES } from "@/lib/jobs/country";
import { defaultSalaryCurrency, SALARY_CURRENCIES } from "@/lib/employer/salary-input";
import { PASSWORD_MIN_LENGTH, getPasswordRequirements, isPasswordValid } from "@/lib/auth/password";

// The three forms import server actions; the render below needs only their markup, not their behaviour.
vi.mock("@/lib/auth/actions", () => ({ signUpAction: vi.fn(), updatePasswordAction: vi.fn(), signInAction: vi.fn() }));
vi.mock("@/lib/profile/settings-actions", () => ({ updateProfileAction: vi.fn() }));

const PREVIOUSLY_OFFERED = ["Nigeria", "Ghana", "Kenya", "South Africa", "Other", "United Kingdom", "United States", "Canada"];
const real = SIGNUP_COUNTRIES.filter((c) => c !== "Other");

describe("the list", () => {
  it("is every ISO country (and Kosovo) plus 'Other': 251 distinct entries", () => {
    expect(COUNTRY_DISPLAY_NAMES).toHaveLength(250);
    expect(SIGNUP_COUNTRIES).toHaveLength(251);
    expect(new Set(SIGNUP_COUNTRIES).size).toBe(251);
  });

  it("starts with Nigeria, then United Kingdom, United States, Canada", () => {
    expect([...SIGNUP_COUNTRIES].slice(0, 4)).toEqual(["Nigeria", "United Kingdom", "United States", "Canada"]);
    expect([...DIASPORA_COUNTRIES]).toEqual(["United Kingdom", "United States", "Canada"]);
  });

  it("then everything else A to Z, with 'Other' LAST (not in the middle)", () => {
    const rest = [...SIGNUP_COUNTRIES].slice(4, -1);
    expect(rest).not.toContain("Nigeria");
    expect(rest).not.toContain("Other");
    expect(SIGNUP_COUNTRIES.at(-1)).toBe("Other");
    expect(rest).toContain("Ghana"); // the other tracked countries are in the A-Z run, not pinned
    // adjacent entries never run backwards, judged the way a reader files them (accents ignored)
    const fold = (n: string) => n.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    for (let i = 1; i < rest.length; i++) expect(fold(rest[i - 1]!) <= fold(rest[i]!), `${rest[i - 1]} / ${rest[i]}`).toBe(true);
  });

  it("files accented names where a reader looks for them, and pins the exact start of the run", () => {
    const rest = [...SIGNUP_COUNTRIES].slice(4, -1);
    const around = (n: string) => [rest[rest.indexOf(n) - 1], rest[rest.indexOf(n) + 1]];
    expect(rest.slice(0, 5)).toEqual(["Afghanistan", "Åland Islands", "Albania", "Algeria", "American Samoa"]);
    expect(around("Côte d'Ivoire")).toEqual(["Costa Rica", "Croatia"]);
    expect(around("Curaçao")).toEqual(["Cuba", "Cyprus"]);
    expect(around("Réunion")).toEqual(["Republic of the Congo", "Romania"]);
    expect(around("Türkiye")).toEqual(["Tunisia", "Turkmenistan"]);
  });

  it("the names are a committed list, not computed at run time (Intl.DisplayNames would differ between server, browser and Node)", () => {
    for (const file of ["src/lib/jobs/countries.ts", "src/lib/auth/schemas.ts", "src/lib/profile/settings-schemas.ts"]) {
      const code = readFileSync(path.join(__dirname, "../..", file), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      expect(code, file).not.toMatch(/Intl\.DisplayNames|Intl\.Collator|localeCompare/);
    }
  });

  it("still offers every value the old eight-country list did, spelled the same, so existing profiles keep validating", () => {
    for (const c of PREVIOUSLY_OFFERED) expect(SIGNUP_COUNTRIES, c).toContain(c);
  });

  it("every listed country maps straight to its code by its exact label, Georgia and Jersey included; 'Other' maps to none", () => {
    for (const c of real) expect(countryCodeForLabel(c), c).not.toBeNull();
    expect(new Set(real.map((c) => countryCodeForLabel(c))).size, "two labels share a code").toBe(real.length);
    expect(countryCodeForLabel("Georgia")).toBe("GE");
    expect(countryCodeForLabel("Jersey")).toBe("JE");
    expect(countryCodeForLabel("Other")).toBeNull();
    expect(countryCodeForLabel("georgia")).toBeNull(); // exact label only: this is the dropdown's value, not free text
  });

  it("the free-text resolver is unchanged: a job location that says just 'Georgia' or 'Jersey' is still not guessed", () => {
    expect(resolveCountryCode("Georgia")).toBeNull();
    expect(resolveCountryCode("Jersey")).toBeNull();
    expect(resolveCountryCode("Georgia (GE)")).toBeNull(); // the resolver's own rule for a bare name
    expect(resolveCountryCode("GE")).toBe("GE");
  });
});

describe("validation", () => {
  const sample = "Abcdefg1";
  const base = { firstName: "Ada", lastName: "Obi", email: "ada@example.com", password: sample, termsAccepted: "on" as const };

  it.each(["Nigeria", "Germany", "Japan", "Kosovo", "Other"])("signup accepts %s", (country) => {
    expect(signUpSchema.safeParse({ ...base, country }).success).toBe(true);
  });

  it.each(["", "Atlantis", "nigeria", "NIGERIA", " Nigeria", "Select…"])("signup rejects %j", (country) => {
    const r = signUpSchema.safeParse({ ...base, country });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe("Select a country");
  });

  it("the settings form takes the same list (and the same refusal)", () => {
    expect(settingsSchema.safeParse({ firstName: "Ada", lastName: "Obi", country: "Germany" }).success).toBe(true);
    expect(settingsSchema.safeParse({ firstName: "Ada", lastName: "Obi", country: "Other" }).success).toBe(true);
    expect(settingsSchema.safeParse({ firstName: "Ada", lastName: "Obi", country: "Atlantis" }).success).toBe(false);
  });
});

describe("what profiles.country does, for EVERY country on the list", () => {
  it("billing region: only Nigeria is 'Nigeria'; every other country (including 'Other' and any unknown value) is 'Outside Nigeria'", () => {
    for (const c of SIGNUP_COUNTRIES) {
      const label = billingRegionLabel(c);
      expect(["Nigeria — billed in naira (₦)", "Outside Nigeria — billed in naira (₦) by card"], c).toContain(label);
      expect(label.startsWith("Nigeria"), c).toBe(c === "Nigeria");
    }
    expect(billingRegionLabel("Atlantis")).toBe("Outside Nigeria — billed in naira (₦) by card");
    expect(billingRegionLabel("")).toBe("Billed in naira (₦)");
    expect(billingRegionLabel(null)).toBe("Billed in naira (₦)");
    expect(billingRegionLabel("  ")).toBe("Billed in naira (₦)");
  });

  it("feed default: only the four tracked countries default the feed; every other country is 'no filter'", () => {
    for (const c of SIGNUP_COUNTRIES) {
      const d = defaultCountryForProfile(c);
      expect(d !== undefined, c).toBe((TRACKED_COUNTRIES as readonly string[]).includes(c));
    }
    expect(defaultCountryForProfile("Atlantis")).toBeUndefined();
  });

  it("employer salary currency: always a supported currency; the mapped countries and the EU keep theirs; every other listed country, and 'Other', is USD", () => {
    for (const c of SIGNUP_COUNTRIES) expect(SALARY_CURRENCIES as readonly string[], c).toContain(defaultSalaryCurrency(c));
    expect(defaultSalaryCurrency("Germany")).toBe("EUR");
    expect(defaultSalaryCurrency("France")).toBe("EUR");
    expect(defaultSalaryCurrency("United Kingdom")).toBe("GBP");
    expect(defaultSalaryCurrency("Ghana")).toBe("GHS");
    expect(defaultSalaryCurrency("Kenya")).toBe("KES");
    expect(defaultSalaryCurrency("Nigeria")).toBe("NGN");
    for (const c of ["Japan", "Brazil", "Australia", "Other"]) expect(defaultSalaryCurrency(c), c).toBe("USD");
    // Georgia and Jersey are resolved from the exact dropdown label (to GE and JE), so they are real, unmapped countries: USD, not "unknown"
    expect(defaultSalaryCurrency("Georgia")).toBe("USD");
    expect(defaultSalaryCurrency("Jersey")).toBe("USD");
  });

  it("no listed country is left to the naira fallback by accident: only the unset or unrecognised are NGN", () => {
    const naira = SIGNUP_COUNTRIES.filter((c) => defaultSalaryCurrency(c) === "NGN");
    expect(naira).toEqual(["Nigeria"]);
    for (const c of ["", "   ", null, undefined, "Atlantis"]) expect(defaultSalaryCurrency(c), String(c)).toBe("NGN");
  });
});

describe("the password minimum", () => {
  it("PASSWORD_MIN_LENGTH is 8, the server rule's own boundary", () => {
    expect(PASSWORD_MIN_LENGTH).toBe(8);
    expect(isPasswordValid("Abcdef1")).toBe(false); // 7 characters
    expect(isPasswordValid("Abcdefg1")).toBe(true); // 8
  });

  it("the password the signup e2e submits clears the browser's minLength and still fails the server's rule", () => {
    expect("weakpassword".length).toBeGreaterThanOrEqual(PASSWORD_MIN_LENGTH);
    expect(isPasswordValid("weakpassword")).toBe(false);
    expect("weak".length).toBeLessThan(PASSWORD_MIN_LENGTH); // the old value: now stopped by the browser before the action runs
  });

  it("the rule shown to the user is built from the same constant (the label and the check cannot drift)", () => {
    const length = getPasswordRequirements("").find((r) => r.key === "length")!;
    expect(length.label).toContain(String(PASSWORD_MIN_LENGTH));
    expect(getPasswordRequirements("a".repeat(PASSWORD_MIN_LENGTH - 1)).find((r) => r.key === "length")!.met).toBe(false);
    expect(getPasswordRequirements("a".repeat(PASSWORD_MIN_LENGTH)).find((r) => r.key === "length")!.met).toBe(true);
  });
});

describe("the form fields", () => {
  const html = async (mod: string, name: string, props: Record<string, unknown> = {}) => {
    const m = await import(mod);
    return renderToStaticMarkup(createElement(m[name], props));
  };
  const attrOf = (markup: string, tag: string, name: string) => {
    const el = markup.match(new RegExp(`<${tag}[^>]*\\bname="${name}"[^>]*>`))?.[0];
    expect(el, `no <${tag} name="${name}">`).toBeDefined();
    return el!;
  };

  it("signup: the country select has autocomplete=country-name, Nigeria first, 'Other' last, and the whole list", async () => {
    const markup = await html("@/components/auth/signup-form", "SignupForm");
    expect(attrOf(markup, "select", "country")).toMatch(/autoComplete="country-name"|autocomplete="country-name"/i);
    const options = [...markup.matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]).filter(Boolean);
    expect(options[0]).toBe("Nigeria");
    expect(options.at(-1)).toBe("Other");
    expect(options).toHaveLength(251);
  });

  it("signup: the password input carries minLength 8 (and keeps autocomplete=new-password)", async () => {
    const el = attrOf(await html("@/components/auth/signup-form", "SignupForm"), "input", "password");
    expect(el).toMatch(/minLength="8"|minlength="8"/i);
    expect(el).toMatch(/autoComplete="new-password"|autocomplete="new-password"/i);
  });

  it("reset password: the new-password input carries minLength 8", async () => {
    expect(attrOf(await html("@/components/auth/reset-password-form", "ResetPasswordForm"), "input", "password")).toMatch(/minLength="8"|minlength="8"/i);
  });

  it("settings: the country select has autocomplete=country-name and the whole list, and keeps a saved value selected", async () => {
    const markup = await html("@/app/(app)/settings/settings-form", "SettingsForm", { firstName: "Ada", lastName: "Obi", country: "Germany" });
    expect(attrOf(markup, "select", "country")).toMatch(/autoComplete="country-name"|autocomplete="country-name"/i);
    expect([...markup.matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]).filter(Boolean)).toHaveLength(251);
  });

  it("login is NOT given a minimum: a legacy password shorter than the rule must still be able to sign in", async () => {
    const el = attrOf(await html("@/components/auth/login-form", "LoginForm"), "input", "password");
    expect(el).toMatch(/autoComplete="current-password"|autocomplete="current-password"/i);
    expect(el).not.toMatch(/minLength|minlength/i);
  });

  it("the admin sign-in is not given one either", async () => {
    const el = attrOf(await html("@/components/admin/admin-login-form", "AdminLoginForm"), "input", "password");
    expect(el).not.toMatch(/minLength|minlength/i);
  });

  it("no source file that renders a current-password input mentions minLength at all (a future 'current password' field is covered too)", () => {
    const files = execSync(`grep -rl 'current-password' src`, { cwd: path.join(__dirname, "../.."), encoding: "utf8" }).split("\n").filter(Boolean);
    expect(files.length).toBeGreaterThanOrEqual(2);
    for (const f of files) expect(readFileSync(path.join(__dirname, "../..", f), "utf8"), f).not.toMatch(/minLength/);
  });
});
