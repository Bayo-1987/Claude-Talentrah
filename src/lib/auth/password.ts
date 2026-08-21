export interface PasswordRequirement {
  key: string;
  label: string;
  met: boolean;
}

/** Pure heuristic, safe to import from client or server code. */
export function getPasswordRequirements(password: string): PasswordRequirement[] {
  return [
    { key: "length", label: "At least 8 characters", met: password.length >= 8 },
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
