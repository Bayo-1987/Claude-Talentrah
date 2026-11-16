"use client";

import { useRef } from "react";
import type { FormEvent, ReactNode } from "react";
import { cleanupPushForSignOut } from "@/lib/notifications/push/signout-cleanup";

/**
 * Synchronous on purpose: the submit event must be decided before the handler returns. There is something to clean up only where push was already granted and a service worker exists; anywhere
 * else (the flags-off state, or a browser that never opted in) the form stays a plain form and its submit is not held back at all.
 */
function pushCleanupApplies(): boolean {
  return typeof Notification !== "undefined" && Notification.permission === "granted" && typeof navigator !== "undefined" && "serviceWorker" in navigator;
}

/**
 * A sign-out form that cleans up this device's push subscription FIRST. The first submit is held back, the cleanup runs (bounded, never throws), and only then does the form submit itself,
 * because the cleanup route needs the live session. The submit it triggers is let through untouched, so the server action runs exactly as before. `cleanup` is injectable for tests only.
 */
export function PushCleanupForm({
  action,
  className,
  children,
  cleanup = cleanupPushForSignOut,
}: {
  action: (formData: FormData) => void | Promise<void>;
  className?: string;
  children: ReactNode;
  cleanup?: () => Promise<void>;
}) {
  const phase = useRef<"idle" | "cleaning" | "ready">("idle");

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    if (phase.current === "ready") return; // our own requestSubmit: let it through
    if (phase.current === "idle" && !pushCleanupApplies()) return; // nothing to clean up: a plain submit
    event.preventDefault();
    if (phase.current === "cleaning") return; // a second click while the first is running
    phase.current = "cleaning";
    const form = event.currentTarget;
    cleanup()
      .catch(() => undefined)
      .then(() => {
        phase.current = "ready";
        form.requestSubmit();
      });
  }

  return (
    <form action={action} className={className} onSubmit={onSubmit}>
      {children}
    </form>
  );
}
