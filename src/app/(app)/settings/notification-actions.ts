"use server";

import { realPreferenceDeps } from "./notification-deps";
import { savePreference, type SaveResult } from "./notification-preferences-core";

/**
 * Save ONE notification preference for the signed-in person. The browser sends a column name and a boolean and nothing else: the user is the session's, the column must be one of the seven, and with the
 * master flag off nothing is written. The logic is in notification-preferences-core.ts (tested with injected dependencies); this file only supplies the real ones.
 */
export async function setNotificationPreferenceAction(column: string, value: boolean): Promise<SaveResult> {
  return savePreference(realPreferenceDeps(), { column, value });
}
