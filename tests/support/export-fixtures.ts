/**
 * People and rows for the account export tests. Every secret, every contact detail of another person and every id of another person is a distinct, searchable
 * string, so a test can search the whole file for it and fail on any hit.
 */
import type { FakeRow } from "./fake-export-db";

export const MENTOR = "11111111-1111-4111-8111-111111111111";
export const MENTEE = "22222222-2222-4222-8222-222222222222";
export const EMPLOYER = "33333333-3333-4333-8333-333333333333";
export const STAFF = "44444444-4444-4444-8444-444444444444";
export const REFERRED = "55555555-5555-4555-8555-555555555555";
export const ORG = "66666666-6666-4666-8666-666666666666";
export const SESSION = "77777777-7777-4777-8777-777777777777";

/** Things that must never be in anyone's file (secrets and masked-out detail). */
export const HIDDEN_ACCOUNT_NUMBER = "0123456789";
export const HIDDEN_RECIPIENT_CODE = "RCP_secret_recipient_9f3a";
export const HIDDEN_ACCOUNT_NAME = "ZZ Hidden Account Holder";
export const HIDDEN_AUTH_CODE = "AUTH_secret_card_77aa";
export const HIDDEN_RENEWAL_REF = "RENEW_secret_ref_55cc";
export const HIDDEN_UNSUBSCRIBE = "UNSUB_secret_token_33dd";
export const HIDDEN_CONFIRM_LINK_DIGEST = "deadbeef_token_hash_11ee";
export const HIDDEN_TRANSFER_CODE = "TRF_secret_transfer_22ff";

/** Other people's contact details, which must not appear in the mentor's or the mentee's file. */
export const MENTEE_EMAIL = "ngozi.mentee@example.test";
export const MENTEE_PHONE = "+234 803 000 1234";
export const MENTOR_EMAIL = "ada.mentor@example.test";
export const EMPLOYER_EMAIL = "hr.person@acme.example.test";
export const EMPLOYER_PHONE = "+234 801 111 2222";
export const STAFF_NOTE = "STAFF-NOTE internal vetting remark 8c1d";
export const REVIEWER_NOTE = "REVIEWER-NOTE private remark 6b2e";

export function fixtureTables(): Record<string, FakeRow[]> {
  return {
    profiles: [
      { id: MENTOR, first_name: "Ada", last_name: "Mentor", email: MENTOR_EMAIL, country: "NG", referred_by: STAFF, credits_balance: 5, created_at: "2026-01-01T00:00:00Z" },
      { id: MENTEE, first_name: "Ngozi", last_name: "Mentee", email: MENTEE_EMAIL, country: "NG", referred_by: null, credits_balance: 1, created_at: "2026-02-01T00:00:00Z" },
      { id: EMPLOYER, first_name: "Emeka", last_name: "Employer", email: EMPLOYER_EMAIL, country: "NG", referred_by: null, credits_balance: 0, created_at: "2026-02-02T00:00:00Z" },
    ],
    mentor_profiles: [
      {
        user_id: MENTOR,
        bio: "I coach people through interviews.",
        display_name: "Ada M.",
        payout_bank_code: "058",
        payout_account_number: HIDDEN_ACCOUNT_NUMBER,
        payout_account_name: HIDDEN_ACCOUNT_NAME,
        payout_recipient_code: HIDDEN_RECIPIENT_CODE,
        payout_bank_verified_at: "2026-03-01T00:00:00Z",
        review_note: STAFF_NOTE,
        reviewed_by: STAFF,
        status: "approved",
        base_price_ngn: 10000,
      },
    ],
    mentor_payouts: [
      { id: "p1", mentor_id: MENTOR, session_id: SESSION, amount_ngn: 8500, status: "paid", paystack_transfer_code: HIDDEN_TRANSFER_CODE, pending_transfer_reference: "pending_ref_zz" },
    ],
    mentorship_sessions: [
      {
        id: SESSION,
        mentor_id: MENTOR,
        mentee_id: MENTEE,
        status: "completed",
        price_ngn: 10000,
        mentor_payout_ngn: 8500,
        platform_commission_ngn: 1500,
        mentor_notes: `Ngozi (${MENTEE_EMAIL}, ${MENTEE_PHONE}) needs help with salary negotiation; follow up next week.`,
        mentee_notes: "I want to practise answers about my last role.",
        session_type: "mock_interview",
        scheduled_start: "2026-03-10T10:00:00Z",
        scheduled_end: "2026-03-10T11:00:00Z",
      },
    ],
    mentorship_reviews: [{ id: "r1", session_id: SESSION, mentor_id: MENTOR, reviewer_id: MENTEE, rating: 5, review_text: "Very helpful.", created_at: "2026-03-11T00:00:00Z" }],
    talent_directory_contact_requests: [
      { id: "c1", candidate_id: MENTEE, organization_id: ORG, requested_by: EMPLOYER, status: "pending", message: `Hi, call me on ${EMPLOYER_PHONE} or write to ${EMPLOYER_EMAIL}`, created_at: "2026-04-01T00:00:00Z" },
    ],
    talent_verifications: [
      { id: "v1", user_id: MENTEE, status: "verified", review_type: "human", ai_feedback: "Good structure.", reviewer_id: STAFF, reviewer_notes: REVIEWER_NOTE, reviewer_payout_ngn: 2000, target_role: "Analyst" },
    ],
    payment_transactions: [{ id: "t1", user_id: MENTEE, amount: 2500, currency: "NGN", status: "success", authorization_code: HIDDEN_AUTH_CODE, paystack_reference: "ref_public_1" }],
    user_passes: [{ id: "u1", user_id: MENTEE, status: "active", authorization_code: HIDDEN_AUTH_CODE, pending_renewal_reference: HIDDEN_RENEWAL_REF, auto_renew: true }],
    email_preferences: [{ user_id: MENTEE, job_match_digest: true, unsubscribe_token: HIDDEN_UNSUBSCRIBE }],
    account_deletions: [{ id: "d1", profile_id: MENTEE, status: "scheduled", token_hash: HIDDEN_CONFIRM_LINK_DIGEST, requested_at: "2026-10-01T00:00:00Z" }],
    referrals: [{ id: "f1", referrer_id: MENTEE, referred_user_id: REFERRED, status: "activated", created_at: "2026-05-01T00:00:00Z" }],
    feedback: [{ id: "fb1", user_id: MENTEE, message: "Great product", category: "general", triage_note: STAFF_NOTE, triaged_by: STAFF }],
    applications: [{ id: "a1", user_id: MENTEE, stage: "applied", notes: "Phoned the recruiter" }],
    resumes: [{ id: "res1", user_id: MENTEE, title: "My resume", structured_content: { summary: "Analyst" } }],
  };
}
