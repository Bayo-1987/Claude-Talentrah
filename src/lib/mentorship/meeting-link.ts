import { randomUUID } from "crypto";

/**
 * §6.11 flags video call integration `[DECIDE — optional]` and this v1 slice
 * cuts it: no Google Meet OAuth/Calendar credentials exist in this
 * environment, so a real Google Meet integration cannot honestly be built.
 * Jitsi Meet's public server needs no API key or account — a room at this
 * URL is immediately joinable by anyone with the link, which is exactly what
 * a two-person mentorship call needs and nothing more.
 *
 * `mentorship_sessions.meeting_link` is a plain text column specifically so
 * this can be swapped for a real provider integration later without a schema
 * change — this function is the only place that decision is made.
 */
export function generateMeetingLink(): string {
  return `https://meet.jit.si/talentrah-${randomUUID()}`;
}
