import { sendDeletionLifecycleEmail } from "@/lib/resend/client";

/**
 * The two admin-produced data export emails (src/lib/data-export/email.ts) go through the deletion-lifecycle door, which only code under src/lib/account-deletion/ may call
 * (tests/email/every-sender-uses-the-guarded-client.test.ts holds that). This is that call, and nothing else: a person inside the 30 days before a deletion still receives the start
 * notice and the link, and no other sender gains the exception.
 */
export type DataExportEmailTemplate = "data_export_generated" | "data_export_link";

export async function sendDataExportEmail(
  template: DataExportEmailTemplate,
  payload: { from: string; to: string; subject: string; text: string; html: string },
): Promise<{ error: { message: string } | null }> {
  const res = await sendDeletionLifecycleEmail(template, payload);
  return { error: res.error ? { message: res.error.message } : null };
}
