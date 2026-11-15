/**
 * What the admin messaging service reports. Four codes, a reason when the database gave one, and a message that never carries database text or a person's data.
 *   permission_denied  the acting admin does not hold the permission the operation needs (checked before any call)
 *   switched_off       a flag that gates the operation is off (the sentence says which)
 *   invalid_input      the input fails a rule the service checks before it asks the database
 *   refused            the database refused (its closed reason, e.g. self_approval, kind_not_confirmed, invalid_state, flag_off)
 */
export const MESSAGING_ERROR_CODES = ["permission_denied", "switched_off", "invalid_input", "refused"] as const;
export type MessagingErrorCode = (typeof MESSAGING_ERROR_CODES)[number];

export class MessagingError extends Error {
  readonly code: MessagingErrorCode;
  readonly reason: string | null;
  constructor(code: MessagingErrorCode, message: string, reason: string | null = null) {
    super(message);
    this.name = "MessagingError";
    this.code = code;
    this.reason = reason;
  }
}
