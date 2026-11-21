"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { syncBadge } from "@/components/notifications/badge";
import { createBellController, type BellState } from "@/components/notifications/bell-controller";
import { formatUnreadCount } from "@/lib/notifications/inbox/format";
import { safeInternalPath } from "@/lib/notifications/inbox/links";
import type { InboxItem } from "@/lib/notifications/inbox/service";

/**
 * The bell in the signed-in masthead (PR-B U2). Shown ONLY when the layout says notifications_master is on (the masthead renders it behind that prop); it then asks for its list once on mount and again each time the page
 * becomes visible. The count is a number capped at "9+", never a meter. On a phone (below sm) the wrapper is not positioned, so the open panel is placed against the masthead band (a positioned, full-width ancestor): it spans the viewport directly under the header instead of hanging off the bell, which sits left of other controls and cut the panel off the left edge. From sm up the wrapper is positioned again and the panel is the 360px dropdown under the bell. Opening the list marks nothing read: opening ONE item marks that item, "Mark all read" marks everything.
 */
export function BellView({
  open,
  items,
  unreadCount,
  onToggle,
  onOpenItem,
  onMarkAll,
}: {
  open: boolean;
  items: InboxItem[];
  unreadCount: number | null;
  onToggle: () => void;
  onOpenItem: (id: string) => void;
  onMarkAll: () => void;
}) {
  const count = unreadCount ?? 0;
  const label = count > 0 ? `Notifications, ${count} unread` : "Notifications";
  return (
    <div data-notification-bell className="sm:relative">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={onToggle}
        className="relative inline-flex min-h-11 min-w-11 items-center justify-center border-none bg-transparent px-2 text-ink hover:text-rust"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="square" aria-hidden="true">
          <path d="M6 9a6 6 0 0 1 12 0v5l2 3H4l2-3V9z" />
          <path d="M10 20h4" />
        </svg>
        {count > 0 && (
          <span aria-hidden="true" className="ml-1 inline-flex min-w-[18px] items-center justify-center bg-rust px-1 font-body text-[11px] font-bold leading-[18px] text-paper">
            {formatUnreadCount(count)}
          </span>
        )}
      </button>
      {open && (
        <div role="dialog" aria-label="Notifications" className="absolute inset-x-0 top-full z-30 border-[1.5px] border-ink bg-card sm:inset-x-auto sm:right-0 sm:top-[calc(100%+8px)] sm:w-[360px]">
          <div className="flex items-center justify-between border-b border-line px-4 py-2">
            <span className="font-display text-[16px] font-medium text-ink">Notifications</span>
            {count > 0 && (
              <button type="button" onClick={onMarkAll} className="min-h-11 border-none bg-transparent px-1 font-body text-[13px] font-semibold text-rust hover:underline">
                Mark all read
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <p className="px-4 py-6 font-body text-[13.5px] text-ink-soft">Nothing new yet.</p>
          ) : (
            <ul className="max-h-[70vh] list-none overflow-y-auto p-0">
              {items.map((item) => {
                const href = safeInternalPath(item.link);
                const inner = (
                  <>
                    <span className={`block font-body text-[14px] ${item.read ? "text-ink-soft" : "font-semibold text-ink"}`}>{item.title}</span>
                    <span className="mt-0.5 block font-body text-[13px] text-ink-soft">{item.body}</span>
                  </>
                );
                const className = "block min-h-10 w-full border-none bg-transparent px-4 py-3 text-left no-underline hover:bg-paper-alt";
                return (
                  <li key={item.id} data-unread={item.read ? undefined : "true"} className={`border-b border-line last:border-b-0 ${item.read ? "" : "border-l-[3px] border-l-rust"}`}>
                    {href ? (
                      <Link href={href} onClick={() => onOpenItem(item.id)} className={className}>
                        {inner}
                      </Link>
                    ) : (
                      <button type="button" onClick={() => onOpenItem(item.id)} className={className}>
                        {inner}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export function NotificationBell() {
  const [state, setState] = useState<BellState>({ status: "loading", items: [], unreadCount: null, open: false });
  const controller = useRef<ReturnType<typeof createBellController> | null>(null);
  const root = useRef<HTMLDivElement>(null);
  if (controller.current === null) {
    controller.current = createBellController({ fetchImpl: (...args) => fetch(...args), syncBadge, onChange: setState });
  }

  useEffect(() => {
    const c = controller.current!;
    void c.load();
    return c.watchVisibility(document);
  }, []);

  useEffect(() => {
    if (!state.open) return;
    const c = controller.current!;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") c.close();
    };
    const onPointer = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) c.close();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [state.open]);

  if (state.status === "hidden") return null;
  const c = controller.current;
  return (
    <div ref={root}>
      <BellView
        open={state.open}
        items={state.items}
        unreadCount={state.unreadCount}
        onToggle={() => c.toggle()}
        onOpenItem={(id) => void c.markOne(id)}
        onMarkAll={() => void c.markAll()}
      />
    </div>
  );
}
