import { formatDate } from "@/lib/format/datetime";

/**
 * What each refusal says, shared by the page (a link that cannot be offered) and the form (a link refused on submit),
 * so the two cannot drift.
 *
 * An unknown or tampered token and an expired one say the SAME thing on purpose: a visitor poking at tokens learns
 * nothing about which ones exist or used to. Everything else is specific, because it is only reachable with a real link
 * the person was emailed, and being clear is the point.
 */
export type RefusalKey = "used" | "closed" | "no_closing_date" | "invalid" | "expired" | "error";

export function refusalCopy(refusal: { outcome: RefusalKey; closesAt?: string }): { heading: string; body: string } {
  switch (refusal.outcome) {
    case "used":
      return {
        heading: "Already extended.",
        body: refusal.closesAt
          ? `This job now closes ${formatDate(refusal.closesAt)}.`
          : "This link has already been used. Check Jobs Posted for the closing date.",
      };
    case "closed":
      return { heading: "This job has closed.", body: "Reopen it from your dashboard." };
    case "no_closing_date":
      return {
        heading: "This job has no closing date.",
        body: "There is nothing to extend. You can set a closing date from Jobs Posted.",
      };
    case "invalid":
    case "expired":
      return {
        heading: "This link isn't valid.",
        body: "It may have been copied incompletely, or it may be out of date. Nothing has been changed. You can change a closing date from Jobs Posted.",
      };
    case "error":
      return {
        heading: "That did not go through.",
        body: "Nothing has been changed. Try again in a moment, or edit the closing date from Jobs Posted.",
      };
  }
}
