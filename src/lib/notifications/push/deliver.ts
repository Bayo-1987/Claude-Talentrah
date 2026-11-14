import type {
  ClaimNotificationArgs,
  ClaimNotificationResult,
  MarkNotificationSentArgs,
  NotificationKind,
  PushRevokeReason,
  PushSender,
  PushTarget,
  ReleaseNotificationArgs,
} from "../contract";
import { NOTIFICATION_FLAGS } from "../contract";
import { buildPushPayload } from "./payload";
import { endpointHash, type PushLog } from "./sender";

/**
 * Everything a delivery touches arrives here, so the rules below (kill switch, flags, deletion, the claim, the failure table) are tested without a database or a network. The real bindings are
 * in wiring.ts.
 */
export type DeliverDeps = {
  /** Read on every call, never captured: the kill switch takes effect on the next delivery without a deploy of this code. */
  env: { PWA_KILL?: string };
  flagOn(key: string): Promise<boolean>;
  isDeleting(userId: string): Promise<boolean>;
  loadTargets(userId: string): Promise<PushTarget[]>;
  claim(args: ClaimNotificationArgs): Promise<ClaimNotificationResult>;
  release(args: ReleaseNotificationArgs): Promise<void>;
  markSent(args: MarkNotificationSentArgs): Promise<void>;
  revokeDevice(deviceId: string, reason: Extract<PushRevokeReason, "gone">): Promise<void>;
  sender: PushSender;
  log: PushLog;
};

export type DeliverRequest = { userId: string; kind: NotificationKind; subject: string; url: string; badge: number | null };

export type DeliverSummary = {
  skipped: null | "kill" | "flag_off" | "deleting";
  devices: number;
  sent: number;
  released: number;
  revoked: number;
  /** Claims the database refused (quiet hours, budget, already claimed, device unavailable). They are not retried here. */
  suppressed: number;
  /** A 401 or 403 from the push service ended the batch: the fault is our key, not the device. */
  stopped: boolean;
};

const empty = (skipped: DeliverSummary["skipped"]): DeliverSummary => ({ skipped, devices: 0, sent: 0, released: 0, revoked: 0, suppressed: 0, stopped: false });

async function flagsOn(deps: DeliverDeps): Promise<boolean> {
  try {
    // A flag that cannot be read is a flag that is off.
    return (await deps.flagOn(NOTIFICATION_FLAGS.master)) === true && (await deps.flagOn(NOTIFICATION_FLAGS.pushSender)) === true;
  } catch {
    return false;
  }
}

async function deleting(deps: DeliverDeps, userId: string): Promise<boolean> {
  try {
    return await deps.isDeleting(userId);
  } catch {
    // Cannot tell whether the person asked to be deleted: do not send.
    return true;
  }
}

/** Sends one alert to every active device of one person. Never throws for a delivery problem; the summary says what happened. */
export async function deliverPush(deps: DeliverDeps, request: DeliverRequest): Promise<DeliverSummary> {
  if (deps.env.PWA_KILL === "1") {
    deps.log({ event: "push_skipped_kill" });
    return empty("kill");
  }
  if (!(await flagsOn(deps))) {
    deps.log({ event: "push_skipped_flag_off" });
    return empty("flag_off");
  }
  if (await deleting(deps, request.userId)) {
    deps.log({ event: "push_skipped_deleting" });
    return empty("deleting");
  }

  let targets: PushTarget[];
  try {
    targets = await deps.loadTargets(request.userId);
  } catch {
    deps.log({ event: "push_devices_unreadable" });
    return empty(null);
  }

  const summary = empty(null);
  summary.devices = targets.length;
  const payload = buildPushPayload(request.kind, { url: request.url, badge: request.badge });

  for (const target of targets) {
    const hash = endpointHash(target.endpoint);
    let claim: ClaimNotificationResult;
    try {
      claim = await deps.claim({ p_user: request.userId, p_kind: request.kind, p_subject: request.subject, p_channel: "push", p_device: target.deviceId });
    } catch {
      deps.log({ event: "push_claim_failed", endpointHash: hash });
      continue;
    }
    if (claim.id === null) {
      summary.suppressed += 1;
      deps.log({ event: "push_claim_refused", endpointHash: hash });
      continue;
    }
    const notificationId = claim.id;

    let outcome: Awaited<ReturnType<PushSender["send"]>>["outcome"];
    try {
      outcome = (await deps.sender.send(target, payload)).outcome;
    } catch {
      outcome = "unknown";
    }
    deps.log({ event: `push_${outcome}`, notificationId, endpointHash: hash });

    if (outcome === "sent") {
      await deps.markSent({ p_id: notificationId }).catch(() => deps.log({ event: "push_mark_failed", notificationId }));
      summary.sent += 1;
      continue;
    }
    // 'unknown': the process cannot tell whether the service accepted it. The claim stays open for the stale-claim resolver; releasing it would invite a second send.
    if (outcome === "unknown") continue;

    if (outcome === "gone") {
      await deps.revokeDevice(target.deviceId, "gone").then(
        () => void (summary.revoked += 1),
        () => deps.log({ event: "push_revoke_failed", notificationId, endpointHash: hash }),
      );
    }
    await deps.release({ p_id: notificationId, p_reason: outcome }).then(
      () => void (summary.released += 1),
      () => deps.log({ event: "push_release_failed", notificationId }),
    );
    if (outcome === "our_key") {
      summary.stopped = true;
      break;
    }
  }

  deps.log({ event: "push_batch", counts: { devices: summary.devices, sent: summary.sent, released: summary.released, revoked: summary.revoked, suppressed: summary.suppressed, stopped: summary.stopped ? 1 : 0 } });
  return summary;
}
