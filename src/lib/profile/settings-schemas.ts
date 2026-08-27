import { z } from "zod";
import { hasVisibleName } from "@/lib/profile/name";
import { SIGNUP_COUNTRIES } from "@/lib/auth/schemas";

/**
 * What a person may actually change about themselves.
 *
 * THREE FIELDS, NOT SIX. The brief named first_name, last_name, email,
 * country, market_segment and locale. Checked against production before
 * building anything, and only four of those carry an UPDATE grant to
 * `authenticated`:
 *
 *   email          NOT WRITABLE — 0030. It is the identity the account is
 *                  keyed on; changing it is an auth-level operation, not a
 *                  profile edit.
 *   market_segment NOT WRITABLE — 0030. A billing segment nobody gets to
 *                  self-select.
 *   locale         writable, but nothing in the app READS it. Every profile
 *                  is "en" and the masthead's "EN" is a static span, not a
 *                  control. A picker here would be a setting that silently
 *                  does nothing — the same class of bug as the notes Save it
 *                  would sit two clicks away from.
 *
 * So the form edits first_name, last_name and country, and shows the other
 * three as facts. A field that cannot be saved is worse than an absent one:
 * it fails at 42501, and the person cannot tell that from a bug.
 *
 * The name rule is `hasVisibleName`, the same predicate signup uses, because
 * `.trim().min(1)` does not strip zero-width FORMAT characters — a lone U+200B
 * passes as a name and renders blank everywhere. The real gate is 0045's CHECK
 * constraint; this exists so the form says "enter your first name" instead of
 * surfacing a raw 23514.
 */
export const settingsSchema = z.object({
  firstName: z.string().refine(hasVisibleName, "Enter your first name"),
  lastName: z.string().refine(hasVisibleName, "Enter your last name"),
  country: z.enum(SIGNUP_COUNTRIES, "Select a country"),
});
