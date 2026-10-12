/**
 * "Message candidate" (0256): the limits and kinds in one place. The database holds the same numbers (a CHECK on subject and body length, the kind list,
 * and the default of 20 in claim_applicant_message); tests/employer/applicant-messages/constants-match-0256.test.ts keeps the two from drifting apart.
 */
export const DAILY_MESSAGE_LIMIT = 20;
export const SUBJECT_MAX = 200;
export const BODY_MAX = 5000;

/** The kinds an employer can pick from the form. 'interview_invite' (0253) and 'custom' exist in the database but are not templates. */
export const MESSAGE_TEMPLATE_KINDS = ["invite_interview", "request_info", "not_moving_forward"] as const;
export type MessageTemplateKind = (typeof MESSAGE_TEMPLATE_KINDS)[number];

/** Every value the log's `kind` column accepts. A message typed from scratch is 'custom'. */
export const MESSAGE_KINDS = [...MESSAGE_TEMPLATE_KINDS, "custom", "interview_invite"] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

export const TEMPLATE_LABELS: Record<MessageTemplateKind, string> = {
  invite_interview: "Invite to interview",
  request_info: "Ask for more information",
  not_moving_forward: "Not moving forward",
};
