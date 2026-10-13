import { z } from "zod";
import { CONTACT_TOPICS } from "./constants";
import { FIELD_LIMITS, fitsLimit } from "@/lib/text-limits";

// What the client form needs lives in ./constants (no zod); re-exported so every existing import from this module keeps working.
export { CONTACT_TOPICS, contactTopicFromParam, CONTACT_HONEYPOT_FIELD, initialContactActionState, type ContactActionState } from "./constants";

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
