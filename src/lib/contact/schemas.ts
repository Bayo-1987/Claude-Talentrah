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
