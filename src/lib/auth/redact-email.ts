/** Replaces every occurrence of the address (any case) in a piece of text with "[email]", for text that is about to be logged. Supabase's own error messages can quote it. */
export function redactEmail(text: string, email: string): string {
  if (!email) return text;
  return text.split(new RegExp(email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi")).join("[email]");
}
