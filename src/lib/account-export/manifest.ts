/**
 * ACCT-1 PR 2a: what "Download my data" contains, column by column.
 *
 * Every column of every table the export reads is given ONE class here. The generated types are the list of columns, and
 * tests/lib/account-export/manifest.test.ts fails when a table has a column this file does not classify, when a classified column is not a column any
 * more, and when a foreign key into a person (docs/account-deletion-map.md) is neither a table here nor an entry in EXCLUDED_TABLES with its reason. So a new
 * column, table or key cannot leave the export (or enter it) without somebody deciding here what it is.
 *
 * THE OWNER'S RULES (6 Oct 2026), which the classes carry:
 *   1. The person's own data and what is about them is exported. Nothing else: other people's data is out.
 *   2. Other parties are reduced to a ROLE or a FIRST NAME, never contact details: no email, phone, address, handle, and no id of the other person.
 *   3. Bank details are exported masked: the bank NAME and the LAST FOUR digits of the account number, nothing more. That rule lives in ONE place
 *      (maskBankDetails in shape.ts); the manifest only says which two columns it applies to.
 *   4. Secrets and tokens are never exported: card authorisation codes, renewal references, the transfer recipient code, unsubscribe and confirmation tokens.
 *
 * THE CLASSES
 *   include        the person's own column. It is written to the file as it is.
 *   own-contact    the person's OWN email address: included, and the only kind of contact detail that may be (the guard names every column
 *                  whose name looks like a contact detail and fails unless it is this class or an excluded one).
 *   bank-name      payout_bank_code, written as the bank's NAME.
 *   bank-last-four payout_account_number, written as its last four digits.
 *   side:<col>     included only on a row where <col> is the person (a mentor's own payout amounts; each side's own notes). The text of a note is the
 *                  author's own, but an email address or a phone number typed into it is somebody else's contact detail, so it is masked.
 *   party:<role>[:name]  the id of ANOTHER person on the row. The id is dropped; the file says `<column>_role` (what they are to the person) and, with
 *                  `:name`, `<column>_first_name`. On a row where the column is the person themselves the file says `<column>_is_you: true` instead.
 *   never          a secret, a token or a provider reference. Not exported, whatever the table.
 *   other-party    another person's words or record about or around the person (a reviewer's private notes, an employer's message, a staff note).
 *   internal       infrastructure that is not the person's data (throttle counters).
 */

import { NOTIFICATION_TABLES } from "@/lib/notifications/contract-db";

export type ColumnClass =
  | { kind: "include" }
  | { kind: "own-contact" }
  | { kind: "bank-name" }
  | { kind: "bank-last-four" }
  | { kind: "side"; column: string; text: boolean }
  | { kind: "party"; role: string; firstName: boolean }
  | { kind: "never"; why: string }
  | { kind: "other-party"; why: string }
  | { kind: "internal"; why: string };

export interface ExportTable {
  table: string;
  /** The column(s) that hold the person's id. A row is the person's when ANY of them equals their id. */
  owner: readonly string[];
  /** The column the rows are paged and ordered by (a unique one). */
  orderBy: string;
  columns: Record<string, ColumnClass>;
}

type Spec = {
  owner: string[];
  orderBy?: string;
  include?: string;
  ownContact?: string;
  bankName?: string;
  bankLastFour?: string;
  /** "column:mentor_id" = included only when mentor_id is the person. Text columns are masked for contact details. */
  side?: Record<string, { column: string; text?: boolean }>;
  party?: Record<string, { role: string; firstName?: boolean }>;
  never?: Record<string, string>;
  otherParty?: Record<string, string>;
  internal?: Record<string, string>;
};

const words = (s: string | undefined): string[] => (s ?? "").split(/[\s,]+/).filter(Boolean);

function table(name: string, spec: Spec): ExportTable {
  const columns: Record<string, ColumnClass> = {};
  const put = (c: string, v: ColumnClass) => {
    if (columns[c]) throw new Error(`account export manifest: ${name}.${c} is classified twice`);
    columns[c] = v;
  };
  for (const c of words(spec.include)) put(c, { kind: "include" });
  for (const c of words(spec.ownContact)) put(c, { kind: "own-contact" });
  for (const c of words(spec.bankName)) put(c, { kind: "bank-name" });
  for (const c of words(spec.bankLastFour)) put(c, { kind: "bank-last-four" });
  for (const [c, s] of Object.entries(spec.side ?? {})) put(c, { kind: "side", column: s.column, text: !!s.text });
  for (const [c, p] of Object.entries(spec.party ?? {})) put(c, { kind: "party", role: p.role, firstName: !!p.firstName });
  for (const [c, why] of Object.entries(spec.never ?? {})) put(c, { kind: "never", why });
  for (const [c, why] of Object.entries(spec.otherParty ?? {})) put(c, { kind: "other-party", why });
  for (const [c, why] of Object.entries(spec.internal ?? {})) put(c, { kind: "internal", why });
  return { table: name, owner: spec.owner, orderBy: spec.orderBy ?? "id", columns };
}

const SECRET = "a card authorisation or renewal reference: it could be used to charge or identify the card";
const TOKEN = "a single-use or unsubscribe token: possessing it grants an action";
const PROVIDER_REF = "a payment-provider transfer reference, not the person's data";
const STAFF = "a staff member's own record about this row";
const REVIEWER = "the reviewer's own record, not the person's";

export const EXPORT_MANIFEST: readonly ExportTable[] = [
  table("profiles", {
    owner: ["id"],
    include:
      "country created_at credits_balance deletion_requested_at farah_hint_dismissed_at first_name free_trial_cover_letter_used free_trial_tailoring_used id last_active_at last_name locale market_segment onboarding_skipped_at referral_code referral_leaderboard_display_name referral_leaderboard_opt_in resume_skills_notice_dismissed_at talent_available_for_hire talent_boosted_until talent_directory_opt_in talent_earliest_start_date talent_remote_ready talent_verification_score talent_verification_status talent_verified_at updated_at",
    ownContact: "email",
    party: { referred_by: { role: "the person who referred you" } },
  }),
  table("account_deletions", {
    owner: ["profile_id"],
    include: "confirmed_at credits_forfeited hard_delete_after id profile_id refund_note refund_policy requested_at restored_at status",
    never: { token_hash: TOKEN, token_expires_at: TOKEN },
  }),
  table("admin_users", { owner: ["id"], include: "created_at disabled_at display_name id last_login_at role role_id", ownContact: "email" }),
  table("ad_events", { owner: ["user_id"], include: "campaign_id dedup_bucket event_type id job_posting_id occurred_at surface user_id" }),
  table("api_rate_limits", { owner: ["user_id"], orderBy: "bucket", internal: { bucket: "throttle counter", request_count: "throttle counter", user_id: "throttle counter", window_start: "throttle counter" } }),
  table("application_stage_events", { owner: ["user_id"], include: "application_id changed_at id stage user_id" }),
  table("applications", {
    owner: ["user_id"],
    include: "applied_at cover_letter_id cover_letter_snapshot created_at id job_posting_id manual_job_snapshot notes resume_id resume_snapshot screening_passed source stage updated_at user_id",
  }),
  table("auto_apply_queue", { owner: ["user_id"], include: "application_id credits_spent decided_at id job_posting_id match_score queued_at source_type status tier user_id" }),
  table("auto_apply_settings", { owner: ["user_id"], orderBy: "user_id", include: "created_at enabled enabled_at updated_at user_id" }),
  table("country_default_events", { owner: ["user_id"], include: "country_state created_at event_type id job_posting_id tab user_id" }),
  table("course_recommendation_clicks", { owner: ["user_id"], include: "clicked_at id recommendation_id skill_tag source user_id" }),
  table("credit_gate_events", { owner: ["user_id"], include: "created_at credits_available credits_required id outcome reason related_entity_id user_id" }),
  table("credit_ledger", { owner: ["user_id"], include: "balance_after created_at delta id reason related_entity_id user_id" }),
  table("email_preferences", {
    owner: ["user_id"],
    orderBy: "user_id",
    include:
      "auto_apply_digest_last_sent_at created_at digest_last_sent_at employer_resume_view job_match_digest new_applicant_notice proactive_match_alert scholarship_deadline_alert updated_at user_id win_back_email win_back_last_sent_at",
    never: { unsubscribe_token: TOKEN },
  }),
  table("farah_messages", { owner: ["user_id"], include: "content context created_at id role user_id" }),
  table("farah_session_events", { owner: ["user_id"], include: "created_at entry_point event_type id session_id user_id" }),
  table("feedback", {
    owner: ["user_id"],
    include: "category created_at id message page_path status triaged_at user_id",
    otherParty: { triage_note: STAFF, triaged_by: STAFF },
  }),
  table("job_posting_reports", { owner: ["reporter_id"], include: "created_at details id job_posting_id reason reporter_id" }),
  table("job_tailoring_requests", { owner: ["user_id"], include: "created_at credits_spent gap_analysis id is_free_trial source_jd_text source_job_posting_id tailored_cover_letter_id tailored_resume_id user_id" }),
  table("match_scores", { owner: ["user_id"], include: "computed_at explanation id job_posting_id score tier user_id" }),
  table("mentor_availability_slots", { owner: ["mentor_id"], include: "created_at end_at id is_booked mentor_id start_at" }),
  table("mentor_payouts", {
    owner: ["mentor_id"],
    include: "amount_ngn attempt_count created_at eligible_at failure_reason id last_attempted_at mentor_id paid_at session_id status updated_at",
    never: { paystack_transfer_code: PROVIDER_REF, pending_transfer_reference: PROVIDER_REF },
  }),
  table("mentor_profiles", {
    owner: ["user_id"],
    orderBy: "user_id",
    include: "applied_at base_price_ngn bio display_name expertise_industries expertise_roles expertise_seniority payout_bank_verified_at reviews_verifications self_paused status user_id years_experience reviewed_at",
    bankName: "payout_bank_code",
    bankLastFour: "payout_account_number",
    never: {
      payout_account_name: "payout detail beyond the bank name and the last four digits (the owner's masking rule)",
      payout_recipient_code: "the transfer recipient code: it identifies the account to the payment provider",
    },
    otherParty: { review_note: STAFF, reviewed_by: STAFF },
  }),
  table("mentorship_reviews", {
    owner: ["reviewer_id", "mentor_id"],
    include: "created_at id rating review_text session_id",
    party: { reviewer_id: { role: "the mentee who wrote the review", firstName: true }, mentor_id: { role: "the mentor reviewed", firstName: true } },
  }),
  table("mentorship_sessions", {
    owner: ["mentee_id", "mentor_id"],
    include: "availability_slot_id created_at id meeting_link mentor_confirmed_at price_ngn reminder_sent_at scheduled_end scheduled_start session_type status updated_at",
    side: {
      mentee_notes: { column: "mentee_id", text: true },
      mentor_notes: { column: "mentor_id", text: true },
      mentor_payout_ngn: { column: "mentor_id" },
      platform_commission_ngn: { column: "mentor_id" },
    },
    party: { mentee_id: { role: "the mentee", firstName: true }, mentor_id: { role: "the mentor", firstName: true } },
  }),
  table("organization_members", { owner: ["user_id"], orderBy: "organization_id", include: "created_at organization_id role user_id" }),
  table("payment_transactions", {
    owner: ["user_id"],
    include: "amount channel created_at currency id organization_id paystack_reference product_id product_type rail renewal_for_pass_id status user_id",
    never: { authorization_code: SECRET },
    internal: {
      reconcile_attempts: "a payment-reconciliation job's bookkeeping (0247)",
      reconcile_checked_at: "a payment-reconciliation job's bookkeeping (0247)",
      reconcile_result: "a payment-reconciliation job's bookkeeping (0247)",
    },
  }),
  table("proactive_match_alerts", { owner: ["user_id"], orderBy: "sent_at", include: "job_posting_id score sent_at user_id" }),
  table("referral_reward_events", {
    owner: ["referrer_id", "referred_user_id"],
    include: "created_at credits_granted id notified_at reason referral_id",
    party: { referrer_id: { role: "the person who referred" }, referred_user_id: { role: "the person who was referred" } },
  }),
  table("referral_shares", { owner: ["user_id"], include: "channel created_at id surface user_id" }),
  table("referrals", {
    owner: ["referrer_id", "referred_user_id"],
    include: "activated_at created_at id reward_credits_referred reward_credits_referrer reward_withheld_reason signed_up_at status",
    party: { referrer_id: { role: "the person who referred" }, referred_user_id: { role: "the person who was referred" } },
  }),
  table("resume_builder_start_events", { owner: ["user_id"], include: "created_at event_type id resume_id start_state user_id" }),
  table("resumes", { owner: ["user_id"], include: "created_at id is_base parse_confidence source structured_content tailored_for_job_id template_id title updated_at user_id" }),
  table("scholarship_saves", { owner: ["user_id"], include: "created_at deadline_reminder_sent_at id notes outcome_note scholarship_id status updated_at user_id" }),
  table("talent_directory_boosts", { owner: ["user_id"], include: "boosted_until credit_ledger_id days decided_at id requested_at status user_id" }),
  table("talent_directory_contact_requests", {
    owner: ["candidate_id"],
    include: "candidate_id created_at decided_at id organization_id status",
    party: { requested_by: { role: "an employer at the organisation" } },
    otherParty: { message: "the employer's own words: they may carry the employer's contact details" },
  }),
  table("talent_portfolio_items", { owner: ["user_id"], include: "created_at description id title url user_id" }),
  table("talent_verifications", {
    owner: ["user_id"],
    include: "ai_feedback ai_score claimed_at credit_ledger_id decided_at id requested_at review_type status target_industry target_role user_id",
    internal: { flag_source: "how the grader detected an instruction-like resume (0238): detection detail, not the person's content" },
    otherParty: {
      reviewer_id: REVIEWER,
      reviewer_notes: REVIEWER,
      reviewer_paid_at: "the reviewer's payment, not the person's",
      reviewer_payout_ngn: "the reviewer's payment, not the person's",
      reviewer_payout_reference: "the reviewer's payment, not the person's",
    },
  }),
  table("user_notifications", { owner: ["user_id"], include: "body created_at id link read_at title type user_id" }),
  table("user_passes", {
    owner: ["user_id"],
    include: "auto_renew auto_renew_status created_at expires_at id last_renewal_failure_at next_renewal_date pass_id payment_method payment_transaction_id renewal_attempt_count renewal_reminder_sent_at started_at status user_id",
    never: { authorization_code: SECRET, pending_renewal_reference: SECRET },
    internal: { renewal_claimed_at: "a renewal job's lock timestamp" },
  }),
  table("user_template_unlocks", { owner: ["user_id"], include: "id template_id unlocked_at user_id" }),
];

/**
 * Tables with a key into a person that the export deliberately does NOT read, with the reason: the row is an organisation's, a staff member's, or
 * somebody else's record, not the person's data. tests/lib/account-export/manifest.test.ts makes every foreign key of docs/account-deletion-map.md
 * land either in EXPORT_MANIFEST or here.
 */
export const EXCLUDED_TABLES: Record<string, string> = {
  ad_campaigns: "an organisation's campaign; the person is only its creator",
  applicant_messages: "an organisation's record of a message it sent to an applicant (0256); the person is only the employer member who sent it. What an employer wrote to the person is not included either (see the README)",
  data_export_files: "the state of an admin-produced export (0263): ids, a status and times; no content of the person's",
  employer_job_feed_attempts: "an organisation's feed connection attempt (0246); the person is only who tried",
  employer_job_feeds: "an organisation's job feed and its consent record (0246); the person is only who ticked the consent",
  farah_free_claims: "a pending claim on one free Farah message, held for at most 120 seconds (0236): transient state, not the person's content",
  interview_offers: "an organisation's offer of interview times (0253); the person is only the employer member who offered them",
  ad_wallet_ledger: "an organisation's wallet movement; the person is only the actor",
  employer_applicant_status: "an employer member's review mark on someone else's applicant",
  feature_flags: "a flag's last editor (staff)",
  job_posting_assessments: "an organisation's assessment; the person is only its author",
  job_postings: "an organisation's posting; the person is only the admin who reviewed or removed it",
  organizations: "an organisation, not the person; the person is only its creator or the admin who confirmed it",
  scholarships: "a catalogue entry; the person is only the admin who moderated it",
  talent_directory_waitlist: "an organisation's waitlist entry; the person is only who joined it",
  [NOTIFICATION_TABLES.adminMessageRecipients]: "an operator's record of who a message was prepared for (0265); the person is only a recipient; export decision tracked in DATA-EXPORT-NOTIF-1",
  [NOTIFICATION_TABLES.deliveries]: "delivery bookkeeping; export decision tracked in DATA-EXPORT-NOTIF-1",
  [NOTIFICATION_TABLES.pushSubscriptions]: "the person's browser push devices (0265): the endpoint and keys are credentials and are never exported; export decision tracked in DATA-EXPORT-NOTIF-1",
  test_user_pool: "test infrastructure, absent from a real account",
  blog_posts: "a post's author is staff",
  "auth.*": "the auth schema: sessions, identities and factors are not exported",
};

export const MANIFEST_BY_TABLE: ReadonlyMap<string, ExportTable> = new Map(EXPORT_MANIFEST.map((t) => [t.table, t]));
