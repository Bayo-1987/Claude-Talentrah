/**
 * In-memory fake of the push sender. It records what it was asked to send and
 * answers with a scripted outcome.
 *
 * The device's endpoint and keys are credential-like. The fake therefore never
 * stores them: it records the device id and the payload only, and nothing it
 * throws or exposes contains them.
 */
import type { PushPayload, PushSendOutcome, PushSendResult, PushSender, PushTarget } from "../contract";

export type RecordedPush = { deviceId: string; payload: PushPayload };

export class FakePushSender implements PushSender {
  readonly sent: RecordedPush[] = [];
  private scripted = new Map<string, PushSendOutcome>();
  private fallback: PushSendOutcome = "sent";

  /** Every device not scripted answers with this outcome. */
  answerWith(outcome: PushSendOutcome): void {
    this.fallback = outcome;
  }
  /** One device answers with this outcome. */
  answerDeviceWith(deviceId: string, outcome: PushSendOutcome): void {
    this.scripted.set(deviceId, outcome);
  }

  async send(target: PushTarget, payload: PushPayload): Promise<PushSendResult> {
    const outcome = this.scripted.get(target.deviceId) ?? this.fallback;
    // Only a delivered alert counts as sent; a failed attempt is not recorded as one.
    if (outcome === "sent") this.sent.push({ deviceId: target.deviceId, payload });
    return { outcome };
  }
}
