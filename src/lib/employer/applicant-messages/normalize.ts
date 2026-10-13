import { BODY_MAX, SUBJECT_MAX } from "./constants";

export type NormalizedMessage = { ok: true; subject: string; body: string } | { ok: false; error: string };

// Control characters (except tab and line feed, handled separately) and the bidirectional overrides that can make text read differently from how it is stored.
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F‪-‮⁦-⁩]/g;

/**
 * What an employer may send through the relay: plain text. The subject is ONE line (a line break in a header is how a Bcc is smuggled in), the body keeps its
 * line breaks, both lose control and bidirectional-override characters, and both have limits. Never throws: a field that is not a string is an empty one.
 */
export function normalizeMessage(input: { subject: unknown; body: unknown }): NormalizedMessage {
  const subject = (typeof input.subject === "string" ? input.subject : "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(CONTROL, "")
    .replace(/ {2,}/g, " ")
    .trim();
  const body = (typeof input.body === "string" ? input.body : "")
    .replace(/\r\n?/g, "\n")
    .replace(CONTROL, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!subject) return { ok: false, error: "Add a subject." };
  if (!body) return { ok: false, error: "Write a message before sending." };
  if (subject.length > SUBJECT_MAX) return { ok: false, error: `Keep the subject under ${SUBJECT_MAX} characters.` };
  if (body.length > BODY_MAX) return { ok: false, error: `Keep the message under ${BODY_MAX} characters.` };
  return { ok: true, subject, body };
}
