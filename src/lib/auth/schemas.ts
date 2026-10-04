import { z } from "zod";
import { isPasswordValid, unmetPasswordMessage } from "./password";
import { hasVisibleName } from "@/lib/profile/name";
import { COUNTRY_DISPLAY_NAMES, compareCountryNames } from "@/lib/jobs/countries";

/**
 * The password rule, enforced on the server by the action itself (not only by the form). The message says exactly what is missing, in the
 * words of the shared rule list (src/lib/auth/password-rules.ts), so a caller that never saw the form's checklist is still told what to fix.
 */
function passwordMeetsRule(value: string, ctx: z.RefinementCtx): void {
  if (!isPasswordValid(value)) ctx.addIssue({ code: "custom", message: unmetPasswordMessage(value) });
}

/** The home market, listed first. */
export const HOME_COUNTRY = "Nigeria";

/** The diaspora markets (a natural hard-currency audience), listed straight after the home market. */
export const DIASPORA_COUNTRIES = ["United Kingdom", "United States", "Canada"] as const;

/**
 * For an account whose country is not on the list, and for every account that stored "Other" before the list was complete:
 * it stays valid and is listed LAST, so an existing profile still saves.
 */
export const OTHER_COUNTRY = "Other";

/**
 * What signup and settings offer: the full ISO 3166-1 list (plus Kosovo) from src/lib/jobs/countries.ts, Nigeria first, then the
 * diaspora markets, then everything else A to Z, then "Other". The names the old eight-country list used are all in it,
 * spelled the same, so every stored profiles.country value still validates.
 *
 * profiles.country is read by exactly three things, none of which a new country can send somewhere wrong (pinned for every
 * entry in tests/auth/signup-countries.test.tsx): the billing region (Nigeria vs outside it; billing is naira for everyone),
 * the feed default (only the four tracked countries filter; everything else is "no filter"), and an employer's default salary
 * currency (EU members get EUR, the seven mapped countries their own, every other country USD).
 */
const featured: readonly string[] = [HOME_COUNTRY, ...DIASPORA_COUNTRIES];
export const SIGNUP_COUNTRIES: readonly string[] = [
  ...featured,
  ...COUNTRY_DISPLAY_NAMES.filter((name) => !featured.includes(name)).sort(compareCountryNames),
  OTHER_COUNTRY,
];

const SIGNUP_COUNTRY_SET: ReadonlySet<string> = new Set(SIGNUP_COUNTRIES);
/** Exactly one of the listed names (case-sensitive, no trimming: it is what the select submits). */
export function isSignupCountry(value: string): boolean {
  return SIGNUP_COUNTRY_SET.has(value);
}

/**
 * Shared across every schema in this file that takes a bare email address —
 * signup, sign-in, forgot-password, and the check-email resend actions in
 * actions.ts. One definition so the message and the validation rule can't
 * drift between call sites.
 */
export const emailSchema = z.email("Enter a valid email");

export const signUpSchema = z.object({
  /*
   * `.trim().min(1)` was not enough: it strips the ECMAScript WhiteSpace
   * production but not the zero-width FORMAT characters (Cf, not Zs), so a
   * lone U+200B passed as a name and rendered as blank everywhere.
   *
   * This is the UX half only. The actual gate is the CHECK constraint in
   * migration 0045, because 0030 grants update(first_name,last_name) to
   * `authenticated` — a client can PATCH the column and never reach this file.
   * Keeping the check here too means the signup form says "that name isn't
   * valid" instead of surfacing a raw 23514.
   */
  firstName: z.string().refine(hasVisibleName, "Enter your first name"),
  lastName: z.string().refine(hasVisibleName, "Enter your last name"),
  email: emailSchema,
  country: z.string().refine(isSignupCountry, "Select a country"),
  password: z.string().superRefine(passwordMeetsRule),
  termsAccepted: z.literal("on", "You must accept the terms to continue"),
  referredByCode: z.string().trim().optional(),
});

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required"),
});

/**
 * Email only. There is nothing else to ask for, and nothing else to validate:
 * whether an account exists for this address is deliberately not knowable from
 * the response — see requestPasswordResetAction.
 */
export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

/**
 * The new password, held to the SAME rule as signup via `isPasswordValid`
 * rather than a second definition. A reset form that accepted a weaker
 * password than signup would be a way around the rule rather than a different
 * screen, and the two would drift the moment either is edited.
 */
export const resetPasswordSchema = z.object({
  password: z.string().superRefine(passwordMeetsRule),
});
