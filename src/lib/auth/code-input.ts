/** The signup code is six digits (Supabase "Email OTP Length"). What the field accepts, pure so the form and the action share one rule. */
export const CODE_LENGTH = 6;

/** Keeps the digits (a paste of "123 456", "123-456" or a whole line works) and the first six of them. Anything else becomes "". */
export function normalizeCodeInput(raw: unknown): string {
  if (typeof raw !== "string" && typeof raw !== "number") return "";
  return String(raw).replace(/\D+/g, "").slice(0, CODE_LENGTH);
}

export function isCompleteCode(code: string): boolean {
  return new RegExp(`^\\d{${CODE_LENGTH}}$`).test(code);
}
