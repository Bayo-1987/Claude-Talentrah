import { z } from "zod";
import { isPasswordValid } from "./password";
import { hasVisibleName } from "@/lib/profile/name";

export const HOME_COUNTRIES = [
  "Nigeria",
  "Ghana",
  "Kenya",
  "South Africa",
  "Other",
] as const;

export const DIASPORA_COUNTRIES = [
  "United Kingdom",
  "United States",
  "Canada",
] as const;

export const SIGNUP_COUNTRIES = [...HOME_COUNTRIES, ...DIASPORA_COUNTRIES] as const;

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
  email: z.email("Enter a valid email"),
  country: z.enum(SIGNUP_COUNTRIES, "Select a country"),
  password: z
    .string()
    .refine(isPasswordValid, "Password doesn't meet the requirements below"),
  termsAccepted: z.literal("on", "You must accept the terms to continue"),
  referredByCode: z.string().trim().optional(),
});

export const signInSchema = z.object({
  email: z.email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});

/**
 * Email only. There is nothing else to ask for, and nothing else to validate:
 * whether an account exists for this address is deliberately not knowable from
 * the response — see requestPasswordResetAction.
 */
export const forgotPasswordSchema = z.object({
  email: z.email("Enter a valid email"),
});

/**
 * The new password, held to the SAME rule as signup via `isPasswordValid`
 * rather than a second definition. A reset form that accepted a weaker
 * password than signup would be a way around the rule rather than a different
 * screen, and the two would drift the moment either is edited.
 */
export const resetPasswordSchema = z.object({
  password: z
    .string()
    .refine(isPasswordValid, "Password doesn't meet the requirements below"),
});
