import { describe, expect, expectTypeOf, it } from "vitest";
import {
  ADMIN_MESSAGE_EVENT_KINDS,
  ADMIN_MESSAGE_KINDS,
  ADMIN_MESSAGE_STATUSES,
  ADMIN_RECIPIENT_OUTCOMES,
  ADMIN_SEGMENT_KEYS,
  EMAIL_LIMIT_REFUSALS,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_FLAGS,
  NOTIFICATION_KINDS,
  NOTIFICATION_LIMITS,
  NOTIFICATION_PERMISSIONS,
  NOTIFICATION_SETTING_KEYS,
  PUSH_RELEASE_REASONS,
  PUSH_REVOKE_REASONS,
  STALE_CLAIM_RESOLUTIONS,
  UNSUBSCRIBE_STREAMS,
  type AdminMessageEventDetail,
  type AdminMessageEventRow,
  type AdminMessageRecipientRow,
  type AdminMessageRow,
  type NotificationDeliveryRow,
  type NotificationSettingChangeRow,
  type NotificationSettingRow,
  type NotificationTableRows,
  type PushSubscriptionClientRow,
  type PushSubscriptionRow,
} from "@/lib/notifications/contract";
import { CLAIM_REFUSALS } from "@/lib/notifications/contract-db";

/**
 * VALUE PINS for every closed list and number the contract repeats from the
 * migration author's prompt. A test that exercises the logic around a value but
 * never the value would let a silent change through, so each is asserted to
 * equal what the prompt says.
 */
describe("closed lists equal the prompt", () => {
  it("ledger kinds and channels", () => {
    expect([...NOTIFICATION_KINDS]).toEqual(["new_applicant", "application_viewed", "match_alert", "admin_message"]);
    expect([...NOTIFICATION_CHANNELS]).toEqual(["inapp", "push", "email"]);
  });
  it("push release reasons and revoke reasons", () => {
    expect([...PUSH_RELEASE_REASONS]).toEqual(["gone", "rejected_413", "retries_exhausted", "our_key", "pre_send_failure"]);
    expect([...PUSH_REVOKE_REASONS]).toEqual(["gone", "user", "kill", "deleted", "bad_key"]);
  });
  it("admin message kinds, segments, outcomes and resolutions", () => {
    expect([...ADMIN_MESSAGE_KINDS]).toEqual(["service_announcement", "promotion"]);
    expect([...ADMIN_SEGMENT_KEYS]).toEqual([
      "everyone", "seekers", "employers", "verified_employers", "inactive_seekers", "signed_up_since", "country", "self_test",
    ]);
    expect([...ADMIN_RECIPIENT_OUTCOMES].sort()).toEqual(
      ["failed", "sent", "skipped_cap", "skipped_deleted", "skipped_inactive", "skipped_opted_out", "skipped_quiet_hours"],
    );
    expect([...STALE_CLAIM_RESOLUTIONS]).toEqual(["mark_sent", "release_for_retry"]);
    expect([...UNSUBSCRIBE_STREAMS]).toEqual(["announcements", "promotions"]);
  });
  it("audit event kinds (the addendum's list)", () => {
    expect([...ADMIN_MESSAGE_EVENT_KINDS]).toEqual([
      "created", "prepared", "test_sent", "submitted", "approved", "rejected", "send_started", "send_finished",
      "cancelled", "flag_stopped", "claim_resolved", "resumed",
    ]);
  });
  it("statuses include the two paused ones and every status the prompt spells", () => {
    for (const spelled of ["draft", "prepared", "approved", "sending", "sent", "paused_email_cap", "paused_email_ceiling"]) {
      expect(ADMIN_MESSAGE_STATUSES as readonly string[]).toContain(spelled);
    }
  });
  it("which limit refused, setting keys, permission labels", () => {
    expect([...CLAIM_REFUSALS]).toEqual([
      "device_unavailable", "quiet_hours", "budget_cap", "cap_24h", "ceiling_month", "already_claimed",
    ]);
    expect([...EMAIL_LIMIT_REFUSALS]).toEqual(["cap_24h", "ceiling_month"]);
    expect([...NOTIFICATION_SETTING_KEYS]).toEqual(["mass_email_cap_24h", "mass_email_ceiling_month"]);
    expect([...NOTIFICATION_PERMISSIONS]).toEqual(["user_messaging", "operators"]);
  });
  it("the five flags, all spelled by the prompt", () => {
    expect(NOTIFICATION_FLAGS).toEqual({
      master: "notifications_master",
      pushSender: "push_sender",
      adminMessaging: "admin_messaging",
      adminPromotions: "admin_promotions",
      adminEmail: "admin_email",
    });
  });
  it("the numbers the database enforces", () => {
    expect(NOTIFICATION_LIMITS).toMatchObject({
      userEventPushCap: 3,
      adminPushCap: 1,
      claimWindowHours: 24,
      quietHoursStart: 22,
      quietHoursEnd: 7,
      defaultTimezone: "Africa/Lagos",
      maxActiveDevices: 10,
      uaShortMaxLength: 40,
      adminAudienceDefaultMax: 500,
      adminAudienceCeiling: 5000,
      adminPerOperatorPerDay: 5,
      adminOverallPerDay: 10,
      adminEmailInactiveDays: 30,
      retentionDays: 30,
      defaultMassEmailCap24h: 50,
      defaultMassEmailCeilingMonth: 2000,
      settingMax: 10000,
    });
  });
});

describe("row types", () => {
  it("a person may select exactly five push subscription columns", () => {
    expectTypeOf<keyof PushSubscriptionClientRow>().toEqualTypeOf<"id" | "ua_short" | "created_at" | "last_seen_at" | "revoked_at">();
    // The credential-like columns and the time zone are not among them.
    expectTypeOf<Extract<keyof PushSubscriptionClientRow, "endpoint" | "p256dh" | "auth" | "timezone">>().toBeNever();
  });

  it("the audit detail keys are the closed pair the addendum fixes", () => {
    expectTypeOf<keyof AdminMessageEventDetail>().toEqualTypeOf<"kind_confirmed" | "resolution">();
  });

  it("the setting-change values are integers (numbers), never text or json", () => {
    expectTypeOf<NotificationSettingChangeRow["new_value"]>().toEqualTypeOf<number>();
    expectTypeOf<NotificationSettingChangeRow["old_value"]>().toEqualTypeOf<number | null>();
    expectTypeOf<NotificationSettingRow["int_value"]>().toEqualTypeOf<number>();
  });

  it("the only email-like column names are the addendum's reviewed ones", () => {
    type EmailLike<Row> = Extract<keyof Row, `${string}${"email" | "address" | "recipient"}${string}`>;
    type Found =
      | EmailLike<NotificationDeliveryRow>
      | EmailLike<PushSubscriptionRow>
      | EmailLike<AdminMessageRow>
      | EmailLike<AdminMessageRecipientRow>
      | EmailLike<AdminMessageEventRow>
      | EmailLike<NotificationSettingRow>
      | EmailLike<NotificationSettingChangeRow>;
    expectTypeOf<Found>().toEqualTypeOf<
      | "created_by_email"
      | "approved_by_email"
      | "actor_email"
      | "updated_by_email"
      | "to_email"
      | "email_outcome"
    >();
  });

  it("the boolean flag and the closed outcome are not free text", () => {
    expectTypeOf<AdminMessageRecipientRow["to_email"]>().toEqualTypeOf<boolean>();
    expectTypeOf<AdminMessageRecipientRow["email_outcome"]>().toEqualTypeOf<(typeof ADMIN_RECIPIENT_OUTCOMES)[number] | null>();
  });

  it("every table row is usable as a client row type (index-signature compatible)", () => {
    type AllRows = NotificationTableRows[keyof NotificationTableRows];
    expectTypeOf<AllRows>().toExtend<Record<string, unknown>>();
  });

  it("the count columns on the messages table are integers (numbers), never text", () => {
    expectTypeOf<AdminMessageRow["audience_count"]>().toEqualTypeOf<number>();
    expectTypeOf<AdminMessageRow["sent_count"]>().toEqualTypeOf<number>();
    expectTypeOf<AdminMessageRow["failed_count"]>().toEqualTypeOf<number>();
    expectTypeOf<AdminMessageRow["skipped_count"]>().toEqualTypeOf<number>();
    expectTypeOf<AdminMessageEventRow>().not.toHaveProperty("sent_count"); // event rows carry no counts
  });
});
