import "server-only";
import { sendAdminAlert } from "@/lib/admin/alert-email";
import { NANO_PER_USD, type SpendAlertLevel } from "./spend-ceiling";

/**
 * The operator alert for Farah's daily spend ceiling: one email at 80% of the day's ceiling and one when it is reached (spend-ceiling.ts decides when; this says what).
 *
 * It goes through the existing operator alert (`sendAdminAlert`, recipient ADMIN_ALERT_EMAIL), which never throws and logs "NOT SENT" when the recipient or the mail key is not set.
 * The text carries only figures and the name of the setting to change: no user id, no email address, no message text. It never throws, and a mail provider that hangs
 * holds the caller for at most MAX_WAIT_MS (this runs on the request that happened to cross the line, once a day).
 */
const MAX_WAIT_MS = 2_000;

const dollars = (nano: number) => `$${(nano / NANO_PER_USD).toFixed(2)}`;

export async function sendSpendAlert(level: SpendAlertLevel, spentNano: number, ceilingNano: number): Promise<void> {
  const figures = `Estimated spend so far today: ${dollars(spentNano)} of ${dollars(ceilingNano)}.`;
  const message =
    level === "eighty"
      ? {
          subject: "Farah has used 80% of today's budget",
          text: `${figures}\n\nFarah is still replying. At 100% she stops replying until 00:00 UTC. If that is not what you want, raise FARAH_DAILY_SPEND_CEILING_USD on the deployment.`,
        }
      : {
          subject: "Farah has used today's whole budget",
          text: `${figures}\n\nFarah is not replying to anyone until 00:00 UTC. To change that today, raise FARAH_DAILY_SPEND_CEILING_USD on the deployment.`,
        };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([sendAdminAlert(message), new Promise<void>((resolve) => (timer = setTimeout(resolve, MAX_WAIT_MS)))]);
  } catch {
    /* sendAdminAlert does not throw; this keeps the guarantee even if that changes */
  } finally {
    if (timer) clearTimeout(timer);
  }
}
