import { withDefaults, type NotificationPreferenceValues } from "@/components/settings/notification-preferences-model";

export interface SummaryDeps {
  read(userId: string): Promise<Partial<Record<string, unknown>> | null>;
  flagOn(key: "push_sender"): Promise<boolean>;
}

export type NotificationSummary = { values: NotificationPreferenceValues; deviceEnabled: boolean };

/**
 * What the Settings card needs. `masterOn` is the flag Settings already reads; with it off nothing is read here and there is no card, so the page is what it was. A failing read means no card, never an error:
 * Settings must still render. The device state is asked for only when the push sender is on, because with it off nothing on this screen can turn push on.
 */
export async function loadNotificationSummary(deps: SummaryDeps, userId: string, masterOn: boolean): Promise<NotificationSummary | null> {
  if (!masterOn) return null;
  try {
    const [row, senderOn] = await Promise.all([deps.read(userId), deps.flagOn("push_sender")]);
    return { values: withDefaults(row), deviceEnabled: senderOn === true };
  } catch {
    return null;
  }
}
