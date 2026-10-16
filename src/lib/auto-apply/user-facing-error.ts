/**
 * An error thrown inside the Auto-Apply submit path whose message is written FOR the person and may be shown to them as-is. Anything else caught there (a ledger failure, a database error) is logged on the server
 * and replaced with a plain sentence, so the classification is by this type, never by message text. It lives in its own module because actions.ts is a "use server" file, which can only export async functions.
 */
export class UserFacingSubmitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserFacingSubmitError";
  }
}
