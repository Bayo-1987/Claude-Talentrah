/**
 * syncBadge(count): the app-icon badge equals the unread count (the REAL count; the bell's "9+" is a display cap for the bell only). Called on load, on visibilitychange and after every code path that writes
 * read_at (NOTIF-BADGE-CALLERS-1; tests/notifications/bell-badge-callers.test.ts enumerates them). A number and nothing else; zero clears the badge; an unknown count (null) does nothing, so a failed read
 * never clears a real badge. Where the Badging API is missing, or the call is refused, nothing happens and nothing throws.
 */
type BadgeNavigator = { setAppBadge?: (count: number) => Promise<void>; clearAppBadge?: () => Promise<void> };

export function syncBadge(count: number | null): void {
  if (count === null || !Number.isFinite(count) || count < 0) return;
  const nav = (typeof navigator === "undefined" ? undefined : navigator) as BadgeNavigator | undefined;
  if (!nav) return;
  try {
    const pending = count > 0 ? nav.setAppBadge?.(Math.floor(count)) : nav.clearAppBadge?.();
    void pending?.catch?.(() => {});
  } catch {
    // The Badging API is a convenience: a refusal is not an error the person should see.
  }
}
