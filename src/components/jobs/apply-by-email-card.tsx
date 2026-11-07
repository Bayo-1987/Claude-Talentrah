"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The feed card's "Apply by email" control. First it is the plain mailto anchor (the click is NOT prevented, so the seeker's mail app opens, and it is left to bubble so a
 * sponsored card's delegated click tracking still sees it). After that click it becomes a "Copy email address" button, because a seeker without a mail app set up still needs the
 * address. The next click copies it, the label reads "Copied" for two seconds and a polite live region says so. The address is never printed: it lives only in the mailto href and
 * on the clipboard. The copy click stops at the button, so it never reaches the card around it.
 *
 * The copy logic is CopyAddressButton's (the job page keeps that one unchanged).
 */
export function ApplyByEmailCardControl({
  href,
  address,
  label,
  className,
  adClick,
}: {
  href: string;
  address: string;
  label: string;
  className: string;
  adClick?: string;
}) {
  const [opened, setOpened] = useState(false);
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  async function copy(event: { stopPropagation: () => void }) {
    event.stopPropagation();
    let next: "copied" | "failed" = "failed";
    try {
      await navigator.clipboard.writeText(address);
      next = "copied";
    } catch {
      // Clipboard access can be refused (an insecure context, a permissions policy); say so rather than pretend.
    }
    setState(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 2000);
  }

  if (!opened) {
    return (
      <a href={href} data-ad-click={adClick} className={className} onClick={() => setOpened(true)}>
        {label}
      </a>
    );
  }
  return (
    <>
      <button type="button" className={className} onClick={copy}>
        {state === "copied" ? "Copied" : "Copy email address"}
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {state === "copied" ? "Copied" : state === "failed" ? "Could not copy the address" : ""}
      </span>
    </>
  );
}
