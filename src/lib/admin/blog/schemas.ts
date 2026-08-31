import { z } from "zod";

/**
 * A slug is the post's permanent public URL, so it is validated rather than
 * slugified silently: an operator who types "My Post!" should be told what a
 * slug is, not have one invented for them and then wonder why the link they
 * shared does not match what they typed.
 */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const blogPostSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(3, "Slug must be at least 3 characters.")
    .max(120, "Slug must be 120 characters or fewer.")
    .regex(SLUG_PATTERN, "Use lowercase letters, numbers and single hyphens — no spaces."),
  title: z.string().trim().min(3, "Title is required.").max(200, "Title is too long."),
  description: z
    .string()
    .trim()
    .min(10, "Description is required — it is the search and share snippet.")
    // Google truncates around 155-160; this is the point at which the tail is
    // certainly not being read, not a hard SEO rule.
    .max(300, "Description should be 300 characters or fewer."),
  author: z.string().trim().min(2, "Author is required.").max(100, "Author name is too long."),
  body: z.string().trim().min(20, "The post body is required."),
});

export type BlogPostInput = z.infer<typeof blogPostSchema>;
