import { z } from "zod";

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
  message: z.string().trim().min(10, "Give us a bit more detail (at least 10 characters)"),
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
}

export const initialContactActionState: ContactActionState = {
  status: "idle",
  error: null,
};
