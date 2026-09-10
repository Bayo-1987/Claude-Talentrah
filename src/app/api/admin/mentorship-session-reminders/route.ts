import { NextResponse } from "next/server";
import { runMentorshipSessionReminders } from "@/lib/mentorship/notifications";
import { requireAdminSecret, requireCronSecret, internalError } from "@/lib/api/admin-auth";

/**
 * Sends the pre-session reminder for every CONFIRMED mentorship session
 * starting within the next REMINDER_WINDOW_HOURS that hasn't been reminded
 * yet. Same two-entry-point shape as mentorship-sweep and renew-passes — GET
 * for Vercel Cron, POST for a manual/admin on-demand run.
 *
 * RUNS DAILY, same Hobby-tier constraint mentorship-sweep's own header
 * documents (a Vercel Hobby plan runs a cron once per day regardless of the
 * schedule string), which is WHY REMINDER_WINDOW_HOURS is 24 rather than
 * something tighter like "1 hour before": a daily sweep cannot promise an
 * exact lead time, so the honest design is a window wide enough that one
 * daily run is guaranteed to catch every session before it starts, with
 * `reminder_sent_at` as the guard against sending it more than once. The
 * real consequence, stated rather than hidden: a session confirmed for
 * (say) 20 hours from now could get its reminder anywhere from immediately
 * to ~20 hours before start, depending on exactly when in the day this cron
 * happens to run — not a fixed "X hours before" promise. Move to a paid
 * plan's minute-level cron if a tighter, predictable lead time turns out to
 * matter in practice.
 */
export async function GET(request: Request) {
  const denied = requireCronSecret(request);
  if (denied) return denied;
  return runAndRespond();
}

export async function POST(request: Request) {
  const denied = requireAdminSecret(request);
  if (denied) return denied;
  return runAndRespond();
}

async function runAndRespond() {
  let summary;
  try {
    summary = await runMentorshipSessionReminders();
  } catch (err) {
    return internalError("mentorship-session-reminders", err);
  }

  console.log(
    `[mentorship-session-reminders] considered=${summary.considered} sent=${summary.sent} failed=${summary.failed} errors=${summary.errors.length}`,
  );

  return NextResponse.json({ summary }, { status: summary.ok ? 200 : 500 });
}
