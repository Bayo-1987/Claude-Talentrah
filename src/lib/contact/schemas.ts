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
