/** What stands between a person and deleting their account, as account_deletion_blockers() returns it (migration 0212). */
export interface DeletionBlockers {
  /** Paid mentoring sessions still ahead, on either side. */
  mentorship_sessions: Array<{
    id: string;
    role: "mentor" | "mentee";
    session_type: string;
    scheduled_start: string;
    status: string;
  }>;
  /** A mentor's payouts that have not been paid. */
  mentor_payouts: Array<{ id: string; amount_ngn: number; status: string }>;
  /** Organisations the person owns that other people also belong to. */
  organisations_with_other_members: Array<{ id: string; name: string }>;
  /** Open postings that will be closed: the person is the only member of the organisation. */
  postings_to_close: Array<{ id: string; title: string; organization: string }>;
  campaigns_to_pause: number;
  /** What the ad wallets of those organisations hold, in naira. Never forfeited: it stays with the organisation. */
  ad_wallet_balance_ngn: number;
  blocked: boolean;
}

export const NO_BLOCKERS: DeletionBlockers = {
  mentorship_sessions: [],
  mentor_payouts: [],
  organisations_with_other_members: [],
  postings_to_close: [],
  campaigns_to_pause: 0,
  ad_wallet_balance_ngn: 0,
  blocked: false,
};
