/**
 * The words of /unsubscribe, one place for the server page, the confirm button (a client component) and the tests. `confirm` is what the page says BEFORE anything has changed (a GET only shows it);
 * `unsubscribed` is what it says after the confirm action or the one-click POST has done the work.
 */
export const COPY = {
  job_match_digest: {
    confirm: {
      heading: "Stop the weekly job-match email?",
      body: "Nothing has changed yet. Press the button to unsubscribe. This doesn't affect your account, or messages about things you asked for, like receipts and password resets.",
    },
    unsubscribed: {
      heading: "You're unsubscribed.",
      body: "We won't send you the weekly job-match email again. This doesn't affect your account, and it doesn't stop messages about things you asked for — password resets, payment receipts, and the like.",
    },
  },
  proactive_match_alert: {
    confirm: {
      heading: "Stop the \"exceptional match\" alerts?",
      body: "Nothing has changed yet. Press the button to unsubscribe. This doesn't affect your account, or messages about things you asked for, like receipts and password resets.",
    },
    unsubscribed: {
      heading: "You're unsubscribed.",
      body: "Farah won't send the rare \"exceptional match\" alert to your inbox again. This doesn't affect your account, your weekly digest (if you're subscribed to it), or anything else Talentrah sends.",
    },
  },
  scholarship_deadline_alert: {
    confirm: {
      heading: "Stop scholarship deadline reminders?",
      body: "Nothing has changed yet. Press the button to unsubscribe. This doesn't affect your account, or messages about things you asked for, like receipts and password resets.",
    },
    unsubscribed: {
      heading: "You're unsubscribed.",
      body: "We won't send you a reminder when a saved scholarship's deadline is approaching. This doesn't affect your account, your saved scholarships, or anything else Talentrah sends.",
    },
  },
  announcements: {
    confirm: {
      heading: "Stop announcements from Talentrah?",
      body: "Nothing has changed yet. Press the button to unsubscribe. This doesn't affect your account, or messages about things you asked for, like receipts and password resets.",
    },
    unsubscribed: {
      heading: "You're unsubscribed.",
      body: "We won't email you announcements from Talentrah again. This doesn't affect your account, offers and promotions (if you chose them), or anything else Talentrah sends, like receipts and password resets.",
    },
  },
  promotions: {
    confirm: {
      heading: "Stop offers and promotions from Talentrah?",
      body: "Nothing has changed yet. Press the button to unsubscribe. This doesn't affect your account, or messages about things you asked for, like receipts and password resets.",
    },
    unsubscribed: {
      heading: "You're unsubscribed.",
      body: "We won't email you offers and promotions from Talentrah again. This doesn't affect your account, announcements, or anything else Talentrah sends, like receipts and password resets.",
    },
  },
  win_back_email: {
    confirm: {
      heading: "Stop the \"here's what you missed\" email?",
      body: "Nothing has changed yet. Press the button to unsubscribe. This doesn't affect your account, or messages about things you asked for, like receipts and password resets.",
    },
    unsubscribed: {
      heading: "You're unsubscribed.",
      body: "Farah won't email you a \"here's what you missed\" summary if you go quiet for a while. This doesn't affect your account, or anything else Talentrah sends.",
    },
  },
} as const;

/** Shown for a link with no token, and after a confirm that matched nothing or failed. Nothing has been altered in either case. */
export const NOT_WORKING_COPY = {
  heading: "That link didn't work.",
  body: "It may have already been used, or the address may have been changed since the email went out. Nothing has been altered. If you keep receiving email you don't want, reply to any of it and we'll sort it out by hand.",
} as const;
