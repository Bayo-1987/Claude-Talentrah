import { z } from "zod";

/**
 * The three buckets, and their labels.
 *
 * Value and label are separate because the value is a database enum and the
 * label is a sentence. "bug" is the right column value and the wrong thing to
 * show someone — a person reporting that resume export produced a blank PDF
 * should not have to decide whether that counts as a "bug".
 */
export const FEEDBACK_CATEGORIES = [
  { value: "bug", label: "Something's broken" },
  { value: "idea", label: "An idea or a request" },
  { value: "other", label: "Something else" },
] as const;

export const FEEDBACK_CATEGORY_VALUES = FEEDBACK_CATEGORIES.map((c) => c.value) as unknown as [
  "bug",
  "idea",
  "other",
];

/**
 * `page_path` is supplied by the browser — once as `?from=` on the URL, once
 * as a hidden form field — so it is attacker-controlled in both places.
 * Whoever eventually reads this table reads it as text, and as ours:
 * "https://evil.example/verify-your-account" sitting in a column named
 * page_path is a link that appears to have come from the product.
 *
 * TWO CHECKS, AND ONLY TWO.
 *
 * A leading slash does almost all the work — no scheme can survive it, since
 * "https://…" and "javascript:…" both fail on the first character. The second
 * check is the one that is not obvious: "//evil.example/jobs" DOES start with
 * a slash and a browser resolves it off-site, so it has to be excluded
 * separately.
 *
 * A third check on ":" was written first and deleted: sabotaging it changed no
 * test, because the leading slash already refuses every scheme — and it would
 * have dropped legitimate paths like "/jobs?next=http://x". A check nothing
 * can justify is a check that reads as protection while providing none.
 *
 * Anything failing is DROPPED, not rejected. Feedback is what we want; a
 * mangled link in the URL bar must cost the context field and never the
 * person's message.
 */
const pagePath = z
  .string()
  .trim()
  .max(512)
  .refine((v) => v.startsWith("/") && !v.startsWith("//"))
  .nullable()
  .catch(null);

export const feedbackSchema = z.object({
  category: z.enum(FEEDBACK_CATEGORY_VALUES, { message: "Pick one of the three" }),
  message: z
    .string()
    .trim()
    .min(10, "Give us a bit more to go on (at least 10 characters)")
    .max(5000, "That's longer than we can store — trim it to 5,000 characters"),
  pagePath,
});

export type FeedbackInput = z.infer<typeof feedbackSchema>;
