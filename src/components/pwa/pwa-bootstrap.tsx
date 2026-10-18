"use client";

import { useEffect } from "react";
import { startPwa, type PwaWindow } from "@/lib/pwa/bootstrap";

/**
 * Renders nothing; starts the installable-app bootstrap (src/lib/pwa/bootstrap.ts) once the page has hydrated. `enabled` is the root
 * layout's static read of PWA_KILL, so this component never reads a request-time API and the homepage stays statically rendered.
 */
export function PwaBootstrap({ enabled }: { enabled: boolean }) {
  useEffect(() => {
    startPwa(window as unknown as PwaWindow, enabled);
  }, [enabled]);
  return null;
}
