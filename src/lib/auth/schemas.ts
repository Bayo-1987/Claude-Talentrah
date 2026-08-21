import { z } from "zod";
import { isPasswordValid } from "./password";

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
  firstName: z.string().trim().min(1, "First name is required"),
  lastName: z.string().trim().min(1, "Last name is required"),
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
