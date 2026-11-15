import { isFeatureEnabled } from "@/lib/flags/read";
import { NOTIFICATION_FLAGS, type NotificationKind } from "../contract";
import type { NotificationClient } from "../contract-db";
import type { DeliverRequest } from "../push/deliver";

/**
 * The gates in front of every event push (a new applicant, a first resume view, an excellent match). Shared by the three events so the order is the same everywhere:
 *
 *   1. notifications_master and push_sender, both on (an unreadable flag is off);
 *   2. the person's own switches: push_enabled and the event's own switch, both true (a missing row is off; each switch defaults to false in the database);
 *   3. only then the delivery step, which is the first place a claim is taken. No gate failing means no claim, no device read and no send.
 *
 * The sender is loaded with a dynamic import on the way in, so a page or a route that merely imports an event never loads the push library while the flags are off.
 */
export type PushEventKind = Extract<NotificationKind, "new_applicant" | "application_viewed" | "match_alert">;
export type PushSwitchColumn = "push_new_applicant" | "push_application_viewed" | "push_match_alert";
export type PushSwitches = Partial<Record<"push_enabled" | PushSwitchColumn, boolean>>;

const SWITCH_FOR_KIND: Record<PushEventKind, PushSwitchColumn> = {
  new_applicant: "push_new_applicant",
  application_viewed: "push_application_viewed",
  match_alert: "push_match_alert",
};

export type PushGateDeps = {
  flagOn(key: string): Promise<boolean>;
  /** The person's push switches, or null when they have no preference row. */
  prefs(userId: string): Promise<PushSwitches | null>;
  deliver(request: DeliverRequest): Promise<unknown>;
};

export type PushGateResult = "attempted" | "flags_off" | "switch_off" | "error";

export async function pushFlagsOn(deps: Pick<PushGateDeps, "flagOn">): Promise<boolean> {
  try {
    return (await deps.flagOn(NOTIFICATION_FLAGS.master)) === true && (await deps.flagOn(NOTIFICATION_FLAGS.pushSender)) === true;
  } catch {
    // A flag that cannot be read is a flag that is off.
    return false;
  }
}

/** Never throws. */
export async function pushIfAllowed(deps: PushGateDeps, input: { userId: string; kind: PushEventKind; subject: string; url: string }): Promise<PushGateResult> {
  try {
    if (!(await pushFlagsOn(deps))) return "flags_off";
    const switches = await deps.prefs(input.userId);
    if (!switches || switches.push_enabled !== true || switches[SWITCH_FOR_KIND[input.kind]] !== true) return "switch_off";
    await deps.deliver({ userId: input.userId, kind: input.kind, subject: input.subject, url: input.url, badge: null });
    return "attempted";
  } catch {
    // The caller's work (a response, an email, a cron run) is never changed by a push that could not go.
    return "error";
  }
}

/** The real gates over a service-role client. */
export function realPushGateDeps(client: NotificationClient): PushGateDeps {
  return {
    flagOn: isFeatureEnabled,
    prefs: async (userId) => {
      const { data, error } = await client
        .from("email_preferences")
        .select("push_enabled, push_new_applicant, push_application_viewed, push_match_alert")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw new Error("push: the person's switches could not be read");
      return data;
    },
    deliver: async (request) => (await import("../push/wiring")).deliverPushForUser(request),
  };
}
