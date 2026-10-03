/** "1 credit", "12 credits". One place, so the email, the Settings section and the confirm page cannot disagree. */
export function creditsPhrase(n: number): string {
  return `${n} credit${n === 1 ? "" : "s"}`;
}

/** "₦4,500". Plain text, for emails; the screens use <NairaAmount>. */
export function nairaPhrase(n: number): string {
  return `₦${n.toLocaleString("en-NG")}`;
}

/**
 * The two sentences the owner fixed for the postings an only-member's deletion closes. The same words on the Settings screen, the confirm step and
 * both emails, so a person is never told one thing here and another there. Real titles are always listed with them.
 */
export const CLOSING_POSTINGS_NOTICE = "These postings will be closed now and permanently removed 30 days after closing.";
export const RESTORE_DOES_NOT_REOPEN = "Restoring your account won’t reopen them.";

/** What happens to an organisation's ad wallet. It stays with the organisation; nothing forfeits it. */
export function adWalletNotice(balanceNgn: number): string {
  return `The ad wallet of your organisation holds ${nairaPhrase(balanceNgn)}. It stays with the organisation and is not forfeited, but nobody can use it unless you restore your account or someone joins.`;
}

/** The three things restoring does NOT bring back, said the same way on the prompt and in the "restored" email. */
export const RESTORE_LIMITS =
  "Auto-Apply stays off, and any Pass you had does not renew until you resubscribe. Postings that were closed stay closed.";
