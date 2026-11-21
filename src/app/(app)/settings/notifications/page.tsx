import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/require-user";
import { EyebrowLabel } from "@/components/ui";
import { NotificationPreferences } from "@/components/settings/notification-preferences";
import { PushOptInMount } from "@/components/settings/push-opt-in-mount";
import { loadPreferencesScreen } from "../notification-preferences-core";
import { realPreferenceDeps } from "../notification-deps";

export const metadata = { title: "Notifications — Talentrah" };

/** Reachable only while the notifications master flag is on; otherwise the route does not exist. */
export default async function NotificationSettingsPage() {
  await requireUser();
  const screen = await loadPreferencesScreen(realPreferenceDeps());
  if (screen.access !== "ok") notFound();
  return (
    <div className="flex max-w-[620px] flex-col gap-6">
      <Link href="/settings" className="inline-flex min-h-[44px] w-fit items-center font-body text-[14px] font-semibold text-rust underline">
        Back to settings
      </Link>
      <div className="flex flex-col gap-2">
        <EyebrowLabel>Settings</EyebrowLabel>
        <h1 className="text-[30px] leading-[1.2]">Notifications</h1>
      </div>
      <NotificationPreferences initial={screen.values} optIn={<PushOptInMount enabled={screen.optInEnabled} />} deviceStateEnabled={screen.optInEnabled} />
    </div>
  );
}
