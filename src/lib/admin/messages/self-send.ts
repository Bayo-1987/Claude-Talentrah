import type { AdminMessageRow } from "@/lib/notifications/contract";

/**
 * Sending without a second approver (the flag admin_messaging_self_approve). One place for the numbers and the words, used by the service, the Server Action and the page:
 *   - a message is "self-approved" when its requires_approval is false (the create function was told so, which the service does only with the flag on and for a message that is not a promotion);
 *   - the database still raises the requirement for a promotion and for an audience over 100, so those never get here;
 *   - over 50 people the operator must TYPE the word SEND; the Server Action refuses the send without it, the page's input is only the way to supply it.
 */
export const SELF_SEND_CONFIRM_OVER = 50;
export const SELF_SEND_CONFIRM_WORD = "SEND";

export const isSelfApproved = (message: Pick<AdminMessageRow, "requires_approval">): boolean => message.requires_approval === false;
export const needsTypedSend = (message: Pick<AdminMessageRow, "requires_approval" | "audience_count">): boolean => isSelfApproved(message) && message.audience_count > SELF_SEND_CONFIRM_OVER;

export const audienceSentence = (count: number): string => `This will go to ${count} ${count === 1 ? "person" : "people"}.`;
export const typedSendSentence = (count: number): string => `Type ${SELF_SEND_CONFIRM_WORD} to confirm sending to ${count} people.`;
