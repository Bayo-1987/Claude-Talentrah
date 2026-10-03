import { emailButton, emailParagraph, escEmail, renderBrandedEmail } from "@/lib/email/layout";
import { DELETION_LINK_TTL_MINUTES, RESTORE_WINDOW_DAYS } from "./token";
import { formatDate } from "@/lib/format/datetime";
import { CLOSING_POSTINGS_NOTICE, RESTORE_DOES_NOT_REOPEN, RESTORE_LIMITS, adWalletNotice, creditsPhrase } from "./copy";

/**
 * ACCT-1 — the email that carries the confirm link.
 *
 * NEUTRAL SYSTEM VOICE, not Farah's: this is a security step about the account, the kind of mail §6.10 gives the plain factual voice. No
 * unsubscribe footer: it is the direct consequence of something the reader just did, and there is no opt-out for it any more than for a password
 * reset.
 *
 * It states, in the body and not behind a link, everything the confirm step has to say: the link's life (one hour), what happens at once, the 30
 * days, that unused credits are forfeited (with the number), the postings that will be closed (by title) when the reader is the only member of an
 * organisation, and what to do if it was not them (nothing: the link stops working).
 */

export interface DeletionConfirmEmailParams {
  firstName: string | null;
  confirmUrl: string;
  creditsForfeited: number;
  postingsToClose: Array<{ title: string; organization: string }>;
  /** The ad wallet of an organisation the reader is the only member of. Zero says nothing. */
  adWalletBalanceNgn?: number;
}

export interface DeletionConfirmEmail {
  subject: string;
  text: string;
  html: string;
}

/** The postings by real title, then the owner's two sentences. Plain text; the HTML version escapes it. */
function closingPostingsParagraph(postings: Array<{ title: string; organization: string }>): string {
  return `You are the only member of your organisation, so its open postings will be closed: ${postings.map((p) => p.title).join("; ")}. ${CLOSING_POSTINGS_NOTICE} ${RESTORE_DOES_NOT_REOPEN} The organisation and its applications are kept.`;
}

function greeting(firstName: string | null): string {
  const name = firstName?.trim();
  return name ? `Hi ${name},` : "Hi,";
}

const hours = DELETION_LINK_TTL_MINUTES / 60;
const LINK_LIFE = `${hours} hour${hours === 1 ? "" : "s"}`;

export function buildDeletionConfirmEmail({ firstName, confirmUrl, creditsForfeited, postingsToClose, adWalletBalanceNgn = 0 }: DeletionConfirmEmailParams): DeletionConfirmEmail {
  const subject = "Confirm deleting your Talentrah account";

  const lines = [
    `You asked to delete your Talentrah account. To go ahead, open this link while you are signed in. It works once and expires in ${LINK_LIFE}.`,
    "What happens when you confirm: you are signed out everywhere, your profile is hidden from employers and the Talent Directory, Auto-Apply stops, any Pass stops renewing, and we stop emailing you.",
    `Your personal data is deleted after ${RESTORE_WINDOW_DAYS} days. If you sign in again before then, we will ask whether to restore the account or keep the deletion.`,
  ];
  if (creditsForfeited > 0) {
    lines.push(`You have ${creditsPhrase(creditsForfeited)} left. Unused credits are forfeited when the account is deleted.`);
  }
  if (postingsToClose.length > 0) {
    lines.push(closingPostingsParagraph(postingsToClose));
  }
  if (adWalletBalanceNgn > 0) lines.push(adWalletNotice(adWalletBalanceNgn));
  lines.push("If this was not you, ignore this email: the link stops working by itself and nothing changes.");

  const text = [greeting(firstName), "", lines[0], "", confirmUrl, "", ...lines.slice(1).flatMap((l) => [l, ""]), "Talentrah"].join("\n");

  const bodyHtml = [
    emailParagraph(escEmail(greeting(firstName))),
    emailParagraph(escEmail(lines[0])),
    emailButton("Confirm deleting my account", confirmUrl),
    ...lines.slice(1).map((l) => emailParagraph(escEmail(l))),
    emailParagraph("Talentrah", { muted: true }),
  ].join("\n");

  return { subject, text, html: renderBrandedEmail({ bodyHtml }) };
}

/* ── "your deletion is scheduled" ───────────────────────────────────────────────────────────────────────────────────────────────────────────────── */

export interface DeletionScheduledEmailParams {
  firstName: string | null;
  hardDeleteAfter: string | undefined;
  creditsForfeited: number;
  closedPostings: Array<{ title: string; organization: string }>;
  adWalletBalanceNgn?: number;
}

/**
 * Sent the moment the person confirms: the proof that it worked, the date, what was stopped, and the way back. It is the only email they get after
 * the confirm (the guard drops everything else), which is why it carries the whole picture rather than a link to one.
 */
export function buildDeletionScheduledEmail({ firstName, hardDeleteAfter, creditsForfeited, closedPostings, adWalletBalanceNgn = 0 }: DeletionScheduledEmailParams): DeletionConfirmEmail {
  const when = hardDeleteAfter ? formatDate(hardDeleteAfter) : `${RESTORE_WINDOW_DAYS} days from now`;
  const lines = [
    `Your Talentrah account is scheduled for deletion on ${when}. You have been signed out everywhere, your profile is hidden from employers and the Talent Directory, Auto-Apply has stopped, any Pass will not renew, and we have stopped emailing you.`,
    `If you change your mind, sign in before ${when} and choose "Restore my account". After that date your personal data is deleted and cannot be restored.`,
  ];
  if (creditsForfeited > 0) lines.push(`You have ${creditsPhrase(creditsForfeited)} left. They are forfeited if the deletion goes ahead.`);
  if (closedPostings.length > 0) {
    lines.push(`These postings were closed: ${closedPostings.map((p) => p.title).join("; ")}. ${CLOSING_POSTINGS_NOTICE} ${RESTORE_DOES_NOT_REOPEN}`);
  }
  if (adWalletBalanceNgn > 0) lines.push(adWalletNotice(adWalletBalanceNgn));

  const subject = "Your Talentrah account is scheduled for deletion";
  const text = [greeting(firstName), "", ...lines.flatMap((l) => [l, ""]), "Talentrah"].join("\n");
  const bodyHtml = [
    emailParagraph(escEmail(greeting(firstName))),
    ...lines.map((l) => emailParagraph(escEmail(l))),
    emailParagraph("Talentrah", { muted: true }),
  ].join("\n");
  return { subject, text, html: renderBrandedEmail({ bodyHtml }) };
}

/* ── "your account is restored" ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────── */

/** Sent when the person restores: the proof that it was undone, and the honest list of what restoring does not bring back. */
export function buildDeletionRestoredEmail({ firstName }: { firstName: string | null }): DeletionConfirmEmail {
  const lines = [
    "Your Talentrah account is restored. Your profile is visible to employers and the Talent Directory again, and we will email you as before.",
    RESTORE_LIMITS,
    "If you did not do this, sign in and change your password, then contact us.",
  ];
  const subject = "Your Talentrah account is restored";
  const text = [greeting(firstName), "", ...lines.flatMap((l) => [l, ""]), "Talentrah"].join("\n");
  const bodyHtml = [
    emailParagraph(escEmail(greeting(firstName))),
    ...lines.map((l) => emailParagraph(escEmail(l))),
    emailParagraph("Talentrah", { muted: true }),
  ].join("\n");
  return { subject, text, html: renderBrandedEmail({ bodyHtml }) };
}
