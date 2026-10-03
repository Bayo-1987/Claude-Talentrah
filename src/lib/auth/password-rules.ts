/**
 * THE password rule: the one list that everything about it reads (S1-45 / S1-58).
 *
 * The checklist a person sees on signup and reset, the check the server action runs (src/lib/auth/schemas.ts), the sentences that explain a
 * refusal from Supabase (src/lib/auth/password-errors.ts) and the dashboard policy the app declares (src/lib/auth/password.ts) are all
 * built from this array. Change a rule HERE and every one of them changes; nothing else in the app may write a rule in words, and
 * tests/auth/password-shared-definition.test.ts fails if something does.
 *
 * `label` is what the checklist shows ("At least 8 characters"). Inside a sentence it is used with its first letter lowered ("Your
 * password needs at least 8 characters."), so write it to read both ways. Pure data and functions: safe to import from client and server.
 */
export const PASSWORD_MIN_LENGTH = 8;

export interface PasswordRuleDefinition {
  /** Stable key for the rule; the character classes use the names the server's own reasons use. */
  key: string;
  label: string;
  test: (password: string) => boolean;
}

export const PASSWORD_RULES: readonly PasswordRuleDefinition[] = [
  { key: "length", label: `At least ${PASSWORD_MIN_LENGTH} characters`, test: (p) => p.length >= PASSWORD_MIN_LENGTH },
  { key: "upper", label: "One uppercase letter", test: (p) => /[A-Z]/.test(p) },
  { key: "lower", label: "One lowercase letter", test: (p) => /[a-z]/.test(p) },
  { key: "number", label: "One number", test: (p) => /[0-9]/.test(p) },
];
