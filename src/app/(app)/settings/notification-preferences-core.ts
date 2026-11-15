import {
  isPreferenceColumn,
  PUSH_DEPENDENT_COLUMNS,
  withDefaults,
  type NotificationPreferenceColumn,
  type NotificationPreferenceValues,
} from "@/components/settings/notification-preferences-model";

/**
 * The logic behind the notification preferences screen and its one server action, with every outside thing injected so it is tested without a database, a session or a flag table.
 *
 * WHO: the person is ALWAYS the signed-in session's user. Nothing the browser sends names a user: the input is a column and a value, and an extra field on it (a user id) is ignored.
 * WHAT: only the seven columns of the model, only booleans. Anything else is refused before anything is read or written.
 * WHEN: with `notifications_master` OFF nothing is written and the screen does not exist (the route is a 404), so with every flag OFF the feature is invisible and inert.
 * WHERE: `email_preferences` has no client policies (0083), so the real deps use the service role, keyed by the session user.
 */
export interface PreferenceDeps {
  sessionUserId(): Promise<string | null>;
  flagOn(key: "notifications_master" | "push_sender"): Promise<boolean>;
  read(userId: string): Promise<Partial<Record<string, unknown>> | null>;
  write(userId: string, column: NotificationPreferenceColumn, value: boolean): Promise<boolean>;
}

export type SaveResult =
  | { ok: true; note?: "push_off" }
  | { ok: false; error: "signed_out" | "unknown_setting" | "unavailable" | "not_saved" };

export async function savePreference(deps: PreferenceDeps, input: { column: unknown; value: unknown }): Promise<SaveResult> {
  if (!isPreferenceColumn(input.column) || typeof input.value !== "boolean") return { ok: false, error: "unknown_setting" };
  const column = input.column;
  const userId = await deps.sessionUserId();
  if (!userId) return { ok: false, error: "signed_out" };
  if (!(await deps.flagOn("notifications_master"))) return { ok: false, error: "unavailable" };
  const saved = await deps.write(userId, column, input.value);
  if (!saved) return { ok: false, error: "not_saved" };
  if (input.value && PUSH_DEPENDENT_COLUMNS.includes(column)) {
    const row = await deps.read(userId);
    if (withDefaults(row).push_enabled === false) return { ok: true, note: "push_off" };
  }
  return { ok: true };
}

export type PreferencesScreen =
  | { access: "signed_out" }
  | { access: "off" }
  | { access: "ok"; values: NotificationPreferenceValues; optInEnabled: boolean };

/** What the preferences route needs: nothing at all unless the master flag is on; the opt-in only when the push sender flag is on as well. */
export async function loadPreferencesScreen(deps: PreferenceDeps): Promise<PreferencesScreen> {
  const userId = await deps.sessionUserId();
  if (!userId) return { access: "signed_out" };
  if (!(await deps.flagOn("notifications_master"))) return { access: "off" };
  const [row, senderOn] = await Promise.all([deps.read(userId), deps.flagOn("push_sender")]);
  return { access: "ok", values: withDefaults(row), optInEnabled: senderOn };
}
