import type { InboxItem } from "@/lib/notifications/inbox/service";

/**
 * The bell's behaviour without React, so it can be tested and so every read-state path is in one place. State: the newest items, the unread count the SERVER last answered, whether the list is open, and whether the
 * bell is hidden (the server answered 404: notifications_master is off).
 *
 * Opening the bell writes NOTHING. Only opening an item (markOne) or "Mark all read" (markAll) writes, and after every load and every write the app badge is synced to the count the server answered (NOTIF-BADGE-CALLERS-1).
 */
export interface BellState {
  status: "loading" | "ready" | "hidden";
  items: InboxItem[];
  unreadCount: number | null;
  open: boolean;
}

export interface BellDeps {
  fetchImpl: typeof fetch;
  syncBadge: (count: number | null) => void;
  onChange: (state: BellState) => void;
}

type VisibilityDoc = Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener">;

export function createBellController(deps: BellDeps) {
  let state: BellState = { status: "loading", items: [], unreadCount: null, open: false };
  const set = (patch: Partial<BellState>) => {
    state = { ...state, ...patch };
    deps.onChange(state);
  };
  const countOf = (body: unknown): number | null => {
    const n = (body as { unreadCount?: unknown } | null)?.unreadCount;
    return typeof n === "number" && Number.isFinite(n) ? n : null;
  };

  return {
    async load() {
      try {
        const res = await deps.fetchImpl("/api/notifications");
        if (res.status === 404) return set({ status: "hidden", items: [], unreadCount: null, open: false });
        if (!res.ok) return;
        const body = (await res.json()) as { items?: InboxItem[]; unreadCount?: number | null };
        const unreadCount = countOf(body);
        set({ status: "ready", items: body.items ?? [], unreadCount });
        deps.syncBadge(unreadCount);
      } catch {
        // A failed load keeps what is shown; the next load or visibility change tries again.
      }
    },
    async markOne(id: string) {
      try {
        const res = await deps.fetchImpl(`/api/notifications/${encodeURIComponent(id)}/read`, { method: "POST", keepalive: true });
        if (!res.ok) return;
        const unreadCount = countOf(await res.json());
        set({ items: state.items.map((i) => (i.id === id ? { ...i, read: true } : i)), unreadCount });
        deps.syncBadge(unreadCount);
      } catch {
        // Nothing changed; the item stays unread.
      }
    },
    async markAll() {
      try {
        const res = await deps.fetchImpl("/api/notifications/read-all", { method: "POST" });
        if (!res.ok) return;
        const unreadCount = countOf(await res.json());
        set({ items: state.items.map((i) => ({ ...i, read: true })), unreadCount });
        deps.syncBadge(unreadCount);
      } catch {
        // Nothing changed.
      }
    },
    toggle() {
      set({ open: !state.open });
    },
    close() {
      if (state.open) set({ open: false });
    },
    /** Reload (and re-sync the badge) when the page becomes visible again. Returns the function that stops listening. */
    watchVisibility(doc: VisibilityDoc): () => void {
      const onChange = () => {
        if (doc.visibilityState === "visible") void this.load();
      };
      doc.addEventListener("visibilitychange", onChange);
      return () => doc.removeEventListener("visibilitychange", onChange);
    },
    state: () => state,
  };
}
