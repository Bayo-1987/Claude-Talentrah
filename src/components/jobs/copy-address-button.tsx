"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * "Copy address" for an apply-by-email posting. A seeker on a phone without a mail app set up, or on a shared computer, still needs the address itself.
 * The label changes to "Copied" for two seconds and is announced politely; if the browser refuses clipboard access the button says so instead of pretending.
 * The address is shown in full on the page next to this button, so a failed copy never leaves the seeker without it.
 */
export function CopyAddressButton({ address }: { address: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  async function copy() {
    let next: "copied" | "failed" = "failed";
    try {
      await navigator.clipboard.writeText(address);
      next = "copied";
    } catch {
      // Clipboard access can be refused (an insecure context, a permissions policy). The address is on the page; say that the copy did not happen.
    }
    setState(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 2000);
  }

  return (
    <>
      <Button type="button" variant="secondary" size="sm" onClick={copy} className="gap-2">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <rect x="5.5" y="5.5" width="8" height="8" stroke="currentColor" strokeWidth="1.4" />
          <path d="M3 10.5V3h7.5" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
        {state === "copied" ? "Copied" : "Copy address"}
      </Button>
      <span role="status" className="sr-only">
        {state === "copied" ? "Address copied" : state === "failed" ? "Could not copy the address" : ""}
      </span>
    </>
  );
}
