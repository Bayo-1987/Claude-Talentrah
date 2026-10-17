import type { RefusalCode } from "./constants";

/** What the admin sees for each refusal code, and the HTTP status the route answers with. No message names a person or carries anything the admin typed. */
export const REFUSAL_MESSAGES: Record<RefusalCode, { status: number; message: string }> = {
  in_progress: { status: 409, message: "An export for this person is already in progress. If it was left unfinished, a new one can be started about 15 minutes after it began." },
  live_export_exists: { status: 409, message: "This person already has an export that has not been opened. Cancel the unused export first, then start a new one." },
  own_account: { status: 403, message: "You cannot export your own account. Ask a different admin." },
  admin_target_needs_other_admin: { status: 403, message: "This account uses your own address, so a different admin must handle it." },
  no_such_person: { status: 404, message: "There is no such person." },
  not_a_uuid: { status: 400, message: "That is not a user id." },
  notice_failed: { status: 502, message: "The notice email could not be sent, so nothing was generated. Try again shortly." },
  not_cancellable: { status: 409, message: "There is no unused export to cancel for this person (it may already have been opened, expired or cancelled)." },
};

export const GENERIC_UNAVAILABLE = "The audit log is not available, so nothing was done. Try again shortly.";
export const GENERIC_FAILED = "The export could not be completed. Nothing was delivered, and a new one can be started right away.";
export const SUPERSEDED_MESSAGE = "This attempt was cancelled while it ran, so nothing was delivered.";
