"use client";

import Link from "next/link";
import { BorderedCard, EyebrowLabel } from "@/components/ui";
import type { NotificationPreferenceValues } from "./notification-preferences-model";
import { categoriesOn, deviceDisplay, emailIsOn } from "./notification-summary-model";
import { useDevicePushState } from "./use-device-push-state";
import type { PushState } from "@/lib/pwa/push/client";

const DEVICE_WORDS = { on: "On", off: "Off", blocked: "Blocked in this browser" } as const;

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line py-2">
      <span className="font-body text-[14px] text-ink-soft">{label}</span>
      <span className="font-body text-[14px] font-semibold text-ink">{value}</span>
    </div>
  );
}

/** The card, as markup. `device` is null until the device has been asked. */
export function NotificationSettingsSummaryView({ values, device }: { values: NotificationPreferenceValues; device: PushState | null }) {
  const { on, total } = categoriesOn(values);
  return (
    <BorderedCard className="flex flex-col gap-3 p-6">
      <EyebrowLabel>Notifications</EyebrowLabel>
      <div className="flex flex-col">
        <Line label="Push on this device" value={device === null ? "Checking…" : DEVICE_WORDS[deviceDisplay(device)]} />
        <Line label="Categories" value={`${on} of ${total} categories on`} />
        <Line label="Email" value={emailIsOn(values) ? "On" : "Off"} />
      </div>
      <Link
        href="/settings/notifications"
        className="inline-flex min-h-[44px] w-fit items-center border-[1.5px] border-ink bg-ink px-4 font-body text-[14px] font-semibold text-paper no-underline hover:bg-rust"
      >
        Manage notifications
      </Link>
    </BorderedCard>
  );
}

/** The card on /settings. Asks this device for its push state only when the push sender is on. */
export function NotificationSettingsSummary({ values, deviceEnabled }: { values: NotificationPreferenceValues; deviceEnabled: boolean }) {
  const device = useDevicePushState(deviceEnabled);
  // With the sender off there is nothing to ask the device: push on this device is simply off.
  return <NotificationSettingsSummaryView values={values} device={deviceEnabled ? device : "off"} />;
}
