import { PASSWORD_MIN_LENGTH, PASSWORD_RULES } from "./password-rules";

/**
 * The minimum length, ONE definition: the rule shown to the user, the server check (isPasswordValid) and the forms' client
 * `minLength` all read it, so they cannot drift. The rules themselves live in ./password-rules.ts; this file builds everything
 * the rest of the app needs from them.
 */
export { PASSWORD_MIN_LENGTH };

export interface PasswordRequirement {
  key: string;
  label: string;
  met: boolean;
}

/** Pure heuristic, safe to import from client or server code. */
export function getPasswordRequirements(password: string): PasswordRequirement[] {
  return PASSWORD_RULES.map((r) => ({ key: r.key, label: r.label, met: r.test(password) }));
}

export function isPasswordValid(password: string): boolean {
  return PASSWORD_RULES.every((r) => r.test(password));
}

export function getPasswordStrength(password: string): number {
  if (!password) return 0;
  return getPasswordRequirements(password).filter((r) => r.met).length;
}

/** "At least 8 characters" -> "at least 8 characters": a rule as it reads inside a sentence. */
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** A rule as it reads in a sentence, by its key, or null when the app has no such rule. */
export function ruleNeed(key: string): string | null {
  const rule = PASSWORD_RULES.find((r) => r.key === key);
  return rule ? lowerFirst(rule.label) : null;
}

/** The length rule for a minimum the SERVER named (it may differ from the app's own): the app's wording with that number. */
export function lengthNeed(minimum: number): string {
  return (ruleNeed("length") ?? "").replace(/\d+/, String(minimum));
}

/** The need for a character class the SERVER can require that the app's list may not carry (a symbol). */
const SERVER_ONLY_CLASS_NEEDS: Record<string, string> = { symbol: "one symbol" };
export function serverClassNeed(key: string): string {
  return ruleNeed(key) ?? SERVER_ONLY_CLASS_NEEDS[key] ?? "";
}

export function listOf(parts: string[]): string {
  return parts.length <= 1 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** "Your password needs at least 8 characters and one number." */
export function passwordNeedsSentence(needs: string[]): string {
  return `Your password needs ${listOf(needs)}.`;
}

/** The needs a password does not meet yet, in the list's order. Empty when it is valid. */
export function unmetPasswordNeeds(password: string): string[] {
  return PASSWORD_RULES.filter((r) => !r.test(password)).map((r) => lowerFirst(r.label));
}

/** The server action's message for a password that fails the rule: exactly what is missing, in plain words. */
export function unmetPasswordMessage(password: string): string {
  const needs = unmetPasswordNeeds(password);
  return needs.length > 0 ? passwordNeedsSentence(needs) : "";
}

/** Every need on the list, for a refusal that names no specific reason. */
export function allPasswordNeeds(): string[] {
  return PASSWORD_RULES.map((r) => lowerFirst(r.label));
}

/**
 * What the Supabase dashboard (Authentication > Sign In / Providers > Password) must carry to agree with the list: this is the single
 * declaration, built FROM the list, so the app's check, the requirement list the user sees and the server cannot quietly drift (S1-45).
 * The dashboard cannot be read from code, so tests/auth/weak-password-messages.test.ts pins this against the local stack's
 * supabase/config.toml, and the error messages quote the SERVER's own words (its minimum and its character classes).
 */
function dashboardRequirements(): string {
  const keys = new Set(PASSWORD_RULES.map((r) => r.key));
  const base = keys.has("upper") && keys.has("lower") && keys.has("number") ? "lower_upper_letters_digits" : keys.has("number") ? "letters_digits" : "";
  return keys.has("symbol") ? `${base}_symbols` : base;
}

export const SUPABASE_PASSWORD_POLICY = {
  minimumLength: PASSWORD_MIN_LENGTH,
  requirements: dashboardRequirements(),
  leakedPasswordProtection: true,
};
