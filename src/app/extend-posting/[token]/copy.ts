/** What each refusal says, shared by the page (a link that cannot be offered) and the form (a link refused on submit). */
export const REFUSALS = {
  used: {
    heading: "This link has already been used.",
    body: "Each link extends a posting once. Open Jobs Posted if you want to change the closing date.",
  },
  expired: {
    heading: "This link has expired.",
    body: "The posting's closing date has passed, so this link no longer works. Open Jobs Posted to reopen it.",
  },
  invalid: {
    heading: "That link is not valid.",
    body: "It may have been copied incompletely. Nothing has been changed. Open the posting from Jobs Posted instead.",
  },
  unavailable: {
    heading: "This posting is no longer open.",
    body: "It has been closed or removed, so it can't be extended from this link. Nothing has been changed.",
  },
  error: {
    heading: "That did not go through.",
    body: "Nothing has been changed. Try again in a moment, or edit the closing date from Jobs Posted.",
  },
} as const;
