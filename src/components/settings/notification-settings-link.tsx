import Link from "next/link";
import { inboxEnabled } from "@/lib/notifications/inbox/enabled";
import { showNotificationsLink } from "./notification-preferences-model";

/** Whether Settings links to the notification preferences: the same per-request flag read the bell uses (notifications_master, fails closed, read once per render). */
export async function readNotificationsLinkFlag(): Promise<boolean> {
  return showNotificationsLink(await inboxEnabled());
}

/** The link itself. Renders nothing unless `show` is true. */
export function NotificationSettingsLink({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <Link href="/settings/notifications" className="inline-flex min-h-[44px] w-fit items-center font-body text-[14px] font-semibold text-rust underline">
      Notification settings
    </Link>
  );
}
