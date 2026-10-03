/**
 * The minimum length, ONE definition: the rule shown to the user, the server check (isPasswordValid) and the forms' client
 * `minLength` all read it, so they cannot drift. (Before, only the server enforced it; the form showed the rule and let a
 * short password travel to the server before saying no.)
 */
export const PASSWORD_MIN_LENGTH = 8;

export interface PasswordRequirement {
  key: string;
  label: string;
  met: boolean;
}

/** Pure heuristic, safe to import from client or server code. */
export function getPasswordRequirements(password: string): PasswordRequirement[] {
  return [
    { key: "length", label: `At least ${PASSWORD_MIN_LENGTH} characters`, met: password.length >= PASSWORD_MIN_LENGTH },
    { key: "upper", label: "One uppercase letter", met: /[A-Z]/.test(password) },
    { key: "lower", label: "One lowercase letter", met: /[a-z]/.test(password) },
    { key: "number", label: "One number", met: /[0-9]/.test(password) },
  ];
}

export function isPasswordValid(password: string): boolean {
  return getPasswordRequirements(password).every((r) => r.met);
}

export function getPasswordStrength(password: string): number {
  if (!password) return 0;
  return getPasswordRequirements(password).filter((r) => r.met).length;
}
