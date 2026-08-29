import { z } from "zod";

/**
 * Deliberately weaker than src/lib/auth/schemas.ts's sign-in rules would be if
 * they grew: this validates the SHAPE of a login attempt, nothing about
 * password quality. Strength belongs at the point an admin password is SET
 * (scripts/grant-admin.ts), not at the point one is typed — a login form that
 * rejects a password for being weak has told a stranger something about the
 * account.
 */
export const adminLoginSchema = z.object({
  email: z.string().trim().min(1).email(),
  password: z.string().min(1),
});
