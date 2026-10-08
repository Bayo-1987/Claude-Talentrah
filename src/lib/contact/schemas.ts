import { z } from "zod";
import { FIELD_LIMITS, fitsLimit } from "@/lib/text-limits";
import type { SubmittedValues } from "@/lib/forms/keep-input";

export const CONTACT_TOPICS = [
  "General question",
  "Account or billing",
  "Report a bug",
  "Employer / Business Services",
  "Partnership or press",
  "Other",
] as const;

export const contactSchema = z.object({
  name: z.string().trim().min(1, "Your name is required"),
  email: z.email("Enter a valid email"),
  topic: z.enum(CONTACT_TOPICS, "Select a topic"),
  message: z
    .string()
    .trim()
    .min(10, "Give us a bit more detail (at least 10 characters)")
    // The same number the form's counter shows, counted the way the box counts (CRLF as one): see feedback/schemas.ts.
    .refine((v) => fitsLimit(v, FIELD_LIMITS.contactMessage), "Your message is over the 5,000 limit. Shorten it (an emoji counts as two)."),
});

/**
 * send-405 — the honeypot field name, shared between the form and the
 * Server Action so they can't drift apart. Deliberately NOT part of
 * `contactSchema`: it isn't real form data, it's an anti-bot signal checked
 * before validation even runs, and folding it into the schema would risk it
 * showing up in `fieldErrors` like a real field.
 *
 * "website" — a classic honeypot bait name generic form-filling bots target
 * by default, and not a label a real visitor to a support contact form
 * would ever expect to see or need.
 */
export const CONTACT_HONEYPOT_FIELD = "website";

/**
 * Lives here, not in actions.ts, because actions.ts carries "use server" —
 * Next.js requires every export from a "use server" module to be an async
 * function, and a plain interface/object breaks that at build time. This is
 * the module both the Server Action and the client form import it from.
 */
export interface ContactActionState {
  status: "idle" | "success" | "error";
  error: string | null;
  fieldErrors?: Record<string, string[]>;
  /** Returned with an error so the form keeps what was typed (React 19 resets the form after any action). */
  values?: SubmittedValues;
}

export const initialContactActionState: ContactActionState = {
  status: "idle",
  error: null,
};
