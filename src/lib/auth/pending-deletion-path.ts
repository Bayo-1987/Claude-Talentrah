/**
 * Where a person whose account is scheduled for deletion is sent (ACCT-1): "Your account is scheduled for deletion on <date>. Restore it, or keep the
 * deletion?". Its own module so that an action file, the page and `requireUser` can all name it without importing each other.
 */
export const PENDING_DELETION_PATH = "/settings/account-deletion";
